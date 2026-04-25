/**
 * ARMeasureViz — renders the measurement points, the line between them, and a
 * floating distance label in metres. Only visible while measureMode is on and
 * the car has been anchored.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { distance, useARAnchor } from "@/lib/showroom/ar-anchor";

export function ARMeasureViz() {
  const ar = useARAnchor();
  const lineRef = useRef<THREE.Line>(null);

  const positions = useMemo(() => new Float32Array(6), []);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  useFrame(() => {
    if (ar.measurePoints.length === 2 && lineRef.current) {
      const [a, b] = ar.measurePoints;
      positions[0] = a[0]; positions[1] = a[1]; positions[2] = a[2];
      positions[3] = b[0]; positions[4] = b[1]; positions[5] = b[2];
      (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  });

  if (!ar.measureMode) return null;

  return (
    <group renderOrder={998}>
      {ar.measurePoints.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.025, 16, 16]} />
          <meshBasicMaterial color={i === 0 ? "#22d3ee" : "#fb923c"} depthTest={false} />
        </mesh>
      ))}
      {ar.measurePoints.length === 2 && (
        <>
          {/* @ts-expect-error r3f line primitive */}
          <line ref={lineRef as any} geometry={geom}>
            <lineBasicMaterial color="#22d3ee" depthTest={false} linewidth={2} />
          </line>
          <Html
            position={[
              (ar.measurePoints[0][0] + ar.measurePoints[1][0]) / 2,
              (ar.measurePoints[0][1] + ar.measurePoints[1][1]) / 2 + 0.05,
              (ar.measurePoints[0][2] + ar.measurePoints[1][2]) / 2,
            ]}
            center
            distanceFactor={6}
          >
            <div className="rounded-md bg-cyan-500 px-2 py-0.5 text-xs font-semibold text-white shadow-lg">
              {(distance(ar.measurePoints[0], ar.measurePoints[1]) * 100).toFixed(1)} cm
            </div>
          </Html>
        </>
      )}
    </group>
  );
}
