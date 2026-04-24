/**
 * BuildStudioViewport — R3F scene for the 3D Build Studio.
 *
 * Renders a stage (grid + ground), a placeholder donor car (procedural box
 * sized from car_template if available), and the user's placed parts. The
 * selected part shows TransformControls (translate/rotate/scale) — dragging
 * commits to DB on release via onCommit.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  TransformControls,
  Environment,
  ContactShadows,
  Html,
  GizmoHelper,
  GizmoViewcube,
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import type { CarTemplate } from "@/lib/repo";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";

export type TransformMode = "translate" | "rotate" | "scale";
export type CameraPreset = "free" | "front" | "rear" | "left" | "right" | "top" | "three_quarter";

interface ViewportProps {
  template?: CarTemplate | null;
  /** Signed URL for the project's hero STL (preferred over the box placeholder). */
  heroStlUrl?: string | null;
  parts: PlacedPart[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  transformMode: TransformMode;
  showGrid: boolean;
  preset: CameraPreset;
  onCommit: (id: string, patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale">>) => void;
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

        // Most automotive STLs are Z-up; rotate to Y-up.
        const wrapper = new THREE.Group();
        mesh.rotation.x = -Math.PI / 2;
        wrapper.add(mesh);

        // Fit to expected car length and ground it.
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

/* ─── Procedural car placeholder (fallback) ─── */
function CarPlaceholder({ template }: { template?: CarTemplate | null }) {
  const wb = (template?.wheelbase_mm ?? 2575) / 1000;
  const tr = (template?.track_front_mm ?? 1520) / 1000;
  const length = wb + 1.45;
  const width = Math.max(tr + 0.05, 1.7);
  const height = 1.32;

  return (
    <group position={[0, height / 2, 0]}>
      {/* Body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[length, height * 0.55, width]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Greenhouse */}
      <mesh position={[-length * 0.05, height * 0.45, 0]} castShadow>
        <boxGeometry args={[length * 0.55, height * 0.35, width * 0.92]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Wheels */}
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

/* ─── Single placed part (box stand-in for now) ─── */
function PlacedPartMesh({
  part,
  selected,
  onSelect,
}: {
  part: PlacedPart;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const color = selected ? "#fb923c" : part.locked ? "#475569" : "#f97316";

  if (part.hidden) return null;

  return (
    <mesh
      ref={ref}
      name={`placed-${part.id}`}
      position={[part.position.x, part.position.y, part.position.z]}
      rotation={[part.rotation.x, part.rotation.y, part.rotation.z]}
      scale={[part.scale.x, part.scale.y, part.scale.z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      castShadow
    >
      <boxGeometry args={[0.4, 0.18, 0.6]} />
      <meshStandardMaterial color={color} metalness={0.3} roughness={0.5} emissive={selected ? "#7c2d12" : "#000000"} emissiveIntensity={selected ? 0.4 : 0} />
    </mesh>
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
  parts,
  selectedId,
  onSelect,
  transformMode,
  showGrid,
  preset,
  onCommit,
}: ViewportProps) {
  const orbitRef = useRef<any>(null);
  const transformRef = useRef<any>(null);
  const selected = parts.find((p) => p.id === selectedId) ?? null;
  const targetRef = useRef<THREE.Object3D | null>(null);

  // Track the selected mesh by name so TransformControls can attach to it.
  const [meshNode, setMeshNode] = useState<THREE.Object3D | null>(null);

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

      <SceneParts
        parts={parts}
        selectedId={selectedId}
        onSelect={onSelect}
        onMeshFound={setMeshNode}
      />

      {selected && meshNode && !selected.locked && (
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
            onCommit(selected.id, {
              position: {
                x: meshNode.position.x,
                y: meshNode.position.y,
                z: meshNode.position.z,
              },
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
  selectedId,
  onSelect,
  onMeshFound,
}: {
  parts: PlacedPart[];
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
        <PlacedPartMesh
          key={p.id}
          part={p}
          selected={p.id === selectedId}
          onSelect={() => onSelect(p.id)}
        />
      ))}
    </group>
  );
}
