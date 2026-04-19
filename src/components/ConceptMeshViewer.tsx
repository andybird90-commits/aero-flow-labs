/**
 * ConceptMeshViewer — renders an experimental AI-generated GLB mesh
 * produced from an approved concept render. Purely a visual reference,
 * not exportable, not parametric.
 *
 * Display modes:
 *  - shaded:    original PBR materials from the GLB (reflective, can hide form)
 *  - matcap:    flat clay render, best for judging silhouette + form
 *  - wireframe: raw topology, best for judging mesh quality
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, useGLTF, Center, Bounds } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";

type Mode = "shaded" | "matcap" | "wireframe";

interface Props {
  meshUrl: string;
  className?: string;
}

function MeshContent({ url, mode }: { url: string; mode: Mode }) {
  const gltf = useGLTF(url);

  // Snapshot original materials once so we can restore them when switching back to "shaded".
  const originals = useMemo(() => {
    const map = new Map<string, THREE.Material | THREE.Material[]>();
    gltf.scene.traverse((o: any) => {
      if (o.isMesh && o.material) map.set(o.uuid, o.material);
    });
    return map;
  }, [gltf.scene]);

  useEffect(() => {
    gltf.scene.traverse((o: any) => {
      if (!o.isMesh) return;
      if (mode === "shaded") {
        const orig = originals.get(o.uuid);
        if (orig) o.material = orig;
      } else if (mode === "wireframe") {
        o.material = new THREE.MeshBasicMaterial({
          color: new THREE.Color("hsl(190, 90%, 60%)"),
          wireframe: true,
        });
      } else if (mode === "matcap") {
        o.material = new THREE.MeshNormalMaterial({ flatShading: false });
      }
    });
  }, [mode, gltf.scene, originals]);

  return (
    <Center>
      <primitive object={gltf.scene} />
    </Center>
  );
}

export function ConceptMeshViewer({ meshUrl, className }: Props) {
  const [mode, setMode] = useState<Mode>("shaded");

  return (
    <div className={cn("relative h-full w-full", className)}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [2.5, 1.6, 3.5], fov: 38 }}
        gl={{ antialias: true, preserveDrawingBuffer: false }}
      >
        <color attach="background" args={["hsl(220, 18%, 7%)"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.2}>
            <MeshContent url={meshUrl} mode={mode} />
          </Bounds>
          {mode === "shaded" && <Environment preset="studio" />}
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

      {/* Render mode switcher */}
      <div className="absolute bottom-3 left-3 inline-flex rounded-md border border-border bg-surface-0/80 backdrop-blur p-0.5">
        {(["shaded", "matcap", "wireframe"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest rounded-sm transition-colors",
              mode === m
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
