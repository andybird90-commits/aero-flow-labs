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
import { useMemo } from "react";
import * as THREE from "three";

interface Props {
  reflector: boolean;
  accumulative: boolean;
}

/**
 * Build a radial alpha texture used to feather the floor's edge so it
 * fades into the surrounding fog/HDRI instead of cutting on a hard line.
 * Generated once and cached.
 */
function useRadialFadeTexture(): THREE.Texture {
  return useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.5);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

export function ShowroomFloor({ reflector, accumulative }: Props) {
  const fadeTex = useRadialFadeTexture();
  return (
    <>
      {/* Reflective floor: large plane just under origin. Subtle blur so the
          reflection reads as a polished studio surface, not a perfect mirror.
          The radial alpha mask feathers the edges into the backdrop so there's
          no visible floor seam against the HDRI horizon. */}
      {reflector && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
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
            transparent
            alphaMap={fadeTex}
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

      {/* Fallback contact shadow when neither effect is on (Draft mode, or
          outdoor HDRIs where the reflector is disabled). Use a strong, dark
          shadow so the car visibly grounds against bright outdoor backdrops
          (grass, sky) — otherwise it reads as floating. */}
      {!reflector && !accumulative && (
        <ContactShadows
          position={[0, 0.001, 0]}
          opacity={0.85}
          scale={16}
          blur={2.2}
          far={4}
          color="#000000"
        />
      )}

      {/* Keep a softer contact shadow alongside the reflector floor so parts
          still ground visually without the reflector swallowing them. */}
      {reflector && !accumulative && (
        <ContactShadows position={[0, 0.002, 0]} opacity={0.3} scale={14} blur={3.2} far={4} />
      )}
    </>
  );
}
