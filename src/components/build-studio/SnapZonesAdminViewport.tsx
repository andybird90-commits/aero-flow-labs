/**
 * SnapZonesAdminViewport — 3D viewport for the Snap Zones admin page.
 *
 * Loads the donor car STL (same logic as BuildStudioViewport) and renders
 * snap-zone gizmos. Clicking on the car body places the *active* zone there,
 * or — when no zone is selected — emits the click position so the caller can
 * spawn a new zone at that point.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  ContactShadows,
  GizmoHelper,
  GizmoViewcube,
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import type { CarTemplate } from "@/lib/repo";
import type { SnapZone } from "@/lib/build-studio/snap-zones";
import { SnapZoneViz } from "@/components/build-studio/SnapZoneViz";

interface Props {
  template?: CarTemplate | null;
  heroStlUrl?: string | null;
  zones: SnapZone[];
  selectedZoneId: string | null;
  onSelectZone: (id: string | null) => void;
  /** Click on the car body — used to either move the selected zone or spawn a new one. */
  onClickCar: (pos: { x: number; y: number; z: number }) => void;
}

function HeroCar({
  url,
  template,
  onClickCar,
}: {
  url: string;
  template?: CarTemplate | null;
  onClickCar: Props["onClickCar"];
}) {
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
        mesh.rotation.x = -Math.PI / 2;
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
  return (
    <primitive
      object={object}
      onClick={(e: any) => {
        e.stopPropagation();
        const p = e.point as THREE.Vector3;
        onClickCar({ x: p.x, y: p.y, z: p.z });
      }}
    />
  );
}

function Placeholder({
  template,
  onClickCar,
}: {
  template?: CarTemplate | null;
  onClickCar: Props["onClickCar"];
}) {
  const wb = (template?.wheelbase_mm ?? 2575) / 1000;
  const tr = (template?.track_front_mm ?? 1520) / 1000;
  const length = wb + 1.45;
  const width = Math.max(tr + 0.05, 1.7);
  const height = 1.32;
  return (
    <group
      position={[0, height / 2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        const p = e.point as THREE.Vector3;
        onClickCar({ x: p.x, y: p.y, z: p.z });
      }}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[length, height * 0.55, width]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-length * 0.05, height * 0.45, 0]} castShadow>
        <boxGeometry args={[length * 0.55, height * 0.35, width * 0.92]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

export function SnapZonesAdminViewport({
  template,
  heroStlUrl,
  zones,
  selectedZoneId,
  onSelectZone,
  onClickCar,
}: Props) {
  const orbit = useRef<any>(null);
  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 3, 4.5], fov: 38, near: 0.1, far: 100 }}
      onPointerMissed={() => onSelectZone(null)}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#0a0a0c"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-6, 4, -3]} intensity={0.45} color="#fb923c" />
      <Suspense fallback={null}>
        <Environment preset="warehouse" />
      </Suspense>

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
      <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={14} blur={2.5} far={4} />

      {heroStlUrl ? (
        <Suspense fallback={<Placeholder template={template} onClickCar={onClickCar} />}>
          <HeroCar url={heroStlUrl} template={template} onClickCar={onClickCar} />
        </Suspense>
      ) : (
        <Placeholder template={template} onClickCar={onClickCar} />
      )}

      {zones.map((z) => (
        <SnapZoneViz
          key={z.id}
          zone={z}
          selected={z.id === selectedZoneId}
          onClick={() => onSelectZone(z.id)}
          showLabel
        />
      ))}

      <OrbitControls ref={orbit} makeDefault enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={20} />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewcube color="#1e293b" textColor="#fb923c" strokeColor="#fb923c" />
      </GizmoHelper>
    </Canvas>
  );
}
