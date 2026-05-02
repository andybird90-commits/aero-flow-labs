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
}

function DeformScene({
  originalGeom, handles, selectedHandleId, addingHandle,
  onHandleSelect, onHandleMove, onMeshClick, meshWorldMatrix,
}: SceneProps) {
  const { camera, gl, raycaster } = useThree();
  const [deformedGeom, setDeformedGeom] = useState<THREE.BufferGeometry | null>(null);
  const draggingRef = useRef<string | null>(null);
  const dragPlaneRef = useRef(new THREE.Plane());

  // Recompute deformed geometry whenever handles change
  useEffect(() => {
    if (!originalGeom) return;
    const g = applyHandles(originalGeom, handles, meshWorldMatrix);
    setDeformedGeom(g);
  }, [originalGeom, handles, meshWorldMatrix]);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>, handleId: string) => {
    e.stopPropagation();
    onHandleSelect(handleId);
    draggingRef.current = handleId;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
    const handle = handles.find(h => h.id === handleId);
    if (handle) {
      dragPlaneRef.current.setFromNormalAndCoplanarPoint(normal, handle.position);
    }
    gl.domElement.style.cursor = "grabbing";
  }, [camera, handles, onHandleSelect, gl]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    const target = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlaneRef.current, target)) {
      onHandleMove(draggingRef.current, target);
    }
  }, [camera, gl, raycaster, onHandleMove]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = null;
    gl.domElement.style.cursor = "default";
  }, [gl]);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", handlePointerUp);
    return () => {
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUp);
    };
  }, [gl, handlePointerMove, handlePointerUp]);

  if (!deformedGeom) return null;

  const selected = handles.find(h => h.id === selectedHandleId) ?? null;

  return (
    <>
      {/* Main deformed mesh */}
      <mesh
        geometry={deformedGeom}
        onPointerDown={(e) => {
          if (addingHandle) {
            e.stopPropagation();
            onMeshClick(e.point);
          }
        }}
      >
        <meshStandardMaterial color="#cccccc" metalness={0.1} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* Deformation handles */}
      {handles.map((handle) => (
        <mesh
          key={handle.id}
          position={handle.position}
          onPointerDown={(e) => handlePointerDown(e, handle.id)}
        >
          <sphereGeometry args={[0.012, 16, 16]} />
          <meshBasicMaterial
            color={handle.id === selectedHandleId ? "#ff7a00" : "#00aaff"}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </mesh>
      ))}

      {/* Influence radius ring for the selected handle */}
      {selected && (
        <mesh position={selected.position} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[selected.radius * 0.98, selected.radius, 64]} />
          <meshBasicMaterial color="#ff7a00" side={THREE.DoubleSide} transparent opacity={0.4} depthTest={false} />
        </mesh>
      )}

      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 2]} intensity={1.0} />
      <Environment preset="studio" />
      <OrbitControls makeDefault enabled={!draggingRef.current} />
    </>
  );
}

// ── Main dialog ─────────────────────────────────────────────────────────────

export function DeformDialog({ open, onOpenChange, libraryItem, userId, onSaved }: Props) {
  const [originalGeom, setOriginalGeom] = useState<THREE.BufferGeometry | null>(null);
  const [handles, setHandles] = useState<DeformHandle[]>([]);
  const [selectedHandleId, setSelectedHandleId] = useState<string | null>(null);
  const [addingHandle, setAddingHandle] = useState(false);
  const [influenceRadius, setInfluenceRadius] = useState(0.08);
  const [partName, setPartName] = useState(`${libraryItem.title} (custom)`);
  const [isSaving, setIsSaving] = useState(false);
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
      const offset = newPos.clone().sub(h.position).add(h.offset);
      return { ...h, offset };
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[80vh] p-0 flex flex-col">
        <DialogHeader className="px-4 py-3 border-b border-border">
          <DialogTitle>Deform Part — {libraryItem.title}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[1fr_280px] min-h-0">
          {/* 3D viewport */}
          <div className="relative bg-black">
            <Canvas camera={{ position: [0.6, 0.5, 0.8], fov: 45 }}>
              <DeformScene
                originalGeom={originalGeom}
                handles={handles}
                selectedHandleId={selectedHandleId}
                addingHandle={addingHandle}
                onHandleSelect={setSelectedHandleId}
                onHandleMove={moveHandle}
                onMeshClick={addHandle}
                meshWorldMatrix={meshWorldMatrix}
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

              {handles.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground leading-tight">
                  Add handles by clicking "Add handle" then clicking on the mesh. Drag handles to deform.
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
