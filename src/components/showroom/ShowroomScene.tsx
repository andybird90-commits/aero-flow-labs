/**
 * ShowroomScene — the immersive R3F scene used by /showroom/:projectId.
 *
 * Wraps the canvas in <XR> so VR/AR sessions work, but otherwise behaves
 * like a stripped-down Build Studio viewport: car + body skin + placed
 * parts under cinematic lighting, no editing UI.
 *
 * The scene root is `forwardRef`-ed so the parent page can:
 *   • call canvas.toBlob for screenshots
 *   • spin the camera target during turntable recording
 *   • restore camera state from bookmarks
 */
import { Suspense, forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls, ContactShadows } from "@react-three/drei";
import { XR, Controllers, Hands } from "@react-three/xr";
import * as THREE from "three";
import type { CarTemplate, LibraryItem } from "@/lib/repo";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import { PartMesh } from "@/components/build-studio/PartMesh";
import { ShowroomCar, ShowroomShell } from "./ShowroomCar";
import type { PaintFinish, EnvPreset } from "@/lib/build-studio/paint-finish";

export interface ShowroomCameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface ShowroomSceneHandle {
  /** Underlying WebGL canvas — used for PNG / video capture. */
  getCanvas: () => HTMLCanvasElement | null;
  /** Snapshot the current camera + orbit target as a bookmark. */
  getCameraState: () => ShowroomCameraState | null;
  /** Move camera to an explicit pose (used by bookmark restore). */
  setCameraState: (s: ShowroomCameraState) => void;
  /** Orbit camera around target by `delta` radians (turntable recorder). */
  orbitBy: (deltaRad: number) => void;
  /** Re-frame onto the car (reset camera). */
  resetView: () => void;
}

interface SceneProps {
  template?: CarTemplate | null;
  heroStlUrl?: string | null;
  bodySkinUrl?: string | null;
  bodySkinKind?: "stl" | "glb" | null;
  shellTransform?: ShowroomShellTransform | null;
  parts: PlacedPart[];
  libraryItemsById: Map<string, LibraryItem>;
  paintFinish: PaintFinish;
  materialTags?: Uint8Array | null;
  envPreset: EnvPreset;
  /** Slow continuous rotation around target (Presentation Mode). */
  autoOrbitRpm: number;
  /** Hide ContactShadows + Environment when AR is active so the room shows through. */
  arActive?: boolean;
}

export interface ShowroomShellTransform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

/** Imperative bridge so the page (outside <Canvas>) can drive the camera. */
function CameraBridge({
  apiRef,
  autoOrbitRpm,
}: {
  apiRef: React.MutableRefObject<{
    getState: () => ShowroomCameraState | null;
    setState: (s: ShowroomCameraState) => void;
    orbitBy: (d: number) => void;
    reset: () => void;
  } | null>;
  autoOrbitRpm: number;
}) {
  const { camera, gl } = useThree();
  const orbitRef = useRef<any>(null);

  useEffect(() => {
    apiRef.current = {
      getState: () => {
        const t = orbitRef.current?.target;
        if (!t) return null;
        return {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [t.x, t.y, t.z],
          fov: (camera as THREE.PerspectiveCamera).fov ?? 38,
        };
      },
      setState: (s) => {
        camera.position.set(...s.position);
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
          (camera as THREE.PerspectiveCamera).fov = s.fov;
          (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
        if (orbitRef.current) {
          orbitRef.current.target.set(...s.target);
          orbitRef.current.update();
        }
      },
      orbitBy: (delta) => {
        if (!orbitRef.current) return;
        const t = orbitRef.current.target;
        const offset = new THREE.Vector3().subVectors(camera.position, t);
        const r = Math.hypot(offset.x, offset.z);
        const angle = Math.atan2(offset.z, offset.x) + delta;
        offset.x = r * Math.cos(angle);
        offset.z = r * Math.sin(angle);
        camera.position.copy(t).add(offset);
        camera.lookAt(t);
        orbitRef.current.update();
      },
      reset: () => {
        camera.position.set(4.5, 2.4, 4.5);
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
          (camera as THREE.PerspectiveCamera).fov = 38;
          (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
        if (orbitRef.current) {
          orbitRef.current.target.set(0, 0.6, 0);
          orbitRef.current.update();
        }
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [camera, apiRef, gl]);

  // Auto-orbit (Presentation Mode).
  useEffect(() => {
    if (autoOrbitRpm === 0) return;
    let raf = 0;
    let last = performance.now();
    const radPerMs = (autoOrbitRpm * Math.PI * 2) / 60_000;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      apiRef.current?.orbitBy(radPerMs * dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoOrbitRpm, apiRef]);

  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={1.2}
      maxDistance={25}
      target={[0, 0.6, 0]}
    />
  );
}

export const ShowroomScene = forwardRef<ShowroomSceneHandle, SceneProps>(function ShowroomScene(
  {
    template,
    heroStlUrl,
    bodySkinUrl,
    bodySkinKind,
    shellTransform,
    parts,
    libraryItemsById,
    paintFinish,
    materialTags,
    envPreset,
    autoOrbitRpm,
    arActive,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<{
    getState: () => ShowroomCameraState | null;
    setState: (s: ShowroomCameraState) => void;
    orbitBy: (d: number) => void;
    reset: () => void;
  } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      getCanvas: () => canvasRef.current,
      getCameraState: () => apiRef.current?.getState() ?? null,
      setCameraState: (s) => apiRef.current?.setState(s),
      orbitBy: (d) => apiRef.current?.orbitBy(d),
      resetView: () => apiRef.current?.reset(),
    }),
    [],
  );

  const visibleParts = useMemo(() => parts.filter((p) => !p.hidden), [parts]);

  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 2.4, 4.5], fov: 38, near: 0.05, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true, alpha: !!arActive }}
      onCreated={({ gl }) => {
        canvasRef.current = gl.domElement;
      }}
    >
      <XR>
        <Controllers />
        <Hands />

        {!arActive && <color attach="background" args={["#06070a"]} />}

        <ambientLight intensity={0.35} />
        <directionalLight
          position={[6, 9, 5]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <directionalLight position={[-7, 4, -3]} intensity={0.4} color="#fb923c" />

        <Suspense fallback={null}>
          <Environment preset={envPreset} background={!arActive} blur={0.6} />
        </Suspense>

        {!arActive && (
          <ContactShadows
            position={[0, 0.001, 0]}
            opacity={0.55}
            scale={14}
            blur={2.6}
            far={5}
          />
        )}

        {heroStlUrl && (
          <Suspense fallback={null}>
            <ShowroomCar
              url={heroStlUrl}
              template={template}
              paintFinish={paintFinish}
              materialTags={materialTags ?? null}
            />
          </Suspense>
        )}

        {bodySkinUrl && bodySkinKind && (
          <Suspense fallback={null}>
            <ShowroomShell
              url={bodySkinUrl}
              kind={bodySkinKind}
              template={template}
              transform={shellTransform ?? null}
            />
          </Suspense>
        )}

        {visibleParts.map((p) => (
          <group
            key={p.id}
            position={[p.position.x, p.position.y, p.position.z]}
            rotation={[p.rotation.x, p.rotation.y, p.rotation.z]}
            scale={[p.scale.x, p.scale.y, p.scale.z]}
          >
            <PartMesh
              libraryItem={p.library_item_id ? libraryItemsById.get(p.library_item_id) ?? null : null}
              selected={false}
              locked={false}
            />
          </group>
        ))}

        <CameraBridge apiRef={apiRef} autoOrbitRpm={autoOrbitRpm} />
      </XR>
    </Canvas>
  );
});
