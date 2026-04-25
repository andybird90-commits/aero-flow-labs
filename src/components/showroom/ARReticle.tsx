/**
 * ARReticle — visible ring shown at the live hit-test point while the user is
 * placing the car. Disappears once anchored.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useARAnchor } from "@/lib/showroom/ar-anchor";

export function ARReticle() {
  const ar = useARAnchor();
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const visible = ar.mode === "placing" && !!ar.reticlePosition;
    m.visible = visible;
    if (!visible || !ar.reticlePosition || !ar.reticleQuat) return;
    m.position.set(...ar.reticlePosition);
    m.quaternion.set(...ar.reticleQuat);
  });

  return (
    <mesh ref={ref} visible={false} renderOrder={999}>
      <ringGeometry args={[0.13, 0.16, 48]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.95} side={THREE.DoubleSide} depthTest={false} />
    </mesh>
  );
}
