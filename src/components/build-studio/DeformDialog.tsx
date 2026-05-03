/**
 * DeformDialog — interactive mesh deformation with handle-based proportional editing.
 *
 * Opens as a full dialog over the build studio. Shows a 3D viewport of the
 * part with draggable handles. Saving exports the deformed mesh, generates
 * a thumbnail, and creates a user_generated_parts row.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { STLLoader, GLTFLoader } from "three-stdlib";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Loader2, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { LibraryItem } from "@/lib/repo";
import {
  type DeformHandle,
  applyHandles,
  serializeHandles,
  deserializeHandles,
  type SerializedHandle,
} from "@/lib/build-studio/deform";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  libraryItem: LibraryItem;
  userId: string | null;
  onSaved: (newPartId: string, newMeshUrl: string) => void;
  curvePoints?: THREE.Vector3[];
  onCurveMatchActiveChange?: (active: boolean) => void;
  onClearCurvePoints?: () => void;
}

// ── Inner 3D scene ──────────────────────────────────────────────────────────

interface SceneProps {
  originalGeom: THREE.BufferGeometry | null;
  handles: DeformHandle[];
  selectedHandleId: string | null;
  addingHandle: boolean;
  onHandleSelect: (id: string) => void;
  onHandleMove: (id: string, newWorldPos: THREE.Vector3) => void;
  onMeshClick: (worldPos: THREE.Vector3) => void;
  meshWorldMatrix: THREE.Matrix4;
  onEdgeClick?: (point: THREE.Vector3) => void;
}

function DeformScene({
  originalGeom, handles, selectedHandleId, addingHandle,
  onHandleSelect, onHandleMove, onMeshClick, meshWorldMatrix, onEdgeClick,
}: SceneProps) {
  const { camera, gl } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const [deformedGeom, setDeformedGeom] = useState<THREE.BufferGeometry | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef<string | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const handlesRef = useRef(handles);
  useEffect(() => { handlesRef.current = handles; }, [handles]);

  // Coalesce rapid handle updates into one recompute per animation frame.
  // Without this, dragging a handle re-deforms 66k+ vertices on every
  // mousemove event and freezes the UI.
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ geom: THREE.BufferGeometry; handles: DeformHandle[]; mat: THREE.Matrix4 } | null>(null);
  useEffect(() => {
    if (!originalGeom) return;
    if (isDragging) return;
    pendingRef.current = { geom: originalGeom, handles, mat: meshWorldMatrix };
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const p = pendingRef.current;
      if (!p) return;
      const g = applyHandles(p.geom, p.handles, p.mat);
      setDeformedGeom((prev) => {
        prev?.dispose();
        return g;
      });
    });
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [originalGeom, handles, meshWorldMatrix, isDragging]);

  const getPixelToWorld = useCallback((handlePos: THREE.Vector3) => {
    const dist = camera.position.distanceTo(handlePos);
    const vFov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const worldHeight = 2 * dist * Math.tan(vFov / 2);
    return worldHeight / gl.domElement.clientHeight;
  }, [camera, gl]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current || !lastMouseRef.current) return;

    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return;

    const handle = handlesRef.current.find(h => h.id === draggingRef.current);
    if (!handle) return;

    const scale = getPixelToWorld(handle.position);

    const right = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();
    const up = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 1)
      .normalize();

    const delta = new THREE.Vector3()
      .addScaledVector(right, dx * scale)
      .addScaledVector(up, -dy * scale);

    const newPos = handle.position.clone().add(delta);
    onHandleMove(draggingRef.current, newPos);
  }, [camera, getPixelToWorld, onHandleMove]);

  const onMouseUp = useCallback(() => {
    draggingRef.current = null;
    lastMouseRef.current = null;
    setIsDragging(false);
    gl.domElement.style.cursor = "default";
  }, [gl]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  if (!deformedGeom) return null;

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={deformedGeom}
        onClick={(e) => {
          if (addingHandle) {
            e.stopPropagation();
            onMeshClick(e.point);
          } else if (onEdgeClick) {
            e.stopPropagation();
            onEdgeClick(e.point);
          }
        }}
      >
        <meshPhysicalMaterial
          color="#ffffff"
          metalness={0.1}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {handles.map((handle) => (
        <mesh
          key={handle.id}
          position={handle.position}
          onPointerDown={(e) => {
            e.stopPropagation();
            onHandleSelect(handle.id);
            draggingRef.current = handle.id;
            lastMouseRef.current = { x: e.clientX, y: e.clientY };
            setIsDragging(true);
            gl.domElement.style.cursor = "grabbing";
          }}
        >
          <sphereGeometry args={[0.012, 16, 16]} />
          <meshStandardMaterial
            color={selectedHandleId === handle.id ? "#f97316" : "#3b82f6"}
            emissive={selectedHandleId === handle.id ? "#f97316" : "#000000"}
            emissiveIntensity={selectedHandleId === handle.id ? 0.6 : 0}
            depthTest={false}
          />
        </mesh>
      ))}

      {handles
        .filter(h => h.id === selectedHandleId)
        .map(h => (
          <mesh key={`ring-${h.id}`} position={h.position} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[h.radius - 0.002, h.radius + 0.002, 48]} />
            <meshBasicMaterial color="#f97316" transparent opacity={0.5} side={THREE.DoubleSide} depthTest={false} />
          </mesh>
        ))}

      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 3]} intensity={1.2} castShadow />
      <directionalLight position={[-2, 2, -2]} intensity={0.4} />
      <Environment preset="studio" />
      <OrbitControls makeDefault enabled={!isDragging} />
    </>
  );
}

// ── Main dialog ─────────────────────────────────────────────────────────────

export function DeformDialog({
  open, onOpenChange, libraryItem, userId, onSaved,
  curvePoints, onCurveMatchActiveChange, onClearCurvePoints,
}: Props) {
  const [originalGeom, setOriginalGeom] = useState<THREE.BufferGeometry | null>(null);
  const [handles, setHandles] = useState<DeformHandle[]>([]);
  const [selectedHandleId, setSelectedHandleId] = useState<string | null>(null);
  const [addingHandle, setAddingHandle] = useState(false);
  const [influenceRadius, setInfluenceRadius] = useState(0.08);
  const [partName, setPartName] = useState(`${libraryItem.title} (custom)`);
  const [isSaving, setIsSaving] = useState(false);
  const [deformMode, setDeformMode] = useState<"handles" | "curvematch">("handles");
  const [selectedEdgePoint, setSelectedEdgePoint] = useState<THREE.Vector3 | null>(null);
  const meshWorldMatrix = useRef(new THREE.Matrix4()).current;

  // Reset name when item changes
  useEffect(() => {
    setPartName(`${libraryItem.title} (custom)`);
  }, [libraryItem.id, libraryItem.title]);

  // Load original mesh on open
  useEffect(() => {
    if (!open || !libraryItem.asset_url) return;
    const url = libraryItem.asset_url;
    const isStl = url.toLowerCase().split("?")[0].endsWith(".stl");

    if (isStl) {
      new STLLoader().load(url, (geo) => {
        geo.computeVertexNormals();
        const posAttr = geo.attributes.position as THREE.BufferAttribute;
        const box = new THREE.Box3().setFromBufferAttribute(posAttr);
        const size = new THREE.Vector3();
        box.getSize(size);
        const longest = Math.max(size.x, size.y, size.z);
        if (longest > 0 && longest > 1) {
          // STLs are often in mm — normalise to ~0.5m
          const scale = 0.5 / longest;
          const m = new THREE.Matrix4().makeScale(scale, scale, scale);
          geo.applyMatrix4(m);
        }
        setOriginalGeom(geo);
      });
    } else {
      new GLTFLoader().load(url, (gltf) => {
        const meshes: THREE.BufferGeometry[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((c) => {
          const m = c as THREE.Mesh;
          if ((m as any).isMesh && m.geometry) {
            const g = m.geometry.clone();
            g.applyMatrix4(m.matrixWorld);
            meshes.push(g);
          }
        });
        if (meshes.length === 0) return;
        const geo = meshes[0];
        geo.computeVertexNormals();
        setOriginalGeom(geo);
      });
    }

    // Load existing handles if re-editing
    const existingHandles = (libraryItem.metadata as any)?.deformation_handles as SerializedHandle[] | undefined;
    if (existingHandles?.length) {
      setHandles(deserializeHandles(existingHandles));
    } else {
      setHandles([]);
    }
    setSelectedHandleId(null);
  }, [open, libraryItem]);

  const addHandle = useCallback((worldPos: THREE.Vector3) => {
    const id = crypto.randomUUID();
    setHandles(prev => [...prev, {
      id,
      position: worldPos.clone(),
      radius: influenceRadius,
      offset: new THREE.Vector3(),
    }]);
    setSelectedHandleId(id);
    setAddingHandle(false);
  }, [influenceRadius]);

  const moveHandle = useCallback((id: string, newPos: THREE.Vector3) => {
    setHandles(prev => prev.map(h => {
      if (h.id !== id) return h;
      // Original placement = current position - current offset.
      // New offset = newPos - original placement.
      const origin = h.position.clone().sub(h.offset);
      const offset = newPos.clone().sub(origin);
      return { ...h, position: newPos.clone(), offset };
    }));
  }, []);

  const deleteHandle = useCallback((id: string) => {
    setHandles(prev => prev.filter(h => h.id !== id));
    setSelectedHandleId(null);
  }, []);

  const updateSelectedRadius = useCallback((radius: number) => {
    if (!selectedHandleId) return;
    setHandles(prev => prev.map(h =>
      h.id === selectedHandleId ? { ...h, radius } : h
    ));
  }, [selectedHandleId]);

  const exportDeformedGlb = async (): Promise<Blob> => {
    if (!originalGeom) throw new Error("No geometry loaded");
    const deformed = applyHandles(originalGeom, handles, meshWorldMatrix);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(deformed, mat);
    const scene = new THREE.Scene();
    scene.add(mesh);
    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        scene,
        (r) => resolve(r instanceof ArrayBuffer
          ? new Blob([r], { type: "model/gltf-binary" })
          : new Blob([JSON.stringify(r)], { type: "model/gltf+json" })),
        reject,
        { binary: true, embedImages: false, onlyVisible: true } as any,
      );
    });
  };

  const generateThumbnail = async (): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      if (!originalGeom) return reject(new Error("No geometry"));
      const w = 512, h = 512;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(w, h);
      renderer.setClearColor(0xffffff, 1);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffffff);

      const deformed = applyHandles(originalGeom, handles, meshWorldMatrix);
      const mat = new THREE.MeshPhysicalMaterial({ color: 0xdddddd, metalness: 0.1, roughness: 0.4 });
      const mesh = new THREE.Mesh(deformed, mat);
      scene.add(mesh);
      scene.add(new THREE.AmbientLight(0xffffff, 0.8));
      const dir = new THREE.DirectionalLight(0xffffff, 1.2);
      dir.position.set(2, 4, 3);
      scene.add(dir);

      const box = new THREE.Box3().setFromObject(mesh);
      const centre = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(centre);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);

      const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 100);
      camera.position.set(
        centre.x + maxDim * 1.2,
        centre.y + maxDim * 0.8,
        centre.z + maxDim * 1.2,
      );
      camera.lookAt(centre);

      renderer.render(scene, camera);
      renderer.domElement.toBlob((blob) => {
        renderer.dispose();
        if (blob) resolve(blob);
        else reject(new Error("Thumbnail generation failed"));
      }, "image/png");
    });
  };

  const handleSave = async () => {
    if (!userId) { toast.error("Not logged in"); return; }
    if (!libraryItem.asset_url) { toast.error("No source mesh URL"); return; }
    setIsSaving(true);
    try {
      const [glbBlob, thumbBlob] = await Promise.all([
        exportDeformedGlb(),
        generateThumbnail(),
      ]);

      const base = `${userId}/custom-parts/${Date.now()}`;

      const glbPath = `${base}/deformed.glb`;
      const { error: glbErr } = await supabase.storage
        .from("geometries")
        .upload(glbPath, glbBlob, { contentType: "model/gltf-binary", upsert: true });
      if (glbErr) throw new Error(`GLB upload failed: ${glbErr.message}`);
      const { data: glbUrl } = supabase.storage.from("geometries").getPublicUrl(glbPath);

      const thumbPath = `${base}/thumbnail.png`;
      const { error: thumbErr } = await supabase.storage
        .from("geometries")
        .upload(thumbPath, thumbBlob, { contentType: "image/png", upsert: true });
      if (thumbErr) throw new Error(`Thumbnail upload failed: ${thumbErr.message}`);
      const { data: thumbUrl } = supabase.storage.from("geometries").getPublicUrl(thumbPath);

      const { data: row, error: dbErr } = await (supabase as any)
        .from("user_generated_parts")
        .insert({
          user_id: userId,
          name: partName,
          original_mesh_url: libraryItem.asset_url,
          deformed_mesh_url: glbUrl.publicUrl,
          thumbnail_url: thumbUrl.publicUrl,
          deformation_handles: serializeHandles(handles),
        })
        .select()
        .single();
      if (dbErr) throw new Error(`DB insert failed: ${dbErr.message}`);

      toast.success("Custom part saved to your library");
      onSaved(row.id, glbUrl.publicUrl);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message ?? "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const selectedHandle = handles.find(h => h.id === selectedHandleId) ?? null;

  // While tracing the curve on the car, the modal dialog (and its overlay)
  // would block clicks from reaching the main viewport. We swap to a compact
  // floating bar so the user can actually click the car body underneath.
  const tracing = deformMode === "curvematch" && (curvePoints?.length ?? 0) >= 0 &&
    (curvePoints !== undefined) && (
      // active = panel set curveMatchActive true; we infer via a local flag
      false
    );

  // Local "is tracing" flag — set true when user presses Start tracing.
  // We track it here so we can collapse the dialog.
  // (Mirrors curveMatchActive on the parent.)
  const [isTracing, setIsTracing] = useState(false);
  useEffect(() => { if (!open) setIsTracing(false); }, [open]);

  if (open && isTracing) {
    return (
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-border bg-background/95 backdrop-blur-md shadow-2xl px-4 py-3 flex items-center gap-3">
        <div className="text-xs">
          <div className="font-medium">Tracing curve on car</div>
          <div className="text-muted-foreground text-[10px]">
            Click points along the target curve. {(curvePoints?.length ?? 0)} placed.
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => { onClearCurvePoints?.(); }}
        >
          Clear
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs"
          onClick={() => {
            setIsTracing(false);
            onCurveMatchActiveChange?.(false);
          }}
        >
          Done — back to dialog
        </Button>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCurveMatchActiveChange?.(false);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-6xl h-[80vh] p-0 flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm">Deform Part — {libraryItem.title}</DialogTitle>
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                className={`px-3 py-1 text-xs ${deformMode === "handles" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                onClick={() => { setDeformMode("handles"); onCurveMatchActiveChange?.(false); }}
              >
                Handles
              </button>
              <button
                className={`px-3 py-1 text-xs border-l border-border ${deformMode === "curvematch" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                onClick={() => { setDeformMode("curvematch"); }}
              >
                Curve Match
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[1fr_280px] min-h-0">
          {/* 3D viewport */}
          <div className="relative bg-black">
            <Canvas
              camera={{ position: [0.6, 0.5, 0.8], fov: 45 }}
              dpr={[1, 1.5]}
              gl={{ antialias: false, powerPreference: "high-performance" }}
            >
              <DeformScene
                originalGeom={originalGeom}
                handles={handles}
                selectedHandleId={selectedHandleId}
                addingHandle={addingHandle}
                onHandleSelect={setSelectedHandleId}
                onHandleMove={moveHandle}
                onMeshClick={addHandle}
                meshWorldMatrix={meshWorldMatrix}
                onEdgeClick={deformMode === "curvematch" ? setSelectedEdgePoint : undefined}
              />
            </Canvas>

            {addingHandle && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg">
                Click on the mesh to place a handle
              </div>
            )}

            {!originalGeom && (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="border-l border-border flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Part name</Label>
                <Input
                  value={partName}
                  onChange={(e) => setPartName(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>

              <Button
                size="sm"
                variant={addingHandle ? "default" : "outline"}
                onClick={() => setAddingHandle(v => !v)}
                className="h-7 w-full text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                {addingHandle ? "Cancel — click mesh" : "Add handle"}
              </Button>

              {handles.length > 0 && (
                <div className="space-y-1">
                  <div className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Handles ({handles.length})
                  </div>
                  {handles.map((h, i) => (
                    <div
                      key={h.id}
                      onClick={() => setSelectedHandleId(h.id)}
                      className={`flex items-center justify-between rounded-md border px-2 py-1 text-xs cursor-pointer ${
                        h.id === selectedHandleId
                          ? "border-primary/60 bg-primary/10"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <span>Handle {i + 1}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteHandle(h.id); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {selectedHandle && (
                <div className="space-y-1">
                  <Label className="text-xs">Influence radius</Label>
                  <Slider
                    min={0.01}
                    max={0.5}
                    step={0.005}
                    value={[selectedHandle.radius]}
                    onValueChange={([v]) => updateSelectedRadius(v)}
                  />
                  <div className="text-mono text-[10px] text-muted-foreground">
                    {(selectedHandle.radius * 100).toFixed(1)} cm
                  </div>
                </div>
              )}

              {handles.length === 0 && deformMode === "handles" && (
                <div className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground leading-tight">
                  Add handles by clicking "Add handle" then clicking on the mesh. Drag handles to deform.
                </div>
              )}

              {deformMode === "curvematch" && (
                <div className="space-y-3">
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-cyan-400" />
                      Step 1 — Trace curve on car
                    </Label>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Click points along the target curve on the car in the main viewport.
                    </p>
                    <Button
                      size="sm"
                      variant={(onCurveMatchActiveChange && (curvePoints?.length ?? 0) === 0) ? "default" : "outline"}
                      className="h-7 w-full text-xs"
                      onClick={() => onCurveMatchActiveChange?.(true)}
                    >
                      Start tracing curve
                    </Button>
                    {(curvePoints?.length ?? 0) > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{curvePoints!.length} points placed</span>
                        <Button
                          size="sm" variant="ghost"
                          className="h-5 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                          onClick={() => { onClearCurvePoints?.(); onCurveMatchActiveChange?.(false); }}
                        >
                          Clear
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-md border border-border/60 bg-muted/20 p-2 space-y-2">
                    <Label className="text-xs flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                      Step 2 — Pick edge on part
                    </Label>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Click on the part mesh in the 3D view to select the edge to match.
                    </p>
                    {selectedEdgePoint && (
                      <div className="text-[10px] text-muted-foreground font-mono">
                        Edge point: {selectedEdgePoint.x.toFixed(3)}, {selectedEdgePoint.y.toFixed(3)}, {selectedEdgePoint.z.toFixed(3)}
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 w-full text-xs"
                    disabled={!selectedEdgePoint || (curvePoints?.length ?? 0) < 2}
                    onClick={() => {
                      if (!originalGeom || !selectedEdgePoint || !curvePoints?.length) return;
                      const geo = originalGeom.clone();
                      const posAttr = geo.attributes.position as THREE.BufferAttribute;
                      const influenceRadius = 0.08;
                      const spline = new THREE.CatmullRomCurve3(curvePoints);
                      const splinePoints = spline.getPoints(50);

                      for (let i = 0; i < posAttr.count; i++) {
                        const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
                        const dist = v.distanceTo(selectedEdgePoint);
                        if (dist > influenceRadius) continue;
                        const weight = 1 - (dist / influenceRadius);
                        let minDist = Infinity;
                        let nearest = splinePoints[0];
                        for (const sp of splinePoints) {
                          const d = v.distanceTo(sp);
                          if (d < minDist) { minDist = d; nearest = sp; }
                        }
                        const newPos = v.clone().lerp(nearest, weight);
                        posAttr.setXYZ(i, newPos.x, newPos.y, newPos.z);
                      }

                      posAttr.needsUpdate = true;
                      geo.computeVertexNormals();
                      setOriginalGeom(geo);
                      toast.success("Edge matched to curve");
                    }}
                  >
                    Match edge to curve
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t border-border p-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleSave}
                disabled={isSaving || !originalGeom}
                className="h-7 w-full text-xs"
              >
                {isSaving ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Saving…</>
                ) : (
                  <><Save className="mr-1 h-3 w-3" /> Save to library</>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
