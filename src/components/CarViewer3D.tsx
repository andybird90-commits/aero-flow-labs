/**
 * CarViewer3D — premium real-time studio render of the car + fitted parts.
 *
 * Renders either the user's uploaded STL/OBJ, or a procedural placeholder
 * coupe driven by the car_template dimensions when nothing is uploaded yet.
 * Fitted aero parts (splitter, wing, skirts, etc.) are anchored to the
 * car's bounding box so they conform to whatever model is loaded.
 *
 * No CFD overlays — this is a pure design viewer.
 */
import { Suspense, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  ContactShadows,
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader, OBJLoader } from "three-stdlib";
import type { CarTemplate, FittedPart, Geometry } from "@/lib/repo";
import { useSignedMeshUrl, meshExtension } from "@/lib/mesh-url";
import { readOrientation } from "@/components/MeshOrientation";
import { computeAnchors, readNudge, nudged, type AeroAnchors, type MeshBounds } from "@/lib/aero-anchors";

export type CameraPreset = "free" | "front_three_quarter" | "rear_three_quarter" | "side" | "top";

interface CarViewer3DProps {
  template?: CarTemplate | null;
  geometry?: Geometry | null;
  parts?: FittedPart[];
  /** When true, only render the original car mesh (no fitted parts). */
  showPartsOnly?: boolean;
  hideParts?: boolean;
  className?: string;
  preset?: CameraPreset;
  /** Map of part kind -> visible (default true). */
  partVisibility?: Record<string, boolean>;
}

export interface CarViewer3DHandle {
  /** Capture the current frame as a base64 data URL. */
  captureFrame: () => string | null;
}

/* ─── helpers ──────────────────────────────────────────── */
function paramN(p: any, key: string, dflt = 0): number {
  const v = p?.[key];
  return typeof v === "number" ? v : dflt;
}

function findPart(parts: FittedPart[] = [], kind: string) {
  return parts.find((c) => c.kind === kind && c.enabled);
}

/* ─── User-uploaded mesh (STL / OBJ) ───────────────────── */
function UserMesh({
  url,
  ext,
  template,
  geometry,
  onLoaded,
  onBounds,
}: {
  url: string;
  ext: "stl" | "obj";
  template?: CarTemplate | null;
  geometry?: Geometry | null;
  onLoaded?: (ok: boolean) => void;
  onBounds?: (b: MeshBounds | null) => void;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    const finish = (ok: boolean) => onLoaded?.(ok);

    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;
    const ride =
      ((geometry?.ride_height_front_mm ?? 130) +
        (geometry?.ride_height_rear_mm ?? 135)) /
      2 /
      1000;

    const orientation = readOrientation(geometry);

    const fit = (obj: THREE.Object3D) => {
      const wrapper = new THREE.Group();
      if (orientation.upAxis === "z") {
        obj.rotation.x = -Math.PI / 2;
      } else if (orientation.upAxis === "x") {
        obj.rotation.z = Math.PI / 2;
      }
      wrapper.add(obj);
      wrapper.rotation.y =
        (orientation.yawDeg * Math.PI) / 180 +
        (orientation.flipForward ? Math.PI : 0);

      const box = new THREE.Box3().setFromObject(wrapper);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longest = Math.max(size.x, size.y, size.z);
      if (!isFinite(longest) || longest === 0) return wrapper;
      const scale = targetLength / longest;
      wrapper.scale.setScalar(scale);
      box.setFromObject(wrapper);
      const center = new THREE.Vector3();
      box.getCenter(center);
      wrapper.position.sub(center);
      box.setFromObject(wrapper);
      wrapper.position.y -= box.min.y;
      wrapper.position.y += ride;
      wrapper.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          if (!Array.isArray(m.material)) {
            m.material = new THREE.MeshPhysicalMaterial({
              color: "#0a1622",
              metalness: 0.85,
              roughness: 0.32,
              clearcoat: 1.0,
              clearcoatRoughness: 0.18,
              envMapIntensity: 1.4,
            });
          }
        }
      });
      return wrapper;
    };

    const reportBounds = (obj: THREE.Object3D) => {
      const b = new THREE.Box3().setFromObject(obj);
      onBounds?.({ box: b });
    };

    if (ext === "stl") {
      const loader = new STLLoader();
      loader.load(
        url,
        (geo) => {
          if (cancelled) return;
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo);
          const obj = fit(mesh);
          setObject(obj);
          reportBounds(obj);
          finish(true);
        },
        undefined,
        () => {
          if (!cancelled) {
            onBounds?.(null);
            finish(false);
          }
        },
      );
    } else {
      const loader = new OBJLoader();
      loader.load(
        url,
        (group) => {
          if (cancelled) return;
          const obj = fit(group);
          setObject(obj);
          reportBounds(obj);
          finish(true);
        },
        undefined,
        () => {
          if (!cancelled) {
            onBounds?.(null);
            finish(false);
          }
        },
      );
    }

    return () => {
      cancelled = true;
      onBounds?.(null);
    };
  }, [
    url,
    ext,
    template?.wheelbase_mm,
    geometry?.ride_height_front_mm,
    geometry?.ride_height_rear_mm,
    (geometry?.metadata as any)?.mesh_orientation?.upAxis,
    (geometry?.metadata as any)?.mesh_orientation?.yawDeg,
    (geometry?.metadata as any)?.mesh_orientation?.flipForward,
    onLoaded,
    onBounds,
  ]);

  if (!object) return null;
  return <primitive object={object} />;
}

/* ─── Procedural placeholder car ───────────────────────── */
function PlaceholderCar({
  template,
  geometry,
}: {
  template?: CarTemplate | null;
  geometry?: Geometry | null;
}) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const track = (template?.track_front_mm ?? 1520) / 1000;
  const fa = template?.frontal_area_m2 ?? 2.04;
  const width = Math.max(track + 0.05, 1.7);
  const height = Math.max(0.45, (fa / Math.max(width, 1.4)) * 0.85);
  const length = wheelbase + 1.45;
  const ride = ((geometry?.ride_height_front_mm ?? 130) + (geometry?.ride_height_rear_mm ?? 135)) / 2 / 1000;

  const bodyMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#0a1622",
        metalness: 0.85,
        roughness: 0.28,
        clearcoat: 1.0,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.4,
      }),
    [],
  );
  const greenhouseMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#020610",
        metalness: 0.4,
        roughness: 0.15,
        envMapIntensity: 1.6,
      }),
    [],
  );

  const baseY = ride + 0.15;

  return (
    <group>
      <mesh castShadow receiveShadow position={[0, baseY, 0]} material={bodyMat}>
        <boxGeometry args={[length, height, width]} />
      </mesh>
      <mesh castShadow position={[length / 2 - 0.25, baseY - 0.05, 0]} rotation={[0, 0, -0.12]} material={bodyMat}>
        <boxGeometry args={[0.7, height * 0.7, width * 0.95]} />
      </mesh>
      <mesh castShadow position={[-length / 2 + 0.2, baseY - 0.03, 0]} rotation={[0, 0, 0.08]} material={bodyMat}>
        <boxGeometry args={[0.6, height * 0.78, width * 0.96]} />
      </mesh>
      <mesh castShadow position={[-0.05, baseY + height * 0.55, 0]} material={greenhouseMat}>
        <boxGeometry args={[length * 0.5, height * 0.5, width * 0.85]} />
      </mesh>
      <mesh castShadow position={[length * 0.18, baseY + height * 0.45, 0]} rotation={[0, 0, -0.35]} material={greenhouseMat}>
        <boxGeometry args={[0.5, height * 0.55, width * 0.85]} />
      </mesh>
      <mesh castShadow position={[-length * 0.22, baseY + height * 0.45, 0]} rotation={[0, 0, 0.28]} material={greenhouseMat}>
        <boxGeometry args={[0.55, height * 0.5, width * 0.85]} />
      </mesh>
      {[
        [length / 2 - 0.55, ride + 0.05, width / 2 - 0.05],
        [length / 2 - 0.55, ride + 0.05, -width / 2 + 0.05],
        [-length / 2 + 0.55, ride + 0.05, width / 2 - 0.05],
        [-length / 2 + 0.55, ride + 0.05, -width / 2 + 0.05],
      ].map((p, i) => (
        <Wheel key={i} position={p as [number, number, number]} />
      ))}
    </group>
  );
}

function Wheel({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.x += dt * 1.2;
  });
  return (
    <mesh ref={ref} position={position} castShadow rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[0.32, 0.32, 0.22, 28]} />
      <meshStandardMaterial color="#0a0d12" metalness={0.6} roughness={0.4} />
    </mesh>
  );
}

/* ─── Fitted parts (parametric add-ons, anchored to car) ─── */
function FittedParts({
  parts = [],
  anchors,
  visibility,
}: {
  parts?: FittedPart[];
  anchors: AeroAnchors;
  visibility?: Record<string, boolean>;
}) {
  const { length, width, height } = anchors;
  const a = anchors.anchors;

  const partMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#0a0d11",
        metalness: 0.7,
        roughness: 0.35,
        clearcoat: 0.9,
        clearcoatRoughness: 0.25,
      }),
    [],
  );
  const accentMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#22d3ee",
        emissive: "#0aa8c4",
        emissiveIntensity: 0.35,
        metalness: 0.6,
        roughness: 0.3,
      }),
    [],
  );

  const isVisible = (kind: string) => visibility?.[kind] !== false;

  const splitter = isVisible("splitter") ? findPart(parts, "splitter") : undefined;
  const wing = isVisible("wing") ? findPart(parts, "wing") : undefined;
  const diffuser = isVisible("diffuser") ? findPart(parts, "diffuser") : undefined;
  const skirts = isVisible("side_skirt") ? findPart(parts, "side_skirt") : undefined;
  const canards = isVisible("canard") ? findPart(parts, "canard") : undefined;
  const ducktail = isVisible("ducktail") ? findPart(parts, "ducktail") : undefined;
  const wideArch = isVisible("wide_arch") ? findPart(parts, "wide_arch") : undefined;
  const lip = isVisible("lip") ? findPart(parts, "lip") : undefined;

  return (
    <group>
      {splitter && (() => {
        const n = readNudge(splitter.params);
        const protr = paramN(splitter.params, "depth", 80) / 1000;
        const p = nudged(a.splitter, n);
        return (
          <mesh position={[p.x + protr / 2, p.y, p.z]} material={partMat} castShadow>
            <boxGeometry args={[protr, 0.025, width * 0.95]} />
          </mesh>
        );
      })()}

      {lip && (() => {
        const n = readNudge(lip.params);
        const depth = paramN(lip.params, "depth", 30) / 1000;
        const p = nudged(a.splitter, n);
        return (
          <mesh position={[p.x + depth / 2, p.y + 0.04, p.z]} material={accentMat} castShadow>
            <boxGeometry args={[depth, 0.012, width * 0.9]} />
          </mesh>
        );
      })()}

      {canards && (() => {
        const n = readNudge(canards.params);
        const angle = paramN(canards.params, "angle", 12) * Math.PI / 180;
        return [
          { side: -1, anchor: a.canardsLeft },
          { side: 1, anchor: a.canardsRight },
        ].map(({ side, anchor }) => {
          const p = nudged(anchor, n);
          return (
            <mesh
              key={side}
              position={[p.x, p.y, p.z]}
              rotation={[0, 0, angle * -side]}
              material={accentMat}
              castShadow
            >
              <boxGeometry args={[0.18, 0.012, 0.16]} />
            </mesh>
          );
        });
      })()}

      {skirts && (() => {
        const n = readNudge(skirts.params);
        const depth = paramN(skirts.params, "depth", 70) / 1000;
        return [
          { side: -1, anchor: a.skirtsLeft },
          { side: 1, anchor: a.skirtsRight },
        ].map(({ side, anchor }) => {
          const p = nudged(anchor, n);
          return (
            <mesh key={side} position={[p.x, p.y, p.z]} material={partMat} castShadow>
              <boxGeometry args={[length * 0.55, depth, 0.04]} />
            </mesh>
          );
        });
      })()}

      {wideArch && (() => {
        const n = readNudge(wideArch.params);
        const flare = paramN(wideArch.params, "flare", 50) / 1000;
        return [
          { side: -1, anchor: a.skirtsLeft, x: a.splitter.x - 0.6 },
          { side: 1, anchor: a.skirtsRight, x: a.splitter.x - 0.6 },
          { side: -1, anchor: a.skirtsLeft, x: a.wing.x + 0.5 },
          { side: 1, anchor: a.skirtsRight, x: a.wing.x + 0.5 },
        ].map((s, i) => {
          const p = nudged(s.anchor, n);
          return (
            <mesh
              key={i}
              position={[s.x, p.y + height * 0.25, p.z + (s.side * flare) / 2]}
              material={partMat}
              castShadow
            >
              <boxGeometry args={[0.5, 0.18, flare]} />
            </mesh>
          );
        });
      })()}

      {ducktail && (() => {
        const n = readNudge(ducktail.params);
        const h = paramN(ducktail.params, "height", 38) / 1000;
        const p = nudged(a.ducktail, n);
        return (
          <mesh position={[p.x, p.y, p.z]} rotation={[0, 0, 0.25]} material={partMat} castShadow>
            <boxGeometry args={[0.22, h, width * 0.85]} />
          </mesh>
        );
      })()}

      {wing && (() => {
        const n = readNudge(wing.params);
        const aoa = paramN(wing.params, "aoa", 8) * Math.PI / 180;
        const chord = paramN(wing.params, "chord", 280) / 1000;
        const gurney = paramN(wing.params, "gurney", 12) / 1000;
        const p = nudged(a.wing, n);
        return (
          <group position={[p.x, p.y, p.z]}>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[0, -0.1, (width * 0.32) * side]} material={partMat} castShadow>
                <boxGeometry args={[0.04, 0.22, 0.04]} />
              </mesh>
            ))}
            <mesh rotation={[0, 0, -aoa]} material={partMat} castShadow>
              <boxGeometry args={[chord, 0.025, width * 0.78]} />
            </mesh>
            <mesh position={[-chord / 2, 0.012 + gurney / 2, 0]} material={accentMat}>
              <boxGeometry args={[0.012, gurney, width * 0.78]} />
            </mesh>
          </group>
        );
      })()}

      {diffuser && (() => {
        const n = readNudge(diffuser.params);
        const angle = paramN(diffuser.params, "angle", 10) * Math.PI / 180;
        const p = nudged(a.diffuser, n);
        return (
          <mesh
            position={[p.x - 0.15, p.y, p.z]}
            rotation={[0, 0, angle]}
            material={partMat}
            castShadow
          >
            <boxGeometry args={[0.4, 0.025, width * 0.8]} />
          </mesh>
        );
      })()}
    </group>
  );
}

/* ─── Camera control ───────────────────────────────────── */
function CameraRig({ preset }: { preset: CameraPreset }) {
  useFrame(({ camera, controls }: any) => {
    if (preset === "free") return;
    let target: [number, number, number] = [4, 1.5, 4];
    if (preset === "front_three_quarter") target = [4.5, 1.6, 3.5];
    if (preset === "rear_three_quarter") target = [-4.5, 1.6, -3.5];
    if (preset === "side") target = [0, 1.4, 5];
    if (preset === "top") target = [0, 5.5, 0.01];
    camera.position.lerp(new THREE.Vector3(...target), 0.08);
    if (controls) {
      controls.target.lerp(new THREE.Vector3(0, 0.7, 0), 0.08);
      controls.update();
    }
  });
  return null;
}

/** Captures the live scene + camera into refs so the parent can re-render on demand. */
function SceneCapturer({
  sceneRef,
  cameraRef,
}: {
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
}) {
  const { scene, camera } = useThree();
  useEffect(() => {
    sceneRef.current = scene;
    cameraRef.current = camera;
  }, [scene, camera, sceneRef, cameraRef]);
  return null;
}

export const CarViewer3D = forwardRef<CarViewer3DHandle, CarViewer3DProps>(function CarViewer3D(
  { template, geometry, parts = [], hideParts, className, preset = "free", partVisibility },
  ref,
) {
  const { url: meshUrl } = useSignedMeshUrl(geometry?.stl_path ?? null);
  const ext = meshExtension(geometry?.stl_path ?? null);
  const [meshLoaded, setMeshLoaded] = useState(false);
  const [meshBounds, setMeshBounds] = useState<MeshBounds | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);

  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      const gl = glRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!gl || !scene || !camera) return null;
      try {
        // Force a fresh render so the drawing buffer is populated right now,
        // then read it back. Without this, toDataURL often returns a blank
        // image because the buffer has been cleared since the last paint.
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/jpeg", 0.92);
      } catch {
        return null;
      }
    },
  }), []);

  const showUserMesh = !!(meshUrl && ext);
  const anchors = useMemo(
    () =>
      computeAnchors(
        template,
        showUserMesh && meshLoaded ? meshBounds : null,
        {
          front_mm: geometry?.ride_height_front_mm,
          rear_mm: geometry?.ride_height_rear_mm,
        },
      ),
    [template, geometry?.ride_height_front_mm, geometry?.ride_height_rear_mm, showUserMesh, meshLoaded, meshBounds],
  );

  return (
    <div className={"relative h-full w-full " + (className ?? "")}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [4.5, 1.8, 4.2], fov: 35 }}
        onCreated={({ gl }) => {
          glRef.current = gl;
          canvasRef.current = gl.domElement;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.95;
        }}
      >
        <SceneCapturer sceneRef={sceneRef} cameraRef={cameraRef} />
        <color attach="background" args={["#06080c"]} />
        <fog attach="fog" args={["#06080c", 14, 28]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[6, 8, 4]}
          intensity={1.4}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <spotLight position={[-4, 5, -3]} intensity={0.6} color="#22d3ee" />

        <Suspense fallback={null}>
          <Environment preset="studio" />
        </Suspense>

        <CameraRig preset={preset} />
        <OrbitControls
          enablePan={false}
          minDistance={3}
          maxDistance={12}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 2 - 0.05}
          target={[0, 0.7, 0]}
        />

        {showUserMesh ? (
          <UserMesh
            url={meshUrl!}
            ext={ext!}
            template={template}
            geometry={geometry}
            onLoaded={setMeshLoaded}
            onBounds={setMeshBounds}
          />
        ) : (
          <PlaceholderCar template={template} geometry={geometry} />
        )}

        {!hideParts && (
          <FittedParts parts={parts} anchors={anchors} visibility={partVisibility} />
        )}

        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={14} blur={2.4} far={4} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <circleGeometry args={[14, 64]} />
          <meshStandardMaterial color="#08101a" roughness={0.95} metalness={0.1} />
        </mesh>
      </Canvas>
    </div>
  );
});
