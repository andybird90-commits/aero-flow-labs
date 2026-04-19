/**
 * ExtractedPartPreview — new flow
 *
 * Step 1 (renders):  Click hotspot → call `render-isolated-part` to have
 *                    Gemini draw the chosen part on a clean white backdrop
 *                    from 4 angles. Show those images in a grid.
 * Step 2 (approve):  User reviews the renders. If they look right, click
 *                    "Make 3D model" → call `meshify-part` (Meshy).
 * Step 3 (mesh):     Show the resulting GLB in a Three.js viewer with
 *                    auto-rotate, plus a "Download GLB" button.
 *
 * The whole thing happens inside one modal so the user can see each stage
 * without losing context.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Wand2, Box, Download, X, RotateCcw, Scissors, MousePointerClick, Lasso, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PartLasso, type LassoMode, type LassoClick, type LassoPoint } from "@/components/PartLasso";

interface Props {
  open: boolean;
  onClose: () => void;
  conceptId: string;
  kind: string;
  label: string;
  filenameBase: string;
}

type Stage = "rendering" | "review" | "meshing" | "ready" | "error";

interface RenderImage { angle: string; url: string }

export function ExtractedPartPreview({
  open, onClose, conceptId, kind, label, filenameBase,
}: Props) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("rendering");
  const [images, setImages] = useState<RenderImage[]>([]);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  // Trim / edge-snap state
  const [trimOpen, setTrimOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState<LassoMode>("lasso");
  const [trimPoints, setTrimPoints] = useState<LassoClick[]>([]);
  const [trimLasso, setTrimLasso] = useState<LassoPoint[]>([]);
  const [maskedUrl, setMaskedUrl] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);

  // Reset trim state whenever the dialog opens or the underlying render changes.
  useEffect(() => {
    setTrimOpen(false);
    setTrimPoints([]);
    setTrimLasso([]);
    setMaskedUrl(null);
  }, [open, conceptId, kind]);

  const purgeCachedMesh = async () => {
    const { error } = await supabase
      .from("concept_parts")
      .update({ glb_url: null })
      .eq("concept_id", conceptId)
      .eq("kind", kind);
    if (error) throw error;
    setGlbUrl(null);
  };

  // Look up cached renders/mesh for this concept+kind. Returns true if we
  // hydrated from the cache (so the caller skips regeneration).
  const loadFromCache = async (signal?: { cancelled: boolean }) => {
    const { data, error } = await supabase
      .from("concept_parts")
      .select("render_urls, glb_url")
      .eq("concept_id", conceptId)
      .eq("kind", kind)
      .maybeSingle();
    if (signal?.cancelled) return false;
    if (error || !data) return false;
    const renders = ((data.render_urls as unknown) as RenderImage[] | null) ?? [];
    if (!renders.length) return false;
    setImages(renders);
    if (data.glb_url) {
      setGlbUrl(data.glb_url);
      setStage("ready");
    } else {
      setStage("review");
    }
    return true;
  };

  // Run the AI render. Pass `force` to bypass cache and always regenerate.
  const runRender = async (signal?: { cancelled: boolean }, force = false) => {
    setStage("rendering");
    setImages([]);
    setGlbUrl(null);
    setError(null);
    try {
      if (!force) {
        const hit = await loadFromCache(signal);
        if (hit) return;
        if (signal?.cancelled) return;
      }
      const { data, error } = await supabase.functions.invoke("render-isolated-part", {
        body: { concept_id: conceptId, part_kind: kind, label },
      });
      if (signal?.cancelled) return;
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const renders = (data as any).renders as RenderImage[];
      if (!renders?.length) throw new Error("No renders returned");
      setImages(renders);
      setStage("review");
    } catch (e: any) {
      if (signal?.cancelled) return;
      const msg = String(e.message ?? e);
      setError(msg);
      setStage("error");
    }
  };

  useEffect(() => {
    if (!open) return;
    const signal = { cancelled: false };
    runRender(signal);
    return () => { signal.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conceptId, kind, label]);

  const [meshProgress, setMeshProgress] = useState<number>(0);

  const onMakeMesh = async () => {
    setStage("meshing");
    setError(null);
    setMeshProgress(0);
    try {
      // 1) Start the Meshy job → get a task_id
      // If the user trimmed the render with the lasso/click tool, send the
      // masked image to Meshy instead of the raw render — the mesher only
      // ever sees the cleaned silhouette.
      const meshImages = maskedUrl ? [maskedUrl] : images.map((i) => i.url);
      const startRes = await supabase.functions.invoke("meshify-part", {
        body: {
          action: "start",
          concept_id: conceptId,
          part_kind: kind,
          image_urls: meshImages,
        },
      });
      if (startRes.error) throw startRes.error;
      const startData = startRes.data as any;
      if (startData?.error) throw new Error(startData.error);
      const taskId: string | undefined = startData?.task_id;
      const isMulti: boolean = !!startData?.is_multi;
      if (!taskId) throw new Error("No task id returned");

      // 2) Poll status every 4s for up to 8 minutes
      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const pollRes = await supabase.functions.invoke("meshify-part", {
          body: {
            action: "status",
            concept_id: conceptId,
            part_kind: kind,
            task_id: taskId,
            is_multi: isMulti,
          },
        });
        if (pollRes.error) throw pollRes.error;
        const pollData = pollRes.data as any;
        if (pollData?.error) throw new Error(pollData.error);

        if (typeof pollData?.progress === "number") setMeshProgress(pollData.progress);

        if (pollData?.status === "SUCCEEDED" && (pollData?.stl_url || pollData?.glb_url)) {
          setGlbUrl((pollData.stl_url ?? pollData.glb_url) as string);
          setStage("ready");
          return;
        }
        if (["FAILED", "CANCELED", "EXPIRED"].includes(pollData?.status)) {
          throw new Error(pollData?.error || `Meshy ${pollData?.status}`);
        }
      }
      throw new Error("Meshy timed out (8 min)");
    } catch (e: any) {
      const msg = String(e.message ?? e);
      setError(msg);
      setStage("error");
      toast({ title: "Mesh generation failed", description: msg, variant: "destructive" });
    }
  };

  const onDownload = async () => {
    if (!glbUrl) return;
    try {
      const resp = await fetch(glbUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenameBase}.stl`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: `${label} downloaded`, description: `${filenameBase}.stl` });
    } catch (e: any) {
      toast({ title: "Download failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  // Send the user's lasso/click marks to the SAM-backed segment-part edge
  // function and replace the hero render with the masked output.
  const onSnap = async () => {
    const sourceUrl = images[0]?.url;
    if (!sourceUrl) return;
    if (trimPoints.length === 0 && trimLasso.length < 3) {
      toast({
        title: "Mark the part first",
        description: "Click on the part or draw a rough outline around it.",
        variant: "destructive",
      });
      return;
    }
    setSnapping(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-part", {
        body: {
          image_url: sourceUrl,
          points: trimPoints,
          lasso: trimLasso,
          concept_id: conceptId,
          part_kind: kind,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any).masked_url as string;
      if (!url) throw new Error("No masked image returned");
      setMaskedUrl(url);
      setTrimOpen(false);
      toast({ title: "Trimmed", description: "Masked render is ready to mesh." });
    } catch (e: any) {
      toast({ title: "Snap failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setSnapping(false);
    }
  };

  const resetTrim = () => { setTrimPoints([]); setTrimLasso([]); };
  const clearMask = () => { setMaskedUrl(null); resetTrim(); };

  // GLB viewer (only when stage === "ready")
  useEffect(() => {
    if (stage !== "ready" || !glbUrl) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const waitForMount = () => {
      if (cancelled) return;
      const mount = mountRef.current;
      const w = mount?.clientWidth ?? 0;
      const h = mount?.clientHeight ?? 0;
      if (!mount || w < 20 || h < 20) {
        requestAnimationFrame(waitForMount);
        return;
      }
      cleanup = init(mount, w, h);
    };

    const init = (mount: HTMLDivElement, width: number, height: number) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0d10);

      const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(3, 4, 3);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
      rim.position.set(-3, 2, -3);
      scene.add(rim);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;

      const loader = new STLLoader();
      (async () => {
        try {
          const resp = await fetch(glbUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          if (cancelled) return;
          // STLLoader's auto-detect can misread ASCII as binary. Sniff the
          // first ~1KB: if it starts with "solid" AND contains "facet", it's
          // ASCII — feed it as a string. Otherwise treat as binary.
          const head = new TextDecoder().decode(buf.slice(0, 1024)).trim().toLowerCase();
          const isAscii = head.startsWith("solid") && head.includes("facet");
          const geometry = isAscii
            ? loader.parse(new TextDecoder().decode(buf))
            : loader.parse(buf);
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
            color: 0xb8c2cc,
            metalness: 0.2,
            roughness: 0.6,
          });
          const model = new THREE.Mesh(geometry, material);
          scene.add(model);

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const dist = maxDim * 1.4;
          camera.near = Math.max(0.1, maxDim / 1000);
          camera.far = Math.max(10000, maxDim * 10);
          camera.updateProjectionMatrix();
          camera.position.set(center.x + dist * 0.9, center.y + dist * 0.35, center.z + dist * 0.9);
          controls.target.copy(center);
          controls.minDistance = maxDim * 0.2;
          controls.maxDistance = maxDim * 6;
          controls.update();
        } catch (err) {
          console.error("STL load failed", err);
          purgeCachedMesh().catch((purgeErr) => console.error("Failed to purge cached mesh", purgeErr));
          setError("Cached STL failed to load. Cache cleared — regenerate the part mesh.");
          setStage("error");
        }
      })();

      let raf = 0;
      const tick = () => {
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      const onResize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(mount);

      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = (m as any).material;
          if (Array.isArray(mat)) mat.forEach((x: any) => x?.dispose?.());
          else mat?.dispose?.();
        });
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    };

    waitForMount();
    return () => { cancelled = true; cleanup?.(); };
  }, [stage, glbUrl]);

  const titleLine = (
    <DialogTitle className="flex items-center gap-2">
      {label}
      <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">{kind}</span>
    </DialogTitle>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          {titleLine}
          <DialogDescription>
            {stage === "rendering" && "Drawing the part on a clean white background…"}
            {stage === "review"    && "Review the render. Regenerate if it looks generic, or turn it into a 3D model."}
            {stage === "meshing"   && "Building 3D mesh — usually 1-3 minutes."}
            {stage === "ready"     && "Mesh ready. Spin it around, then download."}
            {stage === "error"     && "Something went wrong. See details below."}
          </DialogDescription>
        </DialogHeader>

        {/* RENDERING / REVIEW: single hero render — or the lasso/click trim
            tool when the user opens "Trim". Mask, once produced, replaces the
            hero image so the user can see what they're about to mesh. */}
        {(stage === "rendering" || stage === "review" || stage === "meshing") && (
          <div className="relative">
            <div className="flex justify-center">
              <div className="relative aspect-square w-full max-w-md rounded-md border border-border bg-surface-0 overflow-hidden flex items-center justify-center">
                {trimOpen && images[0] ? (
                  <PartLasso
                    imageUrl={maskedUrl ?? images[0].url}
                    mode={lassoMode}
                    points={trimPoints}
                    lasso={trimLasso}
                    onChange={({ points, lasso }) => { setTrimPoints(points); setTrimLasso(lasso); }}
                    className="w-full h-full"
                  />
                ) : (maskedUrl || images[0]) ? (
                  <>
                    <img
                      src={maskedUrl ?? images[0].url}
                      alt={`${label} ${images[0]?.angle ?? ""}`}
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1 py-0.5 rounded">
                      {maskedUrl ? "trimmed" : images[0]?.angle}
                    </span>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-[9px] font-mono uppercase tracking-widest">Drawing…</span>
                  </div>
                )}
              </div>
            </div>

            {/* Trim toolbar — only meaningful in review stage */}
            {stage === "review" && trimOpen && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
                <div className="inline-flex rounded-md border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setLassoMode("lasso")}
                    className={`px-2 py-1 inline-flex items-center gap-1 ${lassoMode === "lasso" ? "bg-primary text-primary-foreground" : "bg-surface-1 text-muted-foreground"}`}
                  >
                    <Lasso className="h-3 w-3" /> Lasso
                  </button>
                  <button
                    type="button"
                    onClick={() => setLassoMode("click")}
                    className={`px-2 py-1 inline-flex items-center gap-1 ${lassoMode === "click" ? "bg-primary text-primary-foreground" : "bg-surface-1 text-muted-foreground"}`}
                  >
                    <MousePointerClick className="h-3 w-3" /> Click
                  </button>
                </div>
                <span className="text-muted-foreground font-mono uppercase tracking-widest">
                  {lassoMode === "click" ? "click on the part · shift-click = exclude" : "drag a loose outline around the part"}
                </span>
                <Button size="xs" variant="outline" onClick={resetTrim}>
                  <Undo2 className="h-3 w-3 mr-1" /> Reset marks
                </Button>
                <Button size="xs" onClick={onSnap} disabled={snapping}>
                  {snapping
                    ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Snapping…</>
                    : <><Scissors className="h-3 w-3 mr-1" /> Snap to part</>}
                </Button>
              </div>
            )}

            {stage === "meshing" && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2 rounded-md">
                <Box className="h-6 w-6 text-primary animate-pulse" />
                <span className="text-xs font-mono uppercase tracking-widest text-primary">
                  Meshing… {meshProgress}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* READY: GLB viewer */}
        {stage === "ready" && (
          <div
            ref={mountRef}
            className="w-full aspect-[4/3] rounded-md border border-border bg-surface-0 overflow-hidden"
          />
        )}

        {/* ERROR */}
        {stage === "error" && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs p-3 font-mono whitespace-pre-wrap">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Close
          </Button>

          {stage === "review" && (
            <>
              <Button variant="outline" onClick={() => runRender(undefined, true)}>
                <RotateCcw className="h-4 w-4 mr-1" /> Regenerate
              </Button>
              <Button onClick={onMakeMesh}>
                <Wand2 className="h-4 w-4 mr-1" /> Make 3D model
              </Button>
            </>
          )}

          {stage === "meshing" && (
            <Button disabled>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Meshing…
            </Button>
          )}

          {stage === "ready" && (
            <>
              <Button variant="outline" onClick={() => { const u = glbUrl; setGlbUrl(null); setTimeout(() => setGlbUrl(u), 50); }}>
                <RotateCcw className="h-4 w-4 mr-1" /> Reload viewer
              </Button>
              <Button onClick={onDownload}>
                <Download className="h-4 w-4 mr-1" /> Download STL
              </Button>
            </>
          )}

          {stage === "error" && (
            <Button
              onClick={async () => {
                try {
                  await purgeCachedMesh();
                  await runRender(undefined, true);
                } catch (e: any) {
                  toast({ title: "Cache clear failed", description: String(e.message ?? e), variant: "destructive" });
                }
              }}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Clear cache & retry
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
