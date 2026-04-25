/**
 * ShowroomFloor — reflective floor + soft accumulative shadows.
 *
 * Drop-in replacement for the plain ContactShadows pad:
 *  • reflectorFloor=true  → polished studio floor that subtly mirrors the car
 *  • accumulativeShadows  → progressive raytraced-looking shadow under the car
 *
 * Both are independently toggleable via the QualitySettings preset.
 * When neither is on, falls back to the existing ContactShadows look so
 * Draft mode still shows *something* under the car.
 */
import { AccumulativeShadows, ContactShadows, MeshReflectorMaterial, RandomizedLight } from "@react-three/drei";

interface Props {
  reflector: boolean;
  accumulative: boolean;
}

export function ShowroomFloor({ reflector, accumulative }: Props) {
  return (
    <>
      {/* Reflective floor: large plane just under origin. Subtle blur so the
          reflection reads as a polished studio surface, not a perfect mirror. */}
      {reflector && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[60, 60]} />
          <MeshReflectorMaterial
            blur={[400, 100]}
            resolution={1024}
            mixBlur={1.2}
            mixStrength={1.4}
            roughness={0.85}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#0a0a0c"
            metalness={0.55}
            mirror={0.4}
          />
        </mesh>
      )}

      {/* Soft baked-style shadows under the car. */}
      {accumulative && (
        <AccumulativeShadows
          temporal
          frames={60}
          alphaTest={0.85}
          opacity={0.9}
          scale={14}
          position={[0, 0.005, 0]}
          color="#000000"
        >
          <RandomizedLight
            amount={8}
            radius={5}
            intensity={1.2}
            ambient={0.45}
            position={[5, 8, 5]}
            bias={0.001}
          />
        </AccumulativeShadows>
      )}

      {/* Fallback contact shadow when neither effect is on (Draft mode). */}
      {!reflector && !accumulative && (
        <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={14} blur={2.5} far={4} />
      )}

      {/* Keep a softer contact shadow alongside the reflector floor so parts
          still ground visually without the reflector swallowing them. */}
      {reflector && !accumulative && (
        <ContactShadows position={[0, 0.002, 0]} opacity={0.3} scale={14} blur={3.2} far={4} />
      )}
    </>
  );
}
