/**
 * SculptStudioDialog — full-screen modal for sculpting a single library
 * mesh asset. Self-contained R3F canvas + brush controls + undo/redo +
 * Save (overwrite) and Save-as-variant (clone to new library_items row).
 *
 * Loads the asset from `item.asset_url` into a fresh THREE.Mesh, attaches a
 * `SculptEngine`, and intercepts pointer events on the mesh to apply
 * brush strokes. OrbitControls are disabled while the user is mid-stroke.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Undo2, Redo2, Save, Sparkles, FlipHorizontal2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { exportSceneToGLBBlob } from "@/lib/showroom/glb-export";
import { SculptEngine } from "@/lib/build-studio/sculpt/sculpt-engine";
import type { BrushKind } from "@/lib/build-studio/sculpt/brushes";
import type { LibraryItem } from "@/lib/repo";

const SCULPT_BUCKET = "frozen-parts";

interface Props {
  item: LibraryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LoadedMesh {
  mesh: THREE.Mesh;
  /** Wrapping group used for fitting/centring so the mesh starts at origin. */
  group: THREE.Group;
  /** Original asset bytes — used as fallback for "Cancel". */
  url: string;
}

async function loadAsMesh(url: string): Promise<LoadedMesh> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 4));
  let mesh: THREE.Mesh;
  if (head === "glTF") {
    const loader = new GLTFLoader();
    const gltf: any = await new Promise((resolve, reject) =>
      loader.parse(buf, "", resolve, reject),
    );
    // Find the largest mesh; multi-mesh kits sculpt the biggest panel.
    let biggest: THREE.Mesh | null = null;
    let biggestTris = -1;
    gltf.scene.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const tris = m.geometry.index
        ? m.geometry.index.count / 3
        : (m.geometry.attributes.position?.count ?? 0) / 3;
      if (tris > biggestTris) { biggestTris = tris; biggest = m; }
    });
    if (!biggest) throw new Error("GLB has no meshes");
    mesh = biggest;
    // Clone into standalone object so we render only the active mesh.
    const geo = (mesh as any).geometry.clone();
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xb8c2cc, metalness: 0.2, roughness: 0.55,
    }));
  } else {
    const loader = new STLLoader();
    const head1k = new TextDecoder().decode(buf.slice(0, 1024)).trim().toLowerCase();
    const isAscii = head1k.startsWith("solid") && head1k.includes("facet");
    const geo = isAscii
      ? loader.parse(new TextDecoder().decode(buf))
      : loader.parse(buf);
    geo.computeVertexNormals();
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xb8c2cc, metalness: 0.2, roughness: 0.55,
    }));
  }

  const group = new THREE.Group();
  group.add(mesh);
  // Centre + scale to ~1m for consistent brush-radius defaults.
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  group.scale.setScalar(1 / longest);
  group.position.copy(centre.multiplyScalar(-1 / longest));

  return { mesh, group, url };
}

function SculptScene({
  loaded,
  brush,
  radius,
  strength,
  mirror,
  engineRef,
  onStrokeCommitted,
  setHover,
}: {
  loaded: LoadedMesh;
  brush: BrushKind;
  radius: number;
  strength: number;
  mirror: boolean;
  engineRef: React.MutableRefObject<SculptEngine | null>;
  onStrokeCommitted: (changed: Uint32Array, before: Float32Array) => void;
  setHover: (info: { point: THREE.Vector3; normal: THREE.Vector3 } | null) => void;
}) {
  const { gl, camera } = useThree();
  const orbitRef = useRef<any>(null);
  const draggingRef = useRef(false);
  const strokeBeforeRef = useRef<Map<number, [number, number, number]> | null>(null);

  // Attach engine on first mount.
  useEffect(() => {
    engineRef.current = new SculptEngine(loaded.mesh);
    return () => { engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const onPointerDown = (e: any) => {
    if (!engineRef.current) return;
    e.stopPropagation();
    draggingRef.current = true;
    strokeBeforeRef.current = new Map();
    if (orbitRef.current) orbitRef.current.enabled = false;
    applyAt(e);
  };
  const onPointerMove = (e: any) => {
    if (!engineRef.current) return;
    setHover({ point: e.point.clone(), normal: e.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0) });
    if (!draggingRef.current) return;
    e.stopPropagation();
    applyAt(e);
  };
  const onPointerUp = (e: any) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (orbitRef.current) orbitRef.current.enabled = true;
    const eng = engineRef.current;
    if (!eng) return;
    const { changed } = eng.commitStroke();
    // Build "before" snapshot from stored map.
    if (changed.length && strokeBeforeRef.current) {
      const before = new Float32Array(changed.length * 3);
      for (let i = 0; i < changed.length; i++) {
        const v = strokeBeforeRef.current.get(changed[i]);
        if (v) {
          before[i * 3] = v[0];
          before[i * 3 + 1] = v[1];
          before[i * 3 + 2] = v[2];
        }
      }
      onStrokeCommitted(changed, before);
    }
    strokeBeforeRef.current = null;
  };

  const applyAt = (e: any) => {
    const eng = engineRef.current;
    if (!eng) return;
    // The hit point is in world space; convert to mesh-local for the engine
    // (which operates on the cloned geometry's local positions).
    const localCentre = loaded.mesh.worldToLocal(e.point.clone());
    // Approximate local normal: transform face normal by inverse normalMatrix.
    const worldNormal = (e.face?.normal as THREE.Vector3 | undefined)?.clone()
      ?? new THREE.Vector3(0, 1, 0);
    // face.normal is already in mesh-local for a Mesh hit; keep as-is.
    const localNormal = worldNormal.normalize();

    // Capture "before" for affected verts (only first time we touch them).
    const affected = eng.findAffected(localCentre, radius);
    if (strokeBeforeRef.current) {
      const positions = (eng.geometry.attributes.position.array as Float32Array);
      for (const i of affected) {
        if (!strokeBeforeRef.current.has(i)) {
          const o = i * 3;
          strokeBeforeRef.current.set(i, [positions[o], positions[o + 1], positions[o + 2]]);
        }
      }
    }
    eng.applyStroke(
      { centre: localCentre, surfaceNormal: localNormal, radius, strength, brush },
      { mirror },
    );
  };

  // Auto-frame the camera once on mount.
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(loaded.group);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 1.6;
    camera.position.set(centre.x + r, centre.y + r * 0.4, centre.z + r);
    (camera as THREE.PerspectiveCamera).near = r / 100;
    (camera as THREE.PerspectiveCamera).far = r * 100;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    orbitRef.current?.target?.copy(centre);
    orbitRef.current?.update?.();
  }, [loaded, camera]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 3]} intensity={1.0} />
      <directionalLight position={[-3, 2, -3]} intensity={0.4} color="#88aaff" />
      <Suspense fallback={null}>
        <Environment preset="warehouse" background={false} />
      </Suspense>
      <primitive
        object={loaded.group}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOut={() => setHover(null)}
      />
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.1} />
    </>
  );
}

function HoverCursor({
  hover,
  radius,
  meshGroup,
}: {
  hover: { point: THREE.Vector3; normal: THREE.Vector3 } | null;
  radius: number;
  meshGroup: THREE.Group;
}) {
  if (!hover) return null;
  // Convert local-space radius (mesh space) to world by mesh group scale.
  const worldRadius = radius * (meshGroup.scale.x || 1);
  return (
    <mesh position={hover.point} renderOrder={999}>
      <ringGeometry args={[worldRadius * 0.95, worldRadius, 48]} />
      <meshBasicMaterial color="#fb923c" transparent opacity={0.85} depthTest={false} />
    </mesh>
  );
}

export function SculptStudioDialog({ item, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [loaded, setLoaded] = useState<LoadedMesh | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brush, setBrush] = useState<BrushKind>("pull");
  const [radius, setRadius] = useState(0.06);
  const [strength, setStrength] = useState(0.25);
  const [mirror, setMirror] = useState(true);
  const [hover, setHover] = useState<{ point: THREE.Vector3; normal: THREE.Vector3 } | null>(null);
  const [saving, setSaving] = useState(false);
  const engineRef = useRef<SculptEngine | null>(null);

  // Per-stroke undo stack: stores changed indices + before/after positions.
  const undoStack = useRef<Array<{ indices: Uint32Array; before: Float32Array; after: Float32Array }>>([]);
  const redoStack = useRef<typeof undoStack.current>([]);
  const [, force] = useState(0);
  const tick = () => force((n) => n + 1);

  useEffect(() => {
    if (!open || !item?.asset_url) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoaded(null);
    undoStack.current = [];
    redoStack.current = [];
    loadAsMesh(item.asset_url).then(
      (l) => { if (!cancelled) { setLoaded(l); setLoading(false); } },
      (e) => { if (!cancelled) { setError(String(e?.message ?? e)); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, [open, item?.asset_url]);

  const handleStrokeCommitted = (changed: Uint32Array, before: Float32Array) => {
    const eng = engineRef.current;
    if (!eng || changed.length === 0) return;
    const after = eng.snapshotIndices(changed);
    undoStack.current.push({ indices: changed, before, after });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    tick();
  };

  const undo = () => {
    const entry = undoStack.current.pop();
    if (!entry || !engineRef.current) return;
    engineRef.current.restoreIndices(entry.indices, entry.before);
    redoStack.current.push(entry);
    tick();
  };
  const redo = () => {
    const entry = redoStack.current.pop();
    if (!entry || !engineRef.current) return;
    engineRef.current.restoreIndices(entry.indices, entry.after);
    undoStack.current.push(entry);
    tick();
  };

  const save = async (mode: "overwrite" | "variant") => {
    if (!item || !engineRef.current || !loaded || !user) return;
    setSaving(true);
    try {
      // Bake the live mesh to GLB by exporting just the mesh root.
      // We use the underlying mesh (un-scaled) so its geometry units are
      // preserved for downstream Build Studio.
      const blob = await exportSceneToGLBBlob(loaded.mesh);
      const path = `${user.id}/sculpt/${Date.now()}-${item.id}.glb`;
      const { error: upErr } = await supabase.storage
        .from(SCULPT_BUCKET)
        .upload(path, blob, { contentType: "model/gltf-binary", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(SCULPT_BUCKET).getPublicUrl(path);
      const newUrl = pub.publicUrl;

      if (mode === "overwrite") {
        const { error } = await (supabase as any)
          .from("library_items")
          .update({
            asset_url: newUrl,
            asset_mime: "model/gltf-binary",
            metadata: { ...(item.metadata ?? {}), sculpted: true, structure: undefined },
          })
          .eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("library_items").insert({
          user_id: user.id,
          kind: item.kind,
          title: `${item.title} (sculpted)`,
          thumbnail_url: item.thumbnail_url,
          asset_url: newUrl,
          asset_mime: "model/gltf-binary",
          project_id: item.project_id,
          concept_id: item.concept_id,
          metadata: { ...(item.metadata ?? {}), sculpted: true, sculpted_from: item.id, structure: undefined },
        });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["library_items"] });
      toast({ title: mode === "overwrite" ? "Sculpt saved" : "Saved as new variant" });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const triCount = engineRef.current?.triangleCount ?? 0;
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Sculpt Studio · {item?.title}
            {triCount > 0 && (
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground ml-2">
                {triCount.toLocaleString()} tris
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[1fr_280px] min-h-0">
          <div className="relative bg-surface-0">
            {loading && (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {error && (
              <div className="absolute inset-0 grid place-items-center text-sm text-destructive p-6 text-center">
                Failed to load mesh: {error}
              </div>
            )}
            {loaded && (
              <Canvas camera={{ fov: 40, position: [2, 1.2, 2] }} dpr={[1, 2]} shadows>
                <SculptScene
                  loaded={loaded}
                  brush={brush}
                  radius={radius}
                  strength={strength}
                  mirror={mirror}
                  engineRef={engineRef}
                  onStrokeCommitted={handleStrokeCommitted}
                  setHover={setHover}
                />
                <HoverCursor hover={hover} radius={radius} meshGroup={loaded.group} />
              </Canvas>
            )}
          </div>

          <div className="border-l border-border p-4 flex flex-col gap-4 overflow-y-auto">
            <div>
              <Label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Brush</Label>
              <ToggleGroup
                type="single"
                value={brush}
                onValueChange={(v) => v && setBrush(v as BrushKind)}
                className="mt-1.5 grid grid-cols-3 gap-1"
              >
                <ToggleGroupItem value="pull" className="text-xs">Pull</ToggleGroupItem>
                <ToggleGroupItem value="push" className="text-xs">Push</ToggleGroupItem>
                <ToggleGroupItem value="smooth" className="text-xs">Smooth</ToggleGroupItem>
                <ToggleGroupItem value="inflate" className="text-xs">Inflate</ToggleGroupItem>
                <ToggleGroupItem value="pinch" className="text-xs">Pinch</ToggleGroupItem>
                <ToggleGroupItem value="flatten" className="text-xs">Flatten</ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Radius</Label>
                <span className="text-mono text-[10px] text-muted-foreground">{radius.toFixed(3)}</span>
              </div>
              <Slider
                value={[radius]}
                min={0.005} max={0.4} step={0.005}
                onValueChange={(v) => setRadius(v[0])}
                className="mt-2"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Strength</Label>
                <span className="text-mono text-[10px] text-muted-foreground">{strength.toFixed(2)}</span>
              </div>
              <Slider
                value={[strength]}
                min={0.01} max={1.0} step={0.01}
                onValueChange={(v) => setStrength(v[0])}
                className="mt-2"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-surface-0/40 px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <FlipHorizontal2 className="h-3.5 w-3.5 text-primary" />
                Mirror X
              </div>
              <Switch checked={mirror} onCheckedChange={setMirror} />
            </div>

            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" className="flex-1" onClick={undo} disabled={!canUndo}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={redo} disabled={!canRedo}>
                <Redo2 className="mr-1 h-3.5 w-3.5" /> Redo
              </Button>
            </div>

            <div className="mt-auto space-y-2 pt-4 border-t border-border">
              <Button
                variant="hero" size="sm" className="w-full"
                disabled={saving || !canUndo}
                onClick={() => save("variant")}
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save as new variant"}
              </Button>
              <Button
                variant="outline" size="sm" className="w-full"
                disabled={saving || !canUndo}
                onClick={() => save("overwrite")}
              >
                Overwrite original
              </Button>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Sculpting edits the largest mesh in the file. Multi-mesh kits keep
                their other panels untouched. Save bakes the result into a new GLB
                in your library.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
