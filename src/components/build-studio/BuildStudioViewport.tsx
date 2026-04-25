/**
 * BuildStudioViewport — R3F scene for the 3D Build Studio.
 *
 * Renders the donor car (real STL when available, procedural box otherwise),
 * an optional body skin overlay (Shell Fit Mode), the user's placed parts
 * (with their real GLB/STL geometry where uploaded), and snap zones for the
 * current car_template. Selecting a part shows TransformControls; releasing
 * commits to DB and snaps to the nearest snap zone if within threshold.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  TransformControls,
  Environment,
  ContactShadows,
  GizmoHelper,
  GizmoViewcube,
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader, GLTFLoader } from "three-stdlib";
import type { CarTemplate, LibraryItem } from "@/lib/repo";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";
import type { SnapZone } from "@/lib/build-studio/snap-zones";
import { nearestSnapZone } from "@/lib/build-studio/snap-zones";
import { PartMesh } from "@/components/build-studio/PartMesh";
import { SnapZoneViz } from "@/components/build-studio/SnapZoneViz";
import { DEFAULT_PAINT_FINISH, type EnvPreset, type PaintFinish } from "@/lib/build-studio/paint-finish";

export type TransformMode = "translate" | "rotate" | "scale";
export type CameraPreset = "free" | "front" | "rear" | "left" | "right" | "top" | "three_quarter";

export interface ShellTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

interface ViewportProps {
  template?: CarTemplate | null;
  /** Signed URL for the project's hero STL (preferred over the box placeholder). */
  heroStlUrl?: string | null;
  /** Optional body skin overlay (Shell Fit Mode). */
  bodySkinUrl?: string | null;
  bodySkinKind?: "stl" | "glb" | null;
  /** Persisted transform of the shell overlay (Shell Fit). */
  shellTransform?: ShellTransform | null;
  /** True when the shell overlay should be the active gizmo target. */
  shellEditMode?: boolean;
  /** Called when the user releases the shell gizmo. */
  onShellCommit?: (t: ShellTransform) => void;
  parts: PlacedPart[];
  /** Resolved library_items for placed parts so we can render real meshes. */
  libraryItemsById: Map<string, LibraryItem>;
  /** Snap zones defined for this car_template. */
  snapZones?: SnapZone[];
  showSnapZones: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  transformMode: TransformMode;
  showGrid: boolean;
  preset: CameraPreset;
  onCommit: (
    id: string,
    patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale" | "snap_zone_id">>,
  ) => void;
}

/* ─── Real hero STL car (preferred) ─── */
function HeroStlCar({ url, template }: { url: string; template?: CarTemplate | null }) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => {
        if (cancelled) return;
        geo.computeVertexNormals();
        const mat = new THREE.MeshPhysicalMaterial({
          color: "#0a1622",
          metalness: 0.85,
          roughness: 0.32,
          clearcoat: 1.0,
          clearcoatRoughness: 0.18,
          envMapIntensity: 1.4,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const wrapper = new THREE.Group();
        mesh.rotation.x = -Math.PI / 2; // Z-up → Y-up
        wrapper.add(mesh);

        const box = new THREE.Box3().setFromObject(wrapper);
        const size = new THREE.Vector3();
        box.getSize(size);
        const longest = Math.max(size.x, size.y, size.z);
        if (isFinite(longest) && longest > 0) {
          wrapper.scale.setScalar(targetLength / longest);
        }
        const box2 = new THREE.Box3().setFromObject(wrapper);
        const center = new THREE.Vector3();
        box2.getCenter(center);
        wrapper.position.sub(center);
        const box3 = new THREE.Box3().setFromObject(wrapper);
        wrapper.position.y -= box3.min.y;

        setObject(wrapper);
      },
      undefined,
      () => {
        if (!cancelled) setObject(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url, template?.wheelbase_mm]);

  if (!object) return null;
  return <primitive object={object} />;
}

/* ─── Body skin overlay (Shell Fit Mode) ─── */
const BodySkinOverlay = function BodySkinOverlay({
  url,
  kind,
  template,
  transform,
  groupRef,
  onClick,
  highlight,
}: {
  url: string;
  kind: "stl" | "glb";
  template?: CarTemplate | null;
  transform?: ShellTransform | null;
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const localRef = useRef<THREE.Group>(null);

  useEffect(() => {
    let cancelled = false;
    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

    const onLoaded = (raw: THREE.Object3D) => {
      if (cancelled) return;
      const wrapper = new THREE.Group();
      wrapper.add(raw);

      const box = new THREE.Box3().setFromObject(wrapper);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longest = Math.max(size.x, size.y, size.z);
      if (isFinite(longest) && longest > 0) {
        wrapper.scale.setScalar(targetLength / longest);
      }
      const box2 = new THREE.Box3().setFromObject(wrapper);
      const center = new THREE.Vector3();
      box2.getCenter(center);
      wrapper.position.sub(center);
      const box3 = new THREE.Box3().setFromObject(wrapper);
      wrapper.position.y -= box3.min.y;

      // Translucent orange tint to clearly read it as a skin overlay.
      wrapper.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          m.material = new THREE.MeshPhysicalMaterial({
            color: highlight ? "#fb923c" : "#fb923c",
            metalness: 0.2,
            roughness: 0.6,
            transparent: true,
            opacity: highlight ? 0.55 : 0.42,
            clearcoat: 0.3,
            emissive: highlight ? "#7c2d12" : "#000000",
            emissiveIntensity: highlight ? 0.15 : 0,
          });
        }
      });
      setObject(wrapper);
    };

    if (kind === "stl") {
      const loader = new STLLoader();
      loader.load(
        url,
        (geo) => {
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo);
          mesh.rotation.x = -Math.PI / 2;
          onLoaded(mesh);
        },
        undefined,
        () => {
          if (!cancelled) setObject(null);
        },
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => onLoaded(gltf.scene),
        undefined,
        () => {
          if (!cancelled) setObject(null);
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, [url, kind, template?.wheelbase_mm, highlight]);

  // Apply transform when it changes (without overriding gizmo dragging).
  useEffect(() => {
    const g = localRef.current;
    if (!g || !transform) return;
    g.position.set(transform.position.x, transform.position.y, transform.position.z);
    g.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    g.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  }, [transform]);

  if (!object) return null;
  return (
    <group
      ref={(node) => {
        localRef.current = node;
        if (groupRef) groupRef.current = node;
      }}
      name="shell-overlay"
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <primitive object={object} />
    </group>
  );
};

/* ─── Procedural car placeholder (fallback) ─── */
function CarPlaceholder({ template }: { template?: CarTemplate | null }) {
  const wb = (template?.wheelbase_mm ?? 2575) / 1000;
  const tr = (template?.track_front_mm ?? 1520) / 1000;
  const length = wb + 1.45;
  const width = Math.max(tr + 0.05, 1.7);
  const height = 1.32;

  return (
    <group position={[0, height / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[length, height * 0.55, width]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-length * 0.05, height * 0.45, 0]} castShadow>
        <boxGeometry args={[length * 0.55, height * 0.35, width * 0.92]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} />
      </mesh>
      {[
        [length * 0.35, -height * 0.27, width * 0.5],
        [length * 0.35, -height * 0.27, -width * 0.5],
        [-length * 0.35, -height * 0.27, width * 0.5],
        [-length * 0.35, -height * 0.27, -width * 0.5],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.32, 0.22, 24]} />
          <meshStandardMaterial color="#0a0a0a" />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Single placed part wrapper (transform + mesh) ─── */
function PlacedPartGroup({
  part,
  libraryItem,
  selected,
  onSelect,
}: {
  part: PlacedPart;
  libraryItem: LibraryItem | null;
  selected: boolean;
  onSelect: () => void;
}) {
  if (part.hidden) return null;

  return (
    <group
      name={`placed-${part.id}`}
      position={[part.position.x, part.position.y, part.position.z]}
      rotation={[part.rotation.x, part.rotation.y, part.rotation.z]}
      scale={[part.scale.x, part.scale.y, part.scale.z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <PartMesh libraryItem={libraryItem} selected={selected} locked={part.locked} />
    </group>
  );
}

/* ─── Camera preset driver ─── */
function CameraRig({ preset, template }: { preset: CameraPreset; template?: CarTemplate | null }) {
  const { camera } = useThree();
  const wb = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wb + 1.45;
  const dist = length * 1.8;

  useEffect(() => {
    if (preset === "free") return;
    const targets: Record<Exclude<CameraPreset, "free">, [number, number, number]> = {
      front: [dist, 1.2, 0],
      rear: [-dist, 1.2, 0],
      left: [0, 1.2, -dist],
      right: [0, 1.2, dist],
      top: [0.001, dist, 0],
      three_quarter: [dist * 0.75, dist * 0.55, dist * 0.75],
    };
    const t = targets[preset];
    camera.position.set(t[0], t[1], t[2]);
    camera.lookAt(0, 0.6, 0);
  }, [preset, dist, camera]);

  return null;
}

export function BuildStudioViewport({
  template,
  heroStlUrl,
  bodySkinUrl,
  bodySkinKind,
  shellTransform,
  shellEditMode,
  onShellCommit,
  parts,
  libraryItemsById,
  snapZones = [],
  showSnapZones,
  selectedId,
  onSelect,
  transformMode,
  showGrid,
  preset,
  onCommit,
}: ViewportProps) {
  const orbitRef = useRef<any>(null);
  const transformRef = useRef<any>(null);
  const shellTransformRef = useRef<any>(null);
  const shellGroupRef = useRef<THREE.Group | null>(null);
  const selected = parts.find((p) => p.id === selectedId) ?? null;
  const [meshNode, setMeshNode] = useState<THREE.Object3D | null>(null);

  const showShellGizmo = !!shellEditMode && !!bodySkinUrl && !!shellGroupRef.current;

  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 3, 4.5], fov: 38, near: 0.1, far: 100 }}
      onPointerMissed={() => onSelect(null)}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#0a0a0c"]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-6, 4, -3]} intensity={0.45} color="#fb923c" />

      <Suspense fallback={null}>
        <Environment preset="warehouse" />
      </Suspense>

      {showGrid && (
        <Grid
          args={[40, 40]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#1f2937"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#fb923c"
          fadeDistance={28}
          fadeStrength={1.2}
          infiniteGrid
        />
      )}

      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={14} blur={2.5} far={4} />

      {heroStlUrl ? (
        <Suspense fallback={<CarPlaceholder template={template} />}>
          <HeroStlCar url={heroStlUrl} template={template} />
        </Suspense>
      ) : (
        <CarPlaceholder template={template} />
      )}

      {bodySkinUrl && bodySkinKind && (
        <Suspense fallback={null}>
          <BodySkinOverlay
            url={bodySkinUrl}
            kind={bodySkinKind}
            template={template}
            transform={shellTransform ?? null}
            groupRef={shellGroupRef}
            highlight={!!shellEditMode}
          />
        </Suspense>
      )}

      {showSnapZones && snapZones.map((z) => (
        <SnapZoneViz
          key={z.id}
          zone={z}
          active={selected?.snap_zone_id === z.id}
          showLabel
        />
      ))}

      <SceneParts
        parts={parts}
        libraryItemsById={libraryItemsById}
        selectedId={selectedId}
        onSelect={onSelect}
        onMeshFound={setMeshNode}
      />

      {!shellEditMode && selected && meshNode && !selected.locked && (
        <TransformControls
          ref={transformRef}
          object={meshNode}
          mode={transformMode}
          size={0.7}
          onMouseDown={() => {
            if (orbitRef.current) orbitRef.current.enabled = false;
          }}
          onMouseUp={() => {
            if (orbitRef.current) orbitRef.current.enabled = true;
            if (!meshNode || !selected) return;

            const pos: Vec3 = {
              x: meshNode.position.x,
              y: meshNode.position.y,
              z: meshNode.position.z,
            };

            // Snap-to-zone on release (translate only).
            let snapPatch: Partial<Pick<PlacedPart, "position" | "snap_zone_id">> = {
              position: pos,
            };
            if (transformMode === "translate" && snapZones.length > 0) {
              const nearest = nearestSnapZone(pos, snapZones, 0.35);
              if (nearest) {
                snapPatch = {
                  position: { ...nearest.position },
                  snap_zone_id: nearest.id,
                };
                meshNode.position.set(nearest.position.x, nearest.position.y, nearest.position.z);
              } else {
                snapPatch = { position: pos, snap_zone_id: null };
              }
            }

            onCommit(selected.id, {
              ...snapPatch,
              rotation: {
                x: meshNode.rotation.x,
                y: meshNode.rotation.y,
                z: meshNode.rotation.z,
              },
              scale: {
                x: meshNode.scale.x,
                y: meshNode.scale.y,
                z: meshNode.scale.z,
              },
            });
          }}
        />
      )}

      {showShellGizmo && shellGroupRef.current && (
        <TransformControls
          ref={shellTransformRef}
          object={shellGroupRef.current}
          mode={transformMode}
          size={0.9}
          onMouseDown={() => {
            if (orbitRef.current) orbitRef.current.enabled = false;
          }}
          onMouseUp={() => {
            if (orbitRef.current) orbitRef.current.enabled = true;
            const g = shellGroupRef.current;
            if (!g || !onShellCommit) return;
            onShellCommit({
              position: { x: g.position.x, y: g.position.y, z: g.position.z },
              rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
              scale: { x: g.scale.x, y: g.scale.y, z: g.scale.z },
            });
          }}
        />
      )}

      <CameraRig preset={preset} template={template} />

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={20}
        target={[0, 0.6, 0]}
      />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewcube
          color="#1f2937"
          opacity={1}
          strokeColor="#fb923c"
          textColor="#fb923c"
          hoverColor="#fb923c"
        />
      </GizmoHelper>
    </Canvas>
  );
}

/** Renders all placed parts and reports the selected mesh node up. */
function SceneParts({
  parts,
  libraryItemsById,
  selectedId,
  onSelect,
  onMeshFound,
}: {
  parts: PlacedPart[];
  libraryItemsById: Map<string, LibraryItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMeshFound: (node: THREE.Object3D | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!selectedId || !groupRef.current) {
      onMeshFound(null);
      return;
    }
    const node = groupRef.current.getObjectByName(`placed-${selectedId}`);
    onMeshFound(node ?? null);
  }, [selectedId, parts, onMeshFound]);

  return (
    <group ref={groupRef}>
      {parts.map((p) => (
        <PlacedPartGroup
          key={p.id}
          part={p}
          libraryItem={p.library_item_id ? libraryItemsById.get(p.library_item_id) ?? null : null}
          selected={p.id === selectedId}
          onSelect={() => onSelect(p.id)}
        />
      ))}
    </group>
  );
}
