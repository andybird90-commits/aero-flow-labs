/**
 * AdminCarPaintMap — full-screen 3D editor for curating per-triangle paint
 * tags on a hero STL. Admins use this once per car so end-users get correctly
 * tagged wheels/tyres/glass with zero work on their side.
 *
 * Tools:
 *   - Brush      — drag a circular NDC region, paints front-facing tris.
 *   - Wheel ring — click on a wheel hub: paints inner disc as wheel, outer
 *                  ring as tyre using a single 3D sphere query.
 *   - Glass lasso — click to drop polygon points, double-click closes.
 *   - Reset to auto — re-runs the geometric classifier.
 *
 * Save persists `method = 'manual'`; the consumer hook respects it and never
 * overwrites a manual map.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin, useSignedCarStlUrl } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useCarMaterialMap, decodeTagBlob } from "@/lib/build-studio/use-car-material-map";
import {
  TAG_BODY, TAG_GLASS, TAG_WHEEL, TAG_TYRE,
  TAG_LABELS, TAG_COLORS,
  type Tag,
  TagHistory, encodeTagsB64, computeStats,
  computeCentroids, paintByPolygon, paintBySphere, mirrorPaint,
} from "@/lib/build-studio/paint-map-edit";
import type { CarStl, CarTemplate } from "@/lib/repo";
import {
  Loader2, ArrowLeft, Save, Undo2, Redo2, Check, AlertTriangle,
  Brush, CircleDashed, Lasso, Sparkles, FlipHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ToolKind = "brush" | "wheel" | "lasso";

export default function AdminCarPaintMap() {
  const { carStlId = "" } = useParams<{ carStlId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);

  if (authLoading || roleLoading) {
    return (
      <AppLayout>
        <div className="grid place-items-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </AppLayout>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/settings/car-stls" replace />;

  return (
    <AppLayout>
      <PaintMapEditorScreen carStlId={carStlId} />
    </AppLayout>
  );
}

function PaintMapEditorScreen({ carStlId }: { carStlId: string }) {
  const nav = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Load car_stl row + template
  const { data: row, isLoading: rowLoading } = useQuery({
    queryKey: ["car_stl_row", carStlId],
    enabled: !!carStlId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("car_stls")
        .select("*, car_template:car_templates(*)")
        .eq("id", carStlId)
        .maybeSingle();
      if (error) throw error;
      return data as (CarStl & { car_template: CarTemplate | null }) | null;
    },
  });
  const { data: stlUrl } = useSignedCarStlUrl(row ?? null);
  const { map, tags: existingTags, loading: mapLoading } = useCarMaterialMap(carStlId);

  // Local working tags + history
  const [tags, setTags] = useState<Uint8Array | null>(null);
  const historyRef = useRef(new TagHistory(40));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);

  // Tool state
  const [tool, setTool] = useState<ToolKind>("brush");
  const [activeTag, setActiveTag] = useState<Tag>(TAG_BODY);
  const [brushRadius, setBrushRadius] = useState(40); // px (NDC mapped)
  const [mirrorMode, setMirrorMode] = useState(false);

  // Geometry data once STL loads
  const [geomBundle, setGeomBundle] = useState<{
    geom: THREE.BufferGeometry;
    centroids: Float32Array;
    triCount: number;
    worldMatrix: THREE.Matrix4;
  } | null>(null);

  // Initialize tags from server map
  useEffect(() => {
    if (existingTags && !tags) {
      const copy = new Uint8Array(existingTags);
      setTags(copy);
      historyRef.current.reset(copy);
    }
  }, [existingTags, tags]);

  const commitTags = (next: Uint8Array) => {
    setTags(next);
    historyRef.current.push(next);
    setDirty(true);
  };

  const undo = () => {
    const t = historyRef.current.undo();
    if (t) { setTags(t); setDirty(true); }
  };
  const redo = () => {
    const t = historyRef.current.redo();
    if (t) { setTags(t); setDirty(true); }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (e.key === "1") setActiveTag(TAG_BODY);
      else if (e.key === "2") setActiveTag(TAG_GLASS);
      else if (e.key === "3") setActiveTag(TAG_WHEEL);
      else if (e.key === "4") setActiveTag(TAG_TYRE);
      else if (e.key.toLowerCase() === "b") setTool("brush");
      else if (e.key.toLowerCase() === "w") setTool("wheel");
      else if (e.key.toLowerCase() === "l") setTool("lasso");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Save
  const onSave = async () => {
    if (!tags || !carStlId) return;
    setSaving(true);
    try {
      const { error } = await supabase.functions.invoke("save-car-material-map", {
        body: {
          car_stl_id: carStlId,
          tags_b64: encodeTagsB64(tags),
          triangle_count: tags.length,
          stats: computeStats(tags),
        },
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["car_material_map", carStlId] });
      setDirty(false);
      toast({ title: "Paint map saved", description: "End users will now see this map immediately." });
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const onResetToAuto = async () => {
    if (!confirm("Re-run the automatic classifier? Your manual edits will be replaced (you can undo).")) return;
    setReclassifying(true);
    try {
      const { error } = await supabase.functions.invoke("classify-car-materials", {
        body: { car_stl_id: carStlId, force: true },
      });
      if (error) throw error;
      const { data } = await supabase
        .from("car_material_maps")
        .select("*")
        .eq("car_stl_id", carStlId)
        .maybeSingle();
      if (data?.tag_blob_b64) {
        const fresh = decodeTagBlob(data.tag_blob_b64);
        commitTags(fresh);
        toast({ title: "Auto-classified", description: "Review and save when ready." });
      }
    } catch (e: any) {
      toast({ title: "Re-classify failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setReclassifying(false);
    }
  };

  const onMirror = () => {
    if (!tags || !geomBundle) return;
    const next = new Uint8Array(tags);
    mirrorPaint(next, geomBundle.centroids, "y");
    commitTags(next);
    toast({ title: "Mirrored across centerline" });
  };

  const onDone = () => {
    if (dirty && !confirm("You have unsaved edits. Leave anyway?")) return;
    nav("/settings/car-stls");
  };

  const stats = tags ? computeStats(tags) : null;
  const ready = !!stlUrl && !!tags && !!geomBundle;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      {/* Tools rail */}
      <aside className="w-64 shrink-0 border-r border-border bg-surface-1/40 p-3 overflow-y-auto">
        <Button variant="ghost" size="sm" className="mb-3 w-full justify-start" onClick={onDone}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to library
        </Button>

        <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Paint map editor</div>
        <h2 className="mt-1 text-sm font-semibold tracking-tight truncate">
          {row?.car_template ? `${row.car_template.make} ${row.car_template.model}` : "Hero STL"}
        </h2>
        <div className="mt-1 mb-3">
          {map ? (
            map.method === "manual" ? (
              <Badge variant="outline" className="border-success/40 text-success">
                <Check className="mr-1 h-3 w-3" /> Curated
              </Badge>
            ) : (
              <Badge variant="outline" className="border-warning/40 text-warning">
                <Sparkles className="mr-1 h-3 w-3" /> Auto-tagged
              </Badge>
            )
          ) : (
            <Badge variant="outline">No map yet</Badge>
          )}
        </div>

        {/* Tag picker */}
        <div className="space-y-1.5">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Active material (1–4)</div>
          {([TAG_BODY, TAG_GLASS, TAG_WHEEL, TAG_TYRE] as Tag[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(t)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition",
                activeTag === t ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2/50",
              )}
            >
              <span className="h-3 w-3 rounded-full border border-border/60" style={{ backgroundColor: TAG_COLORS[t] }} />
              <span className="font-medium">{TAG_LABELS[t]}</span>
              <span className="ml-auto text-mono text-[10px] text-muted-foreground">{t + 1}</span>
            </button>
          ))}
        </div>

        {/* Tool picker */}
        <div className="mt-4 space-y-1.5">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Tool</div>
          <ToolButton active={tool === "brush"} onClick={() => setTool("brush")} icon={<Brush className="h-3.5 w-3.5" />} label="Brush" hotkey="B" />
          <ToolButton active={tool === "wheel"} onClick={() => setTool("wheel")} icon={<CircleDashed className="h-3.5 w-3.5" />} label="Wheel ring" hotkey="W" />
          <ToolButton active={tool === "lasso"} onClick={() => setTool("lasso")} icon={<Lasso className="h-3.5 w-3.5" />} label="Lasso" hotkey="L" />
        </div>

        {tool === "brush" && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Brush size</span>
              <span className="text-mono text-[10px]">{brushRadius}px</span>
            </div>
            <Slider value={[brushRadius]} min={10} max={200} step={5} onValueChange={(v) => setBrushRadius(v[0])} />
          </div>
        )}

        {tool === "wheel" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Click on a wheel hub. Inner disc → wheel, outer ring → tyre. Active tag is ignored for this tool.
          </p>
        )}
        {tool === "lasso" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Click to add polygon points around glass / a region. Double-click to apply the active material.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between rounded-md border border-border px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            <FlipHorizontal className="h-3.5 w-3.5" /> Mirror L/R
          </div>
          <Switch checked={mirrorMode} onCheckedChange={setMirrorMode} />
        </div>
        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={onMirror} disabled={!ready}>
          Apply mirror to all tags
        </Button>

        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={undo} disabled={!historyRef.current.canUndo()}>
            <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={redo} disabled={!historyRef.current.canRedo()}>
            <Redo2 className="mr-1 h-3.5 w-3.5" /> Redo
          </Button>
        </div>

        <Button variant="ghost" size="sm" className="mt-2 w-full text-warning hover:bg-warning/10" onClick={onResetToAuto} disabled={reclassifying}>
          {reclassifying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Reset to auto
        </Button>

        {stats && (
          <div className="mt-4 space-y-1 rounded-md border border-border bg-surface-2/30 p-2 text-xs">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Stats</div>
            {(["body", "glass", "wheel", "tyre"] as const).map((k, i) => (
              <div key={k} className="flex items-center justify-between">
                <span className="capitalize text-muted-foreground">{k}</span>
                <span className="text-mono text-[10px]">
                  {((stats[k] / stats.total) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
            <div className="border-t border-border pt-1 mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Triangles</span>
              <span className="text-mono text-[10px]">{stats.total.toLocaleString()}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Viewport */}
      <main className="relative flex-1 bg-background">
        {(rowLoading || mapLoading || !stlUrl) ? (
          <div className="grid h-full place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <PaintMapCanvas
            stlUrl={stlUrl}
            tags={tags}
            tool={tool}
            activeTag={activeTag}
            brushRadius={brushRadius}
            mirrorMode={mirrorMode}
            onPaint={commitTags}
            onGeomReady={setGeomBundle}
          />
        )}

        {/* Save bar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full border border-border bg-surface-1/95 px-2 py-1.5 shadow-lg backdrop-blur">
          {dirty ? (
            <Badge variant="outline" className="border-warning/40 text-warning text-[10px]">
              <AlertTriangle className="mr-1 h-3 w-3" /> Unsaved
            </Badge>
          ) : map?.method === "manual" ? (
            <Badge variant="outline" className="border-success/40 text-success text-[10px]">
              <Check className="mr-1 h-3 w-3" /> Saved
            </Badge>
          ) : null}
          <Button variant="hero" size="sm" onClick={onSave} disabled={!dirty || saving || !ready}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
        </div>
      </main>
    </div>
  );
}

function ToolButton({ active, onClick, icon, label, hotkey }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hotkey: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition",
        active ? "border-primary bg-primary/10" : "border-border hover:bg-surface-2/50",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-mono text-[10px] text-muted-foreground">{hotkey}</span>
    </button>
  );
}

/* ───── 3D canvas ─────────────────────────────────────────── */

interface CanvasProps {
  stlUrl: string;
  tags: Uint8Array | null;
  tool: ToolKind;
  activeTag: Tag;
  brushRadius: number;
  mirrorMode: boolean;
  onPaint: (next: Uint8Array) => void;
  onGeomReady: (b: {
    geom: THREE.BufferGeometry;
    centroids: Float32Array;
    triCount: number;
    worldMatrix: THREE.Matrix4;
  }) => void;
}

function PaintMapCanvas(props: CanvasProps) {
  return (
    <Canvas shadows camera={{ position: [4, 2.5, 4], fov: 35 }} className="!h-full">
      <color attach="background" args={["#0b0f14"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.0} castShadow />
      <directionalLight position={[-5, 4, -3]} intensity={0.4} />
      <Environment preset="warehouse" />
      <gridHelper args={[20, 20, "#1f2937", "#1f2937"]} />
      <PaintMesh {...props} />
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}

function PaintMesh({ stlUrl, tags, tool, activeTag, brushRadius, mirrorMode, onPaint, onGeomReady }: CanvasProps) {
  const { camera, gl, size } = useThree();
  const meshRef = useRef<THREE.Mesh | null>(null);
  const wrapperRef = useRef<THREE.Group | null>(null);
  const centroidsRef = useRef<Float32Array | null>(null);
  const baseGeomRef = useRef<THREE.BufferGeometry | null>(null);

  const [object, setObject] = useState<THREE.Object3D | null>(null);

  // Lasso state (NDC coords)
  const lassoRef = useRef<Array<[number, number]>>([]);
  const [lassoPath, setLassoPath] = useState<Array<[number, number]>>([]);

  // Brush drag
  const draggingRef = useRef(false);

  // Load STL once
  useEffect(() => {
    let cancelled = false;
    const loader = new STLLoader();
    loader.load(stlUrl, (geo) => {
      if (cancelled) return;
      geo.computeVertexNormals();
      baseGeomRef.current = geo;

      const triCount = geo.attributes.position.count / 3;

      // Add colour attribute (debug colours per triangle)
      const colors = new Float32Array(triCount * 3 * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      // Wrap and normalise: STL is Z-up, scale to ~4.5m long
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        vertexColors: true, metalness: 0.0, roughness: 0.85, flatShading: false,
      }));
      meshRef.current = mesh;
      mesh.rotation.x = -Math.PI / 2;
      const wrapper = new THREE.Group();
      wrapper.add(mesh);

      const box = new THREE.Box3().setFromObject(wrapper);
      const sizeVec = new THREE.Vector3();
      box.getSize(sizeVec);
      const longest = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
      if (isFinite(longest) && longest > 0) wrapper.scale.setScalar(4.5 / longest);
      const box2 = new THREE.Box3().setFromObject(wrapper);
      const center = new THREE.Vector3();
      box2.getCenter(center);
      wrapper.position.sub(center);
      const box3 = new THREE.Box3().setFromObject(wrapper);
      wrapper.position.y -= box3.min.y;
      wrapperRef.current = wrapper;

      // Compute centroids in MESH-LOCAL coordinates (we'll transform query
      // points instead — keeps the buffer immutable as the camera moves).
      const c = computeCentroids(geo);
      centroidsRef.current = c.centroids;

      mesh.updateMatrixWorld(true);
      onGeomReady({
        geom: geo,
        centroids: c.centroids,
        triCount: c.triCount,
        worldMatrix: mesh.matrixWorld.clone(),
      });

      setObject(wrapper);
    });
    return () => { cancelled = true; };
  }, [stlUrl, onGeomReady]);

  // Repaint vertex colours whenever tags change
  useEffect(() => {
    const geo = baseGeomRef.current;
    if (!geo || !tags) return;
    const colorAttr = geo.getAttribute("color") as THREE.BufferAttribute;
    if (!colorAttr) return;
    const triCount = geo.attributes.position.count / 3;
    if (tags.length !== triCount) return;
    const palette: [number, number, number][] = [
      hexToRgb(TAG_COLORS[0]),
      hexToRgb(TAG_COLORS[1]),
      hexToRgb(TAG_COLORS[2]),
      hexToRgb(TAG_COLORS[3]),
    ];
    const arr = colorAttr.array as Float32Array;
    for (let t = 0; t < triCount; t++) {
      const [r, g, b] = palette[Math.min(3, Math.max(0, tags[t]))];
      const o = t * 9;
      for (let k = 0; k < 3; k++) {
        arr[o + k * 3]     = r;
        arr[o + k * 3 + 1] = g;
        arr[o + k * 3 + 2] = b;
      }
    }
    colorAttr.needsUpdate = true;
  }, [tags]);

  // Pointer interactions
  useEffect(() => {
    const dom = gl.domElement;

    const ndc = (e: PointerEvent | MouseEvent) => {
      const r = dom.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * 2 - 1,
        y: -(((e.clientY - r.top) / r.height) * 2 - 1),
      };
    };

    const buildVP = () => {
      const mesh = meshRef.current;
      if (!mesh) return null;
      mesh.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const m = new THREE.Matrix4();
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      m.multiply(mesh.matrixWorld);
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      // Convert camDir to mesh-local space for normal-cull math
      const inv = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
      const localCam = camDir.clone().applyMatrix3(inv).normalize();
      return { matrix: m, localCam };
    };

    const raycastTriangle = (e: PointerEvent) => {
      const mesh = meshRef.current;
      if (!mesh) return null;
      const p = ndc(e);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
      const hits = ray.intersectObject(mesh, false);
      if (!hits.length) return null;
      return { point: hits[0].point.clone(), face: hits[0].faceIndex ?? -1 };
    };

    const paintBrush = (e: PointerEvent) => {
      if (!tags || !centroidsRef.current) return;
      const vp = buildVP();
      if (!vp) return;
      const p = ndc(e);
      const rNDC = brushRadius / Math.min(size.width, size.height);
      // Build small NDC circle polygon around cursor
      const N = 24;
      const poly: Array<[number, number]> = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        poly.push([p.x + Math.cos(a) * rNDC, p.y + Math.sin(a) * rNDC]);
      }
      const next = new Uint8Array(tags);
      const painted = paintByPolygon(next, centroidsRef.current, baseGeomRef.current!, vp.matrix, vp.localCam, poly, activeTag);
      if (mirrorMode) mirrorPaint(next, centroidsRef.current, "y");
      if (painted > 0 || mirrorMode) onPaint(next);
    };

    const paintWheel = (e: PointerEvent) => {
      if (!tags || !centroidsRef.current) return;
      const hit = raycastTriangle(e);
      if (!hit) return;
      // Convert hit point to mesh-local
      const local = hit.point.clone();
      meshRef.current!.worldToLocal(local);
      // Auto radius based on car bbox: tyre OD ≈ length * 0.16
      const bbox = new THREE.Box3().setFromBufferAttribute(baseGeomRef.current!.attributes.position as THREE.BufferAttribute);
      const len = Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z);
      const tyreR = len * 0.16;
      const wheelR = tyreR * 0.62;
      const next = new Uint8Array(tags);
      // Outer ring → tyre
      paintBySphere(next, centroidsRef.current, local, tyreR, TAG_TYRE, wheelR);
      // Inner disc → wheel
      paintBySphere(next, centroidsRef.current, local, wheelR, TAG_WHEEL);
      if (mirrorMode) mirrorPaint(next, centroidsRef.current, "y");
      onPaint(next);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement) !== dom) return;
      if (e.shiftKey) return; // let orbit handle pan
      if (tool === "brush") {
        e.preventDefault();
        draggingRef.current = true;
        dom.setPointerCapture(e.pointerId);
        paintBrush(e);
      } else if (tool === "wheel") {
        e.preventDefault();
        paintWheel(e);
      } else if (tool === "lasso") {
        e.preventDefault();
        const p = ndc(e);
        const next = [...lassoRef.current, [p.x, p.y] as [number, number]];
        lassoRef.current = next;
        setLassoPath(next);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (tool === "brush" && draggingRef.current) {
        paintBrush(e);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (draggingRef.current) {
        draggingRef.current = false;
        try { dom.releasePointerCapture(e.pointerId); } catch {}
      }
    };
    const onDblClick = (e: MouseEvent) => {
      if (tool !== "lasso") return;
      if (lassoRef.current.length < 3) {
        lassoRef.current = [];
        setLassoPath([]);
        return;
      }
      const vp = buildVP();
      if (!vp || !tags || !centroidsRef.current) return;
      const next = new Uint8Array(tags);
      paintByPolygon(next, centroidsRef.current, baseGeomRef.current!, vp.matrix, vp.localCam, lassoRef.current, activeTag);
      if (mirrorMode) mirrorPaint(next, centroidsRef.current, "y");
      onPaint(next);
      lassoRef.current = [];
      setLassoPath([]);
    };

    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("dblclick", onDblClick);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("dblclick", onDblClick);
    };
  }, [tool, activeTag, brushRadius, mirrorMode, tags, camera, gl, size.width, size.height, onPaint]);

  return (
    <>
      {object && <primitive object={object} />}
      {/* Lasso preview overlay (in-canvas using HTML wouldn't work; use SVG outside) */}
      <LassoOverlay path={lassoPath} />
    </>
  );
}

function LassoOverlay({ path }: { path: Array<[number, number]> }) {
  // Renders nothing in 3D; the SVG overlay is drawn outside the Canvas.
  // Synced via a custom event for simplicity.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("paintmap-lasso", { detail: path }));
  }, [path]);
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
