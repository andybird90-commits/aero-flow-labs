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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
  /** The on-screen concept render the user clicked from. Used to power the
   *  optional pre-render trim step so we can isolate the part BEFORE Gemini
   *  draws it. */
  sourceImageUrl?: string;
  /** Hotspot bounding box in normalised coordinates. When supplied alongside
   *  `sourceImageUrl`, we run an automatic isolation pass first so downstream
   *  AI only ever sees the chosen part. */
  bbox?: { x: number; y: number; w: number; h: number };
}

type Stage = "isolating" | "pretrim" | "rendering" | "review" | "meshing" | "ready" | "error";

interface RenderImage { angle: string; url: string }

export function ExtractedPartPreview({
  open, onClose, conceptId, kind, label, filenameBase, sourceImageUrl, bbox,
}: Props) {
  const { toast } = useToast();
  // When we have a bbox, kick off auto-isolation first. Otherwise fall back
  // to the legacy pretrim (lasso) or direct rendering path.
  const initialStage: Stage =
    bbox && sourceImageUrl ? "isolating" : sourceImageUrl ? "pretrim" : "rendering";
  const [stage, setStage] = useState<Stage>(initialStage);
  const [images, setImages] = useState<RenderImage[]>([]);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** AI-isolated crop of just the picked part. Replaces `sourceImageUrl` in
   *  the "On car" pane and is sent as the sole reference to render-isolated-part. */
  const [isolatedUrl, setIsolatedUrl] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  // Pre-render trim state (lasso on the original concept image)
  const [preLassoMode, setPreLassoMode] = useState<LassoMode>("lasso");
  const [prePoints, setPrePoints] = useState<LassoClick[]>([]);
  const [preLasso, setPreLasso] = useState<LassoPoint[]>([]);
  const [preMaskedUrl, setPreMaskedUrl] = useState<string | null>(null);
  const [preSnapping, setPreSnapping] = useState(false);

  // Post-render trim / edge-snap state (lasso on the AI-drawn render)
  const [trimOpen, setTrimOpen] = useState(false);
  const [lassoMode, setLassoMode] = useState<LassoMode>("lasso");
  const [trimPoints, setTrimPoints] = useState<LassoClick[]>([]);
  const [trimLasso, setTrimLasso] = useState<LassoPoint[]>([]);
  const [maskedUrl, setMaskedUrl] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(false);

  // Reset trim state whenever the dialog opens or the underlying render changes.
  useEffect(() => {
    if (!open) return;
    setStage(bbox && sourceImageUrl ? "isolating" : sourceImageUrl ? "pretrim" : "rendering");
    setIsolatedUrl(null);
    setTrimOpen(false);
    setTrimPoints([]);
    setTrimLasso([]);
    setMaskedUrl(null);
    setPrePoints([]);
    setPreLasso([]);
    setPreMaskedUrl(null);
  }, [open, conceptId, kind, sourceImageUrl, bbox]);

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
  // Pass `overrideSourceUrl` (typically a pre-trimmed crop) to push only that
  // image to Gemini as the sole reference.
  const runRender = async (
    signal?: { cancelled: boolean },
    force = false,
    overrideSourceUrl?: string,
  ) => {
    setStage("rendering");
    setImages([]);
    setGlbUrl(null);
    setError(null);
    try {
      // Trimmed renders bypass the cache — they're a different input.
      if (!force && !overrideSourceUrl) {
        const hit = await loadFromCache(signal);
        if (hit) return;
        if (signal?.cancelled) return;
      }
      const { data, error } = await supabase.functions.invoke("render-isolated-part", {
        body: {
          concept_id: conceptId,
          part_kind: kind,
          label,
          ...(overrideSourceUrl ? { source_image_url: overrideSourceUrl } : {}),
        },
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

  // Auto-run the AI render only when there's no source image to pre-trim
  // AND no bbox to auto-isolate. When sourceImageUrl is supplied we land on
  // the "pretrim" or "isolating" stage instead.
  useEffect(() => {
    if (!open) return;
    if (sourceImageUrl) return; // user drives the flow from pretrim/isolating
    const signal = { cancelled: false };
    runRender(signal);
    return () => { signal.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conceptId, kind, label, sourceImageUrl]);

  // Auto-isolate the picked part when bbox + sourceImageUrl are present.
  // On success → flow straight into rendering with the isolated crop.
  // On failure → drop into the existing manual lasso pretrim.
  useEffect(() => {
    if (!open || !bbox || !sourceImageUrl) return;
    if (stage !== "isolating") return;
    const signal = { cancelled: false };
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("isolate-picked-part", {
          body: {
            concept_id: conceptId,
            part_kind: kind,
            part_label: label,
            source_image_url: sourceImageUrl,
            bbox,
          },
        });
        if (signal.cancelled) return;
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const url = (data as any)?.isolated_url as string | undefined;
        if (!url) throw new Error("No isolated URL returned");
        setIsolatedUrl(url);
        runRender(signal, true, url);
      } catch (e: any) {
        if (signal.cancelled) return;
        const msg = String(e.message ?? e);
        toast({
          title: "Auto-isolate failed",
          description: `${msg} — outline the part manually.`,
          variant: "destructive",
        });
        setStage("pretrim");
      }
    })();
    return () => { signal.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bbox, sourceImageUrl, stage, conceptId, kind, label]);

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
      if ((data as any)?.fallback) {
        throw new Error((data as any)?.error || "Could not snap to the part from that selection.");
      }
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

  const resetPreTrim = () => { setPrePoints([]); setPreLasso([]); };

  // PRE-RENDER trim — runs SAM on the original concept image so Gemini only
  // sees the isolated part, not the whole car.
  const onPreSnap = async () => {
    if (!sourceImageUrl) return;
    if (prePoints.length === 0 && preLasso.length < 3) {
      toast({
        title: "Mark the part first",
        description: "Click on the part or draw a rough outline around it.",
        variant: "destructive",
      });
      return;
    }
    setPreSnapping(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-part", {
        body: {
          image_url: sourceImageUrl,
          points: prePoints,
          lasso: preLasso,
          concept_id: conceptId,
          part_kind: `${kind}-pretrim`,
        },
      });
      if (error) throw error;
      if ((data as any)?.fallback) {
        throw new Error((data as any)?.error || "Could not snap to the part from that selection.");
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any).masked_url as string;
      if (!url) throw new Error("No masked image returned");
      setPreMaskedUrl(url);
      toast({ title: "Trimmed", description: "Click 'Render with this crop' to send it to the AI." });
    } catch (e: any) {
      toast({ title: "Snap failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setPreSnapping(false);
    }
  };

  // Continue from pretrim into the AI render. If `useTrim` is true, push the
  // SAM-masked crop as the override source.
  const continueFromPretrim = (useTrim: boolean) => {
    const signal = { cancelled: false };
    runRender(signal, true, useTrim ? preMaskedUrl ?? undefined : undefined);
  };

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

      (async () => {
        try {
          const resp = await fetch(glbUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          if (cancelled) return;

          // Detect format: GLB starts with "glTF" magic bytes; otherwise STL.
          const head4 = new TextDecoder().decode(buf.slice(0, 4));
          const isGlb = head4 === "glTF";

          let model: THREE.Object3D;
          if (isGlb) {
            const gltfLoader = new GLTFLoader();
            const gltf: any = await new Promise((resolve, reject) =>
              gltfLoader.parse(buf, "", resolve, reject),
            );
            model = gltf.scene;
            const clay = new THREE.MeshStandardMaterial({
              color: 0xb8c2cc, metalness: 0.2, roughness: 0.6,
            });
            model.traverse((o) => {
              const m = o as THREE.Mesh;
              if (m.isMesh) m.material = clay;
            });
          } else {
            const stlLoader = new STLLoader();
            const head = new TextDecoder().decode(buf.slice(0, 1024)).trim().toLowerCase();
            const isAscii = head.startsWith("solid") && head.includes("facet");
            const geometry = isAscii
              ? stlLoader.parse(new TextDecoder().decode(buf))
              : stlLoader.parse(buf);
            geometry.computeVertexNormals();
            const material = new THREE.MeshStandardMaterial({
              color: 0xb8c2cc, metalness: 0.2, roughness: 0.6,
            });
            model = new THREE.Mesh(geometry, material);
          }
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
          console.error("Mesh load failed", err);
          purgeCachedMesh().catch((purgeErr) => console.error("Failed to purge cached mesh", purgeErr));
          setError("Cached mesh failed to load. Cache cleared — regenerate the part mesh.");
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
      <DialogContent className="max-w-[96vw] w-[96vw] sm:max-w-[92vw] h-[94vh] flex flex-col">
        <DialogHeader>
          {titleLine}
          <DialogDescription>
            {stage === "pretrim"   && "Optional: lasso the part on the original image so the AI only sees that crop. Or skip and render the full view."}
            {stage === "rendering" && "Drawing the part on a clean white background…"}
            {stage === "review"    && "Review the render. Regenerate if it looks generic, or turn it into a 3D model."}
            {stage === "meshing"   && "Building 3D mesh — usually 1-3 minutes."}
            {stage === "ready"     && "Mesh ready. Spin it around, then download."}
            {stage === "error"     && "Something went wrong. See details below."}
          </DialogDescription>
        </DialogHeader>

        {/* PRETRIM: lasso on the original concept image, before AI render */}
        {stage === "pretrim" && sourceImageUrl && (
          <div className="space-y-2 flex-1 min-h-0 flex flex-col">
            <div className="flex justify-center flex-1 min-h-0">
              <div className="relative w-full h-full rounded-md border border-border bg-surface-0 overflow-hidden flex items-center justify-center">
                {preMaskedUrl ? (
                  <>
                    <img
                      src={preMaskedUrl}
                      alt="Trimmed crop"
                      className="w-full h-full object-contain"
                    />
                    <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1 py-0.5 rounded">
                      trimmed crop
                    </span>
                  </>
                ) : (
                  <PartLasso
                    imageUrl={sourceImageUrl}
                    mode={preLassoMode}
                    points={prePoints}
                    lasso={preLasso}
                    onChange={({ points, lasso }) => { setPrePoints(points); setPreLasso(lasso); }}
                    className="w-full h-full"
                  />
                )}
              </div>
            </div>

            {!preMaskedUrl && (
              <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
                <div className="inline-flex rounded-md border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPreLassoMode("lasso")}
                    className={`px-2 py-1 inline-flex items-center gap-1 ${preLassoMode === "lasso" ? "bg-primary text-primary-foreground" : "bg-surface-1 text-muted-foreground"}`}
                  >
                    <Lasso className="h-3 w-3" /> Lasso
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreLassoMode("click")}
                    className={`px-2 py-1 inline-flex items-center gap-1 ${preLassoMode === "click" ? "bg-primary text-primary-foreground" : "bg-surface-1 text-muted-foreground"}`}
                  >
                    <MousePointerClick className="h-3 w-3" /> Click
                  </button>
                </div>
                <span className="text-muted-foreground font-mono uppercase tracking-widest">
                  {preLassoMode === "click" ? "click on the part · shift-click = exclude" : "drag a loose outline around the part"}
                </span>
                <Button size="xs" variant="outline" onClick={resetPreTrim}>
                  <Undo2 className="h-3 w-3 mr-1" /> Reset marks
                </Button>
                <Button size="xs" onClick={onPreSnap} disabled={preSnapping}>
                  {preSnapping
                    ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Snapping…</>
                    : <><Scissors className="h-3 w-3 mr-1" /> Snap to part</>}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* RENDERING / REVIEW / MESHING / READY: 3-pane comparison —
            on-car | extracted (AI render or trim tool) | 3D mesh. The 3D pane
            shows a meshing/idle placeholder until the GLB is ready. */}
        {(stage === "rendering" || stage === "review" || stage === "meshing" || stage === "ready") && (
          <div className="relative flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 grid gap-2 grid-rows-3 md:grid-rows-1 md:grid-cols-3">
              {/* Pane 1 — On car (original concept reference) */}
              <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden flex items-center justify-center">
                {sourceImageUrl ? (
                  <img
                    src={sourceImageUrl}
                    alt="Original part on car"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-widest">
                    No reference image
                  </div>
                )}
                <span className="absolute top-1 left-1 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
                  On car
                </span>
              </div>

              {/* Pane 2 — Extracted / drawn part (or trim tool) */}
              <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden flex items-center justify-center">
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
                <span className="absolute top-1 left-1 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
                  Extracted
                </span>
              </div>

              {/* Pane 3 — 3D mesh (or placeholder while not ready) */}
              <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden flex items-center justify-center">
                {stage === "ready" && glbUrl ? (
                  <div ref={mountRef} className="w-full h-full" />
                ) : stage === "meshing" ? (
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <Box className="h-6 w-6 animate-pulse" />
                    <span className="text-[10px] font-mono uppercase tracking-widest">
                      Meshing… {meshProgress}%
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <Box className="h-6 w-6 opacity-40" />
                    <span className="text-[9px] font-mono uppercase tracking-widest">
                      {stage === "rendering" ? "Waiting for render…" : "Click \"Make 3D model\""}
                    </span>
                  </div>
                )}
                <span className="absolute top-1 left-1 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
                  3D mesh
                </span>
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
          </div>
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

          {stage === "pretrim" && (
            <>
              {preMaskedUrl ? (
                <>
                  <Button variant="ghost" onClick={() => setPreMaskedUrl(null)}>
                    <Undo2 className="h-4 w-4 mr-1" /> Re-mark
                  </Button>
                  <Button onClick={() => continueFromPretrim(true)}>
                    <Wand2 className="h-4 w-4 mr-1" /> Render with this crop
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => continueFromPretrim(false)}>
                  Skip trim & render full view
                </Button>
              )}
            </>
          )}

          {stage === "review" && (
            <>
              <Button variant="outline" onClick={() => runRender(undefined, true)}>
                <RotateCcw className="h-4 w-4 mr-1" /> Regenerate
              </Button>
              {!trimOpen ? (
                <Button variant="outline" onClick={() => setTrimOpen(true)}>
                  <Scissors className="h-4 w-4 mr-1" /> {maskedUrl ? "Re-trim" : "Trim"}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setTrimOpen(false)}>
                  <X className="h-4 w-4 mr-1" /> Done trimming
                </Button>
              )}
              {maskedUrl && !trimOpen && (
                <Button variant="ghost" onClick={clearMask}>
                  <Undo2 className="h-4 w-4 mr-1" /> Use original
                </Button>
              )}
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
