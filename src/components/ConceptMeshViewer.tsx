/**
 * ConceptMeshViewer — renders an experimental AI-generated GLB mesh
 * produced from an approved concept render. Purely a visual reference,
 * not exportable, not parametric.
 */
import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, useGLTF, Center, Bounds } from "@react-three/drei";

interface Props {
  meshUrl: string;
  className?: string;
}

function MeshContent({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return (
    <Center>
      <primitive object={gltf.scene} />
    </Center>
  );
}

export function ConceptMeshViewer({ meshUrl, className }: Props) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [2.5, 1.6, 3.5], fov: 38 }}
      className={className}
      gl={{ antialias: true, preserveDrawingBuffer: false }}
    >
      <color attach="background" args={["hsl(220, 18%, 7%)"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.2}>
          <MeshContent url={meshUrl} />
        </Bounds>
        <Environment preset="studio" />
        <ContactShadows position={[0, -0.5, 0]} opacity={0.4} scale={8} blur={2.4} far={4} />
      </Suspense>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={12}
      />
    </Canvas>
  );
}
