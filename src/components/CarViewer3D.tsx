/**
 * CarViewer3D — premium real-time 3D aero visualisation.
 *
 * This is the showpiece of the app. It renders an approximate, geometry-aware
 * car model derived from car_template dimensions and overlays comparative aero
 * visualisations: estimated streamlines, approximate pressure heatmap, wake
 * plume and force direction indicators.
 *
 * Honest positioning:
 *   - The 3D model is a parametric procedural representation, not a digital
 *     twin of the user's exact vehicle.
 *   - The flow / pressure / wake overlays are *estimated* / *approximate* —
 *     they are seeded by the integrated forces from the surrogate aero
 *     estimator and react to component params, but they are not a CFD field.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  ContactShadows,
  Float,
  Html,
  Bounds,
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { OBJLoader } from "three-stdlib";
import type { AeroComponent, CarTemplate, Geometry } from "@/lib/repo";
import type { AeroEstimate } from "@/lib/aero-estimator";
import type { PackageMode } from "@/lib/aero-package-modes";
import { getPackageMode } from "@/lib/aero-package-modes";
import { useSignedMeshUrl, meshExtension } from "@/lib/mesh-url";
import { readOrientation } from "@/components/MeshOrientation";
import { computeAnchors, readNudge, nudged, type AeroAnchors, type MeshBounds } from "@/lib/aero-anchors";

export type ViewerMode = "flow" | "pressure" | "wake" | "forces" | "compare";

interface CarViewer3DProps {
  template?: CarTemplate | null;
  geometry?: Geometry | null;
  components?: AeroComponent[];
  estimate: AeroEstimate;
  baselineEstimate?: AeroEstimate;
  mode: ViewerMode;
  packageMode?: PackageMode;
  /** When true, renders a ghost baseline car next to current variant */
  compareGhost?: boolean;
  className?: string;
}

const PRIMARY = new THREE.Color("hsl(188, 95%, 55%)".replace("hsl", "").replace("(", "").replace(")", ""));

/* ─── helpers ──────────────────────────────────────────── */
function paramN(p: any, key: string, dflt = 0): number {
  const v = p?.[key];
  return typeof v === "number" ? v : dflt;
}

function findComponent(components: AeroComponent[] = [], kind: string) {
  return components.find((c) => c.kind === kind && c.enabled);
}

/* ─── User-uploaded mesh (STL / OBJ) ───────────────────── */
/**
 * Loads a signed-URL STL/OBJ and auto-fits it to the template's wheelbase
 * so it occupies roughly the same volume as the procedural body.
 * Falls back silently to nothing on error — caller renders the procedural
 * body when this returns null via the `loaded` callback.
 */
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
      // 1) Apply user-chosen up-axis correction by wrapping in a parent group.
      //    Three.js is Y-up; many CAD/STL exports are Z-up or X-up.
      const wrapper = new THREE.Group();
      if (orientation.upAxis === "z") {
        // Z-up → Y-up: rotate -90° around X
        obj.rotation.x = -Math.PI / 2;
      } else if (orientation.upAxis === "x") {
        // X-up → Y-up: rotate +90° around Z
        obj.rotation.z = Math.PI / 2;
      }
      wrapper.add(obj);

      // 2) Apply yaw (around world Y) and optional 180° flip on the wrapper.
      wrapper.rotation.y =
        (orientation.yawDeg * Math.PI) / 180 +
        (orientation.flipForward ? Math.PI : 0);

      // 3) Now fit the rotated wrapper.
      const box = new THREE.Box3().setFromObject(wrapper);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longest = Math.max(size.x, size.y, size.z);
      if (!isFinite(longest) || longest === 0) return wrapper;
      const scale = targetLength / longest;
      wrapper.scale.setScalar(scale);
      // recentre & rest on ground
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
  }, [url, ext, template?.wheelbase_mm, template?.track_front_mm, template?.frontal_area_m2, geometry?.ride_height_front_mm, geometry?.ride_height_rear_mm, (geometry?.metadata as any)?.mesh_orientation?.upAxis, (geometry?.metadata as any)?.mesh_orientation?.yawDeg, (geometry?.metadata as any)?.mesh_orientation?.flipForward, onLoaded, onBounds]);

  if (!object) return null;
  return <primitive object={object} />;
}

/* ─── Procedural car geometry ──────────────────────────── */
/**
 * Builds a stylised low-poly coupe whose proportions are driven by the
 * template (wheelbase, track, frontal area) so different cars look different.
 */
function CarBody({
  template,
  geometry,
  ghost = false,
}: {
  template?: CarTemplate | null;
  geometry?: Geometry | null;
  ghost?: boolean;
}) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const track = (template?.track_front_mm ?? 1520) / 1000;
  const fa = template?.frontal_area_m2 ?? 2.04;
  // derive width / height from frontal area + track
  const width = Math.max(track + 0.05, 1.7);
  const height = Math.max(0.45, fa / Math.max(width, 1.4) * 0.85);
  const length = wheelbase + 1.45; // overhangs
  const ride = ((geometry?.ride_height_front_mm ?? 130) + (geometry?.ride_height_rear_mm ?? 135)) / 2 / 1000;

  // Body is built as a stack of beveled boxes for a coupe silhouette
  const bodyMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: ghost ? "#444a58" : "#0a1622",
        metalness: 0.85,
        roughness: 0.28,
        clearcoat: 1.0,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.4,
        transparent: ghost,
        opacity: ghost ? 0.35 : 1,
      }),
    [ghost],
  );
  const greenhouseMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#020610",
        metalness: 0.4,
        roughness: 0.15,
        transmission: ghost ? 0 : 0.25,
        thickness: 0.5,
        envMapIntensity: 1.6,
        transparent: ghost,
        opacity: ghost ? 0.25 : 1,
      }),
    [ghost],
  );

  const baseY = ride + 0.15;

  return (
    <group position={[0, 0, 0]}>
      {/* main body shell */}
      <mesh castShadow receiveShadow position={[0, baseY, 0]} material={bodyMat}>
        <boxGeometry args={[length, height, width]} />
      </mesh>
      {/* nose taper */}
      <mesh castShadow position={[length / 2 - 0.25, baseY - 0.05, 0]} rotation={[0, 0, -0.12]} material={bodyMat}>
        <boxGeometry args={[0.7, height * 0.7, width * 0.95]} />
      </mesh>
      {/* tail */}
      <mesh castShadow position={[-length / 2 + 0.2, baseY - 0.03, 0]} rotation={[0, 0, 0.08]} material={bodyMat}>
        <boxGeometry args={[0.6, height * 0.78, width * 0.96]} />
      </mesh>
      {/* greenhouse / cabin */}
      <mesh castShadow position={[-0.05, baseY + height * 0.55, 0]} material={greenhouseMat}>
        <boxGeometry args={[length * 0.5, height * 0.5, width * 0.85]} />
      </mesh>
      {/* roof slope front */}
      <mesh castShadow position={[length * 0.18, baseY + height * 0.45, 0]} rotation={[0, 0, -0.35]} material={greenhouseMat}>
        <boxGeometry args={[0.5, height * 0.55, width * 0.85]} />
      </mesh>
      {/* roof slope rear */}
      <mesh castShadow position={[-length * 0.22, baseY + height * 0.45, 0]} rotation={[0, 0, 0.28]} material={greenhouseMat}>
        <boxGeometry args={[0.55, height * 0.5, width * 0.85]} />
      </mesh>

      {/* wheels */}
      {[
        [length / 2 - 0.55, ride + 0.05, width / 2 - 0.05],
        [length / 2 - 0.55, ride + 0.05, -width / 2 + 0.05],
        [-length / 2 + 0.55, ride + 0.05, width / 2 - 0.05],
        [-length / 2 + 0.55, ride + 0.05, -width / 2 + 0.05],
      ].map((p, i) => (
        <Wheel key={i} position={p as [number, number, number]} ghost={ghost} />
      ))}

      {/* underbody plate hint */}
      {!ghost && (
        <mesh position={[0, ride + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[length * 0.95, width * 0.85]} />
          <meshStandardMaterial color="#020610" metalness={0.3} roughness={0.7} />
        </mesh>
      )}
    </group>
  );
}

function Wheel({ position, ghost }: { position: [number, number, number]; ghost?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current && !ghost) ref.current.rotation.x += dt * 4.5;
  });
  return (
    <group position={position}>
      <mesh ref={ref} castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.32, 0.32, 0.22, 28]} />
        <meshStandardMaterial color={ghost ? "#3b3f48" : "#0a0d12"} metalness={0.6} roughness={0.4} />
      </mesh>
      {!ghost && (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.21, 0.018, 12, 28]} />
          <meshStandardMaterial color="#1a8fa5" emissive="#0a3f4a" emissiveIntensity={0.4} metalness={0.9} roughness={0.3} />
        </mesh>
      )}
    </group>
  );
}

/* ─── Aero parts (parametric add-ons) ─────────────────────────── */
function AeroParts({
  template,
  components = [],
  packageMode,
}: {
  template?: CarTemplate | null;
  components?: AeroComponent[];
  packageMode?: PackageMode;
}) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wheelbase + 1.45;
  const fa = template?.frontal_area_m2 ?? 2.04;
  const width = Math.max((template?.track_front_mm ?? 1520) / 1000 + 0.05, 1.7);
  const height = Math.max(0.45, fa / Math.max(width, 1.4) * 0.85);

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

  const pkg = getPackageMode(packageMode);
  const intensity = pkg.intensity;

  const splitter = findComponent(components, "splitter");
  const wing = findComponent(components, "wing");
  const diffuser = findComponent(components, "diffuser");
  const skirts = findComponent(components, "skirts");
  const canards = findComponent(components, "canards");
  const ducktail = findComponent(components, "ducktail");

  return (
    <group>
      {/* SPLITTER */}
      {splitter && (
        <mesh
          position={[length / 2 - 0.05 + paramN(splitter.params, "splProtrusion", 60) / 2000, 0.085, 0]}
          material={partMat}
          castShadow
        >
          <boxGeometry
            args={[
              paramN(splitter.params, "splProtrusion", 60) / 1000,
              0.02,
              width * 0.95,
            ]}
          />
        </mesh>
      )}

      {/* CANARDS */}
      {canards &&
        [-1, 1].map((side) => (
          <mesh
            key={side}
            position={[length / 2 - 0.45, 0.32, (width / 2 - 0.06) * side]}
            rotation={[0, 0, paramN(canards.params, "canAngle", 12) * Math.PI / 180 * -side]}
            material={accentMat}
            castShadow
          >
            <boxGeometry args={[0.18, 0.012, 0.16]} />
          </mesh>
        ))}

      {/* SIDE SKIRTS */}
      {skirts &&
        [-1, 1].map((side) => (
          <mesh
            key={side}
            position={[0, 0.1, (width / 2 + 0.005) * side]}
            material={partMat}
            castShadow
          >
            <boxGeometry args={[length * 0.55, paramN(skirts.params, "skDepth", 70) / 1000, 0.04]} />
          </mesh>
        ))}

      {/* DUCKTAIL */}
      {ducktail && (
        <mesh
          position={[-length / 2 + 0.15, 0.1 + height * 0.95, 0]}
          rotation={[0, 0, 0.25]}
          material={partMat}
          castShadow
        >
          <boxGeometry args={[0.22, paramN(ducktail.params, "duckHeight", 38) / 1000, width * 0.85]} />
        </mesh>
      )}

      {/* REAR WING */}
      {wing && (
        <group position={[-length / 2 + 0.12, 0.1 + height + 0.18 + intensity * 0.05, 0]}>
          {/* uprights */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[0, -0.1, (width * 0.32) * side]} material={partMat} castShadow>
              <boxGeometry args={[0.04, 0.22, 0.04]} />
            </mesh>
          ))}
          {/* main plane */}
          <mesh
            rotation={[0, 0, -paramN(wing.params, "aoa", 8) * Math.PI / 180]}
            material={partMat}
            castShadow
          >
            <boxGeometry args={[paramN(wing.params, "chord", 280) / 1000, 0.025, width * 0.78]} />
          </mesh>
          {/* gurney lip */}
          <mesh
            position={[-paramN(wing.params, "chord", 280) / 2000, 0.012 + paramN(wing.params, "gurney", 12) / 2000, 0]}
            material={accentMat}
          >
            <boxGeometry args={[0.012, paramN(wing.params, "gurney", 12) / 1000, width * 0.78]} />
          </mesh>
          {/* second element if applicable */}
          {paramN(wing.params, "elements", 2) > 1 && (
            <mesh
              position={[paramN(wing.params, "chord", 280) / 2500, 0.06, 0]}
              rotation={[0, 0, -paramN(wing.params, "aoa", 8) * Math.PI / 180 * 1.2]}
              material={partMat}
              castShadow
            >
              <boxGeometry args={[paramN(wing.params, "chord", 280) / 1500, 0.02, width * 0.74]} />
            </mesh>
          )}
        </group>
      )}

      {/* DIFFUSER */}
      {diffuser && (
        <mesh
          position={[-length / 2 + 0.08, 0.06, 0]}
          rotation={[0, 0, paramN(diffuser.params, "diffAngle", 11) * Math.PI / 180]}
          material={partMat}
          castShadow
        >
          <boxGeometry args={[paramN(diffuser.params, "diffLength", 780) / 1500, 0.018, width * 0.85]} />
        </mesh>
      )}
    </group>
  );
}

/* ─── Streamlines (Estimated Flow) ────────────────────── */
function Streamlines({
  visible,
  intensity = 0.7,
  template,
  estimate,
}: {
  visible: boolean;
  intensity?: number;
  template?: CarTemplate | null;
  estimate: AeroEstimate;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wheelbase + 1.45;

  // Number of streamlines reacts to package intensity + relative downforce
  const lineCount = Math.round(36 * intensity + Math.min(20, Math.abs(estimate.df_total_kgf) / 20));
  const lines = useMemo(() => {
    const out: { points: THREE.Vector3[]; offset: number }[] = [];
    for (let i = 0; i < lineCount; i++) {
      const z = (i / (lineCount - 1) - 0.5) * 1.9;
      const yStart = 0.15 + (i % 7) * 0.12;
      const pts: THREE.Vector3[] = [];
      for (let t = 0; t <= 1; t += 0.025) {
        const x = length * 1.4 - t * length * 3.4;
        // Flow goes over the body — bend up around mid, dip behind
        const bumpUp =
          Math.exp(-Math.pow((x - 0.2) / 1.0, 2)) * (0.55 - Math.abs(z) * 0.25);
        const wakeDip =
          x < -length / 2
            ? Math.sin((x + length / 2) * 4) * 0.15 * Math.exp((x + length / 2) * 1.2)
            : 0;
        const y = yStart + bumpUp + wakeDip;
        pts.push(new THREE.Vector3(x, y, z));
      }
      out.push({ points: pts, offset: Math.random() });
    }
    return out;
  }, [length, lineCount]);

  useFrame((state) => {
    if (!groupRef.current || !visible) return;
    const t = state.clock.elapsedTime;
    groupRef.current.children.forEach((line, i) => {
      const mat = (line as THREE.Line).material as THREE.LineBasicMaterial & { opacity: number };
      if (mat) {
        // Animate opacity to fake flow motion since dashed lines need geometry.computeLineDistances
        mat.opacity = (0.45 - (i % 8) * 0.04) * (0.6 + Math.sin(t * 1.6 + i * 0.3) * 0.4);
      }
    });
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      {lines.map((l, i) => (
        <line key={i}>
          <bufferGeometry
            attach="geometry"
            ref={(geo) => {
              if (geo) {
                geo.setFromPoints(l.points);
                (geo as any).computeBoundingSphere?.();
              }
            }}
          />
          <lineBasicMaterial
            attach="material"
            color="#22d3ee"
            transparent
            opacity={0.45 - (i % 8) * 0.04}
            linewidth={1}
          />
        </line>
      ))}
    </group>
  );
}

/* ─── Pressure heat zones ──────────────────────────────── */
function PressureZones({
  visible,
  template,
  estimate,
}: {
  visible: boolean;
  template?: CarTemplate | null;
  estimate: AeroEstimate;
}) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wheelbase + 1.45;
  const fa = template?.frontal_area_m2 ?? 2.04;
  const width = Math.max((template?.track_front_mm ?? 1520) / 1000 + 0.05, 1.7);
  const height = Math.max(0.45, fa / Math.max(width, 1.4) * 0.85);

  if (!visible) return null;

  // Front splitter / nose: high pressure (red)
  // Roof / wing top: low pressure (cyan)
  // Underbody: low pressure (cyan, intensity scales with downforce)
  const dfMag = Math.min(1, Math.abs(estimate.df_total_kgf) / 250);

  return (
    <group>
      {/* Stagnation zone (front bumper) */}
      <mesh position={[length / 2 - 0.1, 0.3, 0]}>
        <sphereGeometry args={[0.45, 24, 24]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.18} />
      </mesh>
      {/* Roof low pressure */}
      <mesh position={[0, 0.25 + height + 0.1, 0]}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.16} />
      </mesh>
      {/* Wing low pressure */}
      <mesh position={[-length / 2 + 0.15, 0.4 + height, 0]}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.22 + dfMag * 0.15} />
      </mesh>
      {/* Underbody low pressure */}
      <mesh position={[0, 0.04, 0]} scale={[length * 0.4, 0.1, width * 0.4]}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.12 + dfMag * 0.18} />
      </mesh>
      {/* Side mirror separation */}
      <mesh position={[length * 0.05, height * 0.7 + 0.15, width / 2 - 0.05]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.14} />
      </mesh>
      <mesh position={[length * 0.05, height * 0.7 + 0.15, -width / 2 + 0.05]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color="#f97316" transparent opacity={0.14} />
      </mesh>
    </group>
  );
}

/* ─── Wake plume ───────────────────────────────────────── */
function WakePlume({
  visible,
  template,
  estimate,
}: {
  visible: boolean;
  template?: CarTemplate | null;
  estimate: AeroEstimate;
}) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wheelbase + 1.45;
  const fa = template?.frontal_area_m2 ?? 2.04;
  const width = Math.max((template?.track_front_mm ?? 1520) / 1000 + 0.05, 1.7);
  const groupRef = useRef<THREE.Group>(null);
  const drag = estimate.drag_kgf;
  const wakeSize = 0.7 + Math.min(2.5, drag / 60); // scales with drag

  useFrame((state) => {
    if (!groupRef.current || !visible) return;
    const t = state.clock.elapsedTime;
    groupRef.current.children.forEach((c, i) => {
      const mesh = c as THREE.Mesh;
      mesh.position.x = -length / 2 - 0.3 - i * 0.3 + Math.sin(t * 0.5 + i) * 0.05;
      mesh.rotation.z = t * 0.2 + i;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (0.18 - i * 0.018) * (0.7 + Math.sin(t * 1.2 + i) * 0.1);
    });
  });

  if (!visible) return null;

  return (
    <group ref={groupRef}>
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} position={[-length / 2 - 0.3 - i * 0.3, 0.4, 0]}>
          <sphereGeometry args={[wakeSize * (1 + i * 0.12), 22, 22]} />
          <meshBasicMaterial color="#0891b2" transparent opacity={0.18 - i * 0.018} depthWrite={false} />
        </mesh>
      ))}
      {/* Counter-rotating vortex hint */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[-length / 2 - 0.6, 0.45, side * width * 0.3]}>
          <torusGeometry args={[0.3 + drag / 400, 0.05, 12, 24]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.35} />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Force arrows ─────────────────────────────────────── */
function ForceArrows({
  visible,
  template,
  estimate,
}: {
  visible: boolean;
  template?: CarTemplate | null;
  estimate: AeroEstimate;
}) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wheelbase + 1.45;

  if (!visible) return null;

  // Drag arrow (rear-pointing, red)
  const dragLen = Math.min(2.2, estimate.drag_kgf / 80);
  // Front DF arrow (down-pointing if positive DF)
  const dfFrontLen = Math.min(1.5, Math.abs(estimate.df_front_kgf) / 80);
  const dfFrontDir = estimate.df_front_kgf > 0 ? -1 : 1; // 1 = up = lift
  const dfRearLen = Math.min(1.5, Math.abs(estimate.df_rear_kgf) / 80);
  const dfRearDir = estimate.df_rear_kgf > 0 ? -1 : 1;

  return (
    <group>
      <Arrow
        from={[0, 1.2, 0]}
        to={[-dragLen, 1.2, 0]}
        color="#ef4444"
        label={`Drag ${estimate.drag_kgf} kgf`}
      />
      <Arrow
        from={[length / 2 - 0.5, 0.9, 0]}
        to={[length / 2 - 0.5, 0.9 + dfFrontDir * dfFrontLen, 0]}
        color={estimate.df_front_kgf > 0 ? "#22d3ee" : "#f97316"}
        label={`Front ${estimate.df_front_kgf > 0 ? "+" : ""}${estimate.df_front_kgf} kgf`}
      />
      <Arrow
        from={[-length / 2 + 0.5, 0.9, 0]}
        to={[-length / 2 + 0.5, 0.9 + dfRearDir * dfRearLen, 0]}
        color={estimate.df_rear_kgf > 0 ? "#22d3ee" : "#f97316"}
        label={`Rear ${estimate.df_rear_kgf > 0 ? "+" : ""}${estimate.df_rear_kgf} kgf`}
      />
    </group>
  );
}

function Arrow({
  from,
  to,
  color,
  label,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  label?: string;
}) {
  const start = useMemo(() => new THREE.Vector3(...from), [from]);
  const end = useMemo(() => new THREE.Vector3(...to), [to]);
  const dir = useMemo(() => end.clone().sub(start), [end, start]);
  const len = dir.length();
  const midPoint = useMemo(() => start.clone().add(dir.clone().multiplyScalar(0.5)), [start, dir]);
  const orientation = useMemo(() => {
    const d = dir.clone().normalize();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    return q;
  }, [dir]);
  if (len < 0.05) return null;
  return (
    <group>
      <mesh position={midPoint.toArray()} quaternion={orientation}>
        <cylinderGeometry args={[0.025, 0.025, len * 0.85, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      <mesh position={end.toArray()} quaternion={orientation}>
        <coneGeometry args={[0.07, 0.18, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
      </mesh>
      {label && (
        <Html position={end.toArray()} center distanceFactor={8} style={{ pointerEvents: "none" }}>
          <div className="text-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded border border-border bg-surface-1/90 backdrop-blur whitespace-nowrap" style={{ color }}>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ─── Ground floor ─────────────────────────────────────── */
function StudioFloor() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#05080d" metalness={0.2} roughness={0.85} />
      </mesh>
      {/* Grid lines */}
      <gridHelper args={[20, 40, "#1a3a45", "#0c1a22"]} position={[0, 0.001, 0]} />
    </>
  );
}

/* ─── Car shell — uploaded mesh OR procedural body ────── */
function CarShell({
  template,
  geometry,
}: {
  template?: CarTemplate | null;
  geometry?: Geometry | null;
}) {
  const { url } = useSignedMeshUrl(geometry?.stl_path);
  const ext = meshExtension(geometry?.stl_path);
  const [loaded, setLoaded] = useState(false);

  // Reset when path changes
  useEffect(() => {
    setLoaded(false);
  }, [geometry?.stl_path]);

  const showProcedural = !url || !ext || !loaded;

  return (
    <>
      {url && ext && (
        <UserMesh
          url={url}
          ext={ext}
          template={template}
          geometry={geometry}
          onLoaded={setLoaded}
        />
      )}
      {showProcedural && <CarBody template={template} geometry={geometry} />}
    </>
  );
}

/* ─── Scene ────────────────────────────────────────────── */
function Scene({
  template,
  geometry,
  components,
  estimate,
  baselineEstimate,
  mode,
  packageMode,
  compareGhost,
}: Omit<CarViewer3DProps, "className">) {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[6, 8, 4]}
        intensity={1.3}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-far={30}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <directionalLight position={[-4, 3, -6]} intensity={0.45} color="#22d3ee" />
      <pointLight position={[0, 4, 0]} intensity={0.4} color="#22d3ee" />

      <Environment preset="city" />

      <Bounds fit clip observe margin={1.4}>
        <Float speed={0.3} rotationIntensity={0} floatIntensity={0.05}>
          <CarShell template={template} geometry={geometry} />
          <AeroParts template={template} components={components} packageMode={packageMode} />
          {compareGhost && (
            <group position={[0, 0, 0]}>
              <CarBody template={template} geometry={geometry} ghost />
            </group>
          )}
          <Streamlines visible={mode === "flow"} intensity={getPackageMode(packageMode).intensity} template={template} estimate={estimate} />
          <PressureZones visible={mode === "pressure"} template={template} estimate={estimate} />
          <WakePlume visible={mode === "wake"} template={template} estimate={estimate} />
          <ForceArrows visible={mode === "forces"} template={template} estimate={estimate} />
        </Float>
      </Bounds>

      <ContactShadows position={[0, 0.001, 0]} opacity={0.6} scale={14} blur={2.2} far={4} />
      <StudioFloor />

      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={14}
        maxPolarAngle={Math.PI / 2 - 0.05}
        autoRotate={mode !== "compare"}
        autoRotateSpeed={0.45}
        enableDamping
        dampingFactor={0.07}
      />
    </>
  );
}

/* ─── Public component ─────────────────────────────────── */
export function CarViewer3D(props: CarViewer3DProps) {
  return (
    <Canvas
      shadows
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [5.5, 2.8, 5.5], fov: 32 }}
      className={props.className}
      style={{ background: "transparent" }}
      dpr={[1, 2]}
    >
      <Suspense fallback={null}>
        <Scene {...props} />
      </Suspense>
    </Canvas>
  );
}
