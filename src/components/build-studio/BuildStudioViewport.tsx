/**
 * BuildStudioViewport — R3F scene for the 3D Build Studio.
 *
 * Renders the donor car (real STL when available, procedural box otherwise),
 * an optional body skin overlay (Shell Fit Mode), the user's placed parts
 * (with their real GLB/STL geometry where uploaded), and snap zones for the
 * current car_template. Selecting a part shows TransformControls; releasing
 * commits to DB and snaps to the nearest snap zone if within threshold.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  GizmoHelper,
  GizmoViewcube,
  Bounds,
} from "@react-three/drei";
import * as THREE from "three";
import { STLLoader, GLTFLoader, TransformControls as TransformControlsImpl } from "three-stdlib";
import type { CarTemplate, LibraryItem } from "@/lib/repo";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";
import type { SnapZone } from "@/lib/build-studio/snap-zones";
import { nearestSnapZone } from "@/lib/build-studio/snap-zones";
import { PartMesh } from "@/components/build-studio/PartMesh";
import { SnapZoneViz } from "@/components/build-studio/SnapZoneViz";
import {
  DEFAULT_PAINT_FINISH,
  DEFAULT_GLASS_FINISH,
  DEFAULT_TYRE_FINISH,
  DEFAULT_WHEEL_FINISH,
  type EnvPreset,
  type MaterialFinish,
  type PaintFinish,
} from "@/lib/build-studio/paint-finish";
import { PostFX } from "@/components/build-studio/PostFX";
import { ShowroomFloor } from "@/components/build-studio/ShowroomFloor";
import { QUALITY_PRESETS, type RenderQuality } from "@/lib/build-studio/render-quality";
import {
  FrameOnDoubleClick,
  PartLabel,
  MeasureTool,
  ClippingPlane,
  type MeasureLine,
  type ClipAxis,
} from "@/components/build-studio/ViewportTools";
import {
  CameraPoseProbe,
  SurfaceStrokeRecorder,
  SurfaceStrokesRenderer,
} from "@/components/build-studio/annotate/SurfaceStrokes";
import type { CameraPose } from "@/lib/build-studio/annotate/store";

export type TransformMode = "translate" | "rotate" | "scale";
export type CameraPreset = "free" | "front" | "rear" | "left" | "right" | "top" | "three_quarter";
/** Active interactive tool. `select` = normal pivot/transform editing. */
export type ViewportTool = "select" | "measure" | "clip";

export interface ShellTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

interface ViewportProps {
  template?: CarTemplate | null;
  /** Signed URL for the project's hero STL (preferred over the box placeholder). */
  heroStlUrl?: string | null;
  /** Optional body skin overlay (Shell Fit Mode). */
  bodySkinUrl?: string | null;
  bodySkinKind?: "stl" | "glb" | null;
  /** Persisted transform of the shell overlay (Shell Fit). */
  shellTransform?: ShellTransform | null;
  /** True when the shell overlay should be the active gizmo target. */
  shellEditMode?: boolean;
  /** Called when the user releases the shell gizmo. */
  onShellCommit?: (t: ShellTransform) => void;
  /**
   * Called once the shell mesh is loaded into the scene. Receives the root
   * Object3D of the loaded shell (in shell-local frame, before user transforms
   * are applied). Used by the parent to run auto-fit / arch detection.
   */
  onShellMeshReady?: (root: THREE.Object3D | null) => void;
  parts: PlacedPart[];
  /** Resolved library_items for placed parts so we can render real meshes. */
  libraryItemsById: Map<string, LibraryItem>;
  /** Snap zones defined for this car_template. */
  snapZones?: SnapZone[];
  showSnapZones: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  transformMode: TransformMode;
  showGrid: boolean;
  preset: CameraPreset;
  /** Render quality preset — drives postprocessing + floor look. */
  quality?: RenderQuality;
  /** Paint Studio finish (color + material + HDRI preset). */
  paintFinish?: PaintFinish | null;
  /** Per-triangle material tags (0=body,1=glass,2=wheel,3=tyre). */
  materialTags?: Uint8Array | null;
  /** Active interactive tool (select / measure / clip). */
  tool?: ViewportTool;
  /** Section axis when tool = 'clip'. */
  clipAxis?: ClipAxis;
  /** Grid snap step in metres for translate (0 = off). */
  translateSnapM?: number;
  /** Rotation snap step in degrees for rotate (0 = off). */
  rotateSnapDeg?: number;
  /** Show floating part-name labels. */
  showLabels?: boolean;
  /** Persistent measurement lines (lifted state). */
  measureLines?: MeasureLine[];
  /** Setter for measurement lines. */
  onMeasureLinesChange?: (lines: MeasureLine[]) => void;
  /** Live camera pose ref — populated by <CameraPoseProbe> for screen markup. */
  livePoseRef?: React.MutableRefObject<CameraPose | null>;
  /** Called once after the hero STL loads with its triangle count. */
  onTriangleCount?: (n: number) => void;
  onCommit: (
    id: string,
    patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale" | "snap_zone_id">>,
  ) => void;
}

/* ─── Real hero STL car (preferred) ─── */
/**
 * The car is rendered as a single THREE.Mesh whose BufferGeometry is split
 * into up to 4 `groups` (body / glass / wheel / tyre). Each group binds to
 * its own MeshPhysicalMaterial in the materials[] array, so users can paint
 * the body without affecting the rims and the glass stays smoky/transparent
 * regardless of body colour. When no material map is available yet, the mesh
 * falls back to a single body material.
 */
function HeroStlCar({
  url,
  template,
  paintFinish,
  materialTags,
  onTriangleCount,
}: {
  url: string;
  template?: CarTemplate | null;
  paintFinish: PaintFinish;
  materialTags?: Uint8Array | null;
  onTriangleCount?: (n: number) => void;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const matRefs = useRef<{
    body: THREE.MeshPhysicalMaterial | null;
    glass: THREE.MeshPhysicalMaterial | null;
    wheel: THREE.MeshPhysicalMaterial | null;
    tyre: THREE.MeshPhysicalMaterial | null;
  }>({ body: null, glass: null, wheel: null, tyre: null });

  useEffect(() => {
    let cancelled = false;
    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => {
        if (cancelled) return;
        geo.computeVertexNormals();

        const triCount = geo.attributes.position.count / 3;
        onTriangleCount?.(triCount);
        const tagsValid = materialTags && materialTags.length === triCount;

        // Build materials in fixed order: 0=body, 1=glass, 2=wheel, 3=tyre.
        const bodyMat = new THREE.MeshPhysicalMaterial({
          color: paintFinish.color,
          metalness: paintFinish.metalness,
          roughness: paintFinish.roughness,
          clearcoat: paintFinish.clearcoat,
          clearcoatRoughness: paintFinish.clearcoat_roughness,
          envMapIntensity: paintFinish.env_intensity,
        });
        matRefs.current.body = bodyMat;

        let materials: THREE.Material[] = [bodyMat];

        if (tagsValid) {
          const glassFinish = paintFinish.glass ?? DEFAULT_GLASS_FINISH;
          const wheelFinish = paintFinish.wheels ?? DEFAULT_WHEEL_FINISH;
          const tyreFinish = paintFinish.tyres ?? DEFAULT_TYRE_FINISH;

          const glassMat = new THREE.MeshPhysicalMaterial({
            color: glassFinish.color,
            metalness: glassFinish.metalness,
            roughness: glassFinish.roughness,
            clearcoat: glassFinish.clearcoat,
            clearcoatRoughness: glassFinish.clearcoat_roughness,
            transparent: true,
            opacity: glassFinish.opacity ?? 0.55,
            transmission: 0.6,
            thickness: 0.05,
            envMapIntensity: paintFinish.env_intensity,
            depthWrite: false,
          });
          const wheelMat = new THREE.MeshPhysicalMaterial({
            color: wheelFinish.color,
            metalness: wheelFinish.metalness,
            roughness: wheelFinish.roughness,
            clearcoat: wheelFinish.clearcoat,
            clearcoatRoughness: wheelFinish.clearcoat_roughness,
            envMapIntensity: paintFinish.env_intensity,
          });
          const tyreMat = new THREE.MeshPhysicalMaterial({
            color: tyreFinish.color,
            metalness: tyreFinish.metalness,
            roughness: tyreFinish.roughness,
            clearcoat: tyreFinish.clearcoat,
            clearcoatRoughness: tyreFinish.clearcoat_roughness,
          });
          matRefs.current.glass = glassMat;
          matRefs.current.wheel = wheelMat;
          matRefs.current.tyre = tyreMat;
          materials = [bodyMat, glassMat, wheelMat, tyreMat];

          // Build geometry groups by sorting triangles by tag so each group
          // is a contiguous run. STLLoader produces non-indexed geometry where
          // every 3 vertices = 1 triangle, so we permute the position buffer.
          const positions = geo.attributes.position.array as Float32Array;
          const normals = geo.attributes.normal.array as Float32Array;
          const triIndices = new Uint32Array(triCount);
          for (let i = 0; i < triCount; i++) triIndices[i] = i;
          // Stable sort by tag.
          triIndices.sort((a, b) => materialTags![a] - materialTags![b]);

          const newPos = new Float32Array(positions.length);
          const newNorm = new Float32Array(normals.length);
          for (let i = 0; i < triCount; i++) {
            const src = triIndices[i] * 9;
            const dst = i * 9;
            for (let k = 0; k < 9; k++) {
              newPos[dst + k] = positions[src + k];
              newNorm[dst + k] = normals[src + k];
            }
          }
          geo.setAttribute("position", new THREE.BufferAttribute(newPos, 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(newNorm, 3));
          geo.attributes.position.needsUpdate = true;
          geo.attributes.normal.needsUpdate = true;

          // Build groups by counting consecutive runs of the same tag.
          geo.clearGroups();
          let runStart = 0;
          let runTag = materialTags![triIndices[0]];
          for (let i = 1; i <= triCount; i++) {
            const t = i < triCount ? materialTags![triIndices[i]] : -1;
            if (t !== runTag) {
              const start = runStart * 3;
              const count = (i - runStart) * 3;
              const matIndex = Math.min(3, Math.max(0, runTag));
              geo.addGroup(start, count, matIndex);
              runStart = i;
              runTag = t;
            }
          }
        }

        const mesh = new THREE.Mesh(geo, materials.length === 1 ? materials[0] : (materials as THREE.Material[]));
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const wrapper = new THREE.Group();
        mesh.rotation.x = -Math.PI / 2; // Z-up → Y-up
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
    // Reload when the URL or the tag map changes (a new classification arriving
    // needs to rebuild the geometry groups).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, template?.wheelbase_mm, materialTags]);

  // Live-apply paint changes without reloading the STL.
  useEffect(() => {
    const apply = (m: THREE.MeshPhysicalMaterial | null, f: MaterialFinish | undefined, env: number) => {
      if (!m || !f) return;
      m.color.set(f.color);
      m.metalness = f.metalness;
      m.roughness = f.roughness;
      m.clearcoat = f.clearcoat;
      m.clearcoatRoughness = f.clearcoat_roughness;
      m.envMapIntensity = env;
      if (f.opacity !== undefined) m.opacity = f.opacity;
      m.needsUpdate = true;
    };
    apply(matRefs.current.body, {
      color: paintFinish.color,
      metalness: paintFinish.metalness,
      roughness: paintFinish.roughness,
      clearcoat: paintFinish.clearcoat,
      clearcoat_roughness: paintFinish.clearcoat_roughness,
    }, paintFinish.env_intensity);
    apply(matRefs.current.wheel, paintFinish.wheels, paintFinish.env_intensity);
    apply(matRefs.current.tyre, paintFinish.tyres, paintFinish.env_intensity);
    apply(matRefs.current.glass, paintFinish.glass, paintFinish.env_intensity);
  }, [paintFinish]);

  if (!object) return null;
  return <primitive object={object} />;
}

/* ─── Body skin overlay (Shell Fit Mode) ─── */
const BodySkinOverlay = function BodySkinOverlay({
  url,
  kind,
  template,
  transform,
  groupRef,
  onReady,
  editing,
  onClick,
  highlight,
}: {
  url: string;
  kind: "stl" | "glb";
  template?: CarTemplate | null;
  transform?: ShellTransform | null;
  groupRef?: React.MutableRefObject<THREE.Group | null>;
  onReady?: (group: THREE.Group | null) => void;
  editing?: boolean;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const localRef = useRef<THREE.Group>(null);
  // Track the materials we created so we can mutate (not rebuild) them when
  // the highlight flag flips. Rebuilding meant re-fetching + re-parsing the
  // entire skin STL on every Shell Fit Mode toggle — multi-second freeze.
  const materialsRef = useRef<THREE.MeshPhysicalMaterial[]>([]);

  useEffect(() => {
    let cancelled = false;
    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

    const onLoaded = (raw: THREE.Object3D) => {
      if (cancelled) return;
      const wrapper = new THREE.Group();
      wrapper.add(raw);

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

      // Translucent orange tint to clearly read it as a skin overlay. Highlight
      // state (opacity/emissive) is applied in a separate effect so toggling
      // Shell Fit Mode doesn't re-run this expensive load.
      const created: THREE.MeshPhysicalMaterial[] = [];
      wrapper.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          const mat = new THREE.MeshPhysicalMaterial({
            color: "#fb923c",
            metalness: 0.2,
            roughness: 0.6,
            transparent: true,
            opacity: 0.42,
            clearcoat: 0.3,
            emissive: "#000000",
            emissiveIntensity: 0,
          });
          m.material = mat;
          created.push(mat);
        }
      });
      materialsRef.current = created;
      setObject(wrapper);
    };

    if (kind === "stl") {
      const loader = new STLLoader();
      loader.load(
        url,
        (geo) => {
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo);
          mesh.rotation.x = -Math.PI / 2;
          onLoaded(mesh);
        },
        undefined,
        () => {
          if (!cancelled) setObject(null);
        },
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => onLoaded(gltf.scene),
        undefined,
        () => {
          if (!cancelled) setObject(null);
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, [url, kind, template?.wheelbase_mm]);

  // Cheap material mutation when highlight flips — no reload, no reparse.
  useEffect(() => {
    for (const mat of materialsRef.current) {
      mat.opacity = highlight ? 0.55 : 0.42;
      mat.emissive.set(highlight ? "#7c2d12" : "#000000");
      mat.emissiveIntensity = highlight ? 0.15 : 0;
      mat.needsUpdate = true;
    }
  }, [highlight, object]);

  // Apply transform when it changes (without overriding gizmo dragging).
  useEffect(() => {
    const g = localRef.current;
    if (!g || !transform) return;
    // Don't fight the gizmo while the user is editing — the gizmo writes
    // directly to the group transform; we only sync from props when *not* editing.
    if (editing) return;
    g.position.set(transform.position.x, transform.position.y, transform.position.z);
    g.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
    g.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  }, [transform, editing]);

  // Notify parent once the group is actually mounted in the scene graph
  // (ref callbacks fire before parent attachment; TransformControls requires
  // a valid object.parent to drag).
  useEffect(() => {
    if (!object) {
      onReady?.(null);
      return;
    }
    onReady?.(localRef.current ?? null);
    return () => onReady?.(null);
  }, [object, onReady]);

  if (!object) return null;
  return (
    <group
      ref={(node) => {
        localRef.current = node;
        if (groupRef) groupRef.current = node;
      }}
      name="shell-overlay"
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <primitive object={object} />
    </group>
  );
};

/* ─── Procedural car placeholder (fallback) ─── */
function CarPlaceholder({ template }: { template?: CarTemplate | null }) {
  const wb = (template?.wheelbase_mm ?? 2575) / 1000;
  const tr = (template?.track_front_mm ?? 1520) / 1000;
  const length = wb + 1.45;
  const width = Math.max(tr + 0.05, 1.7);
  const height = 1.32;

  return (
    <group position={[0, height / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[length, height * 0.55, width]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-length * 0.05, height * 0.45, 0]} castShadow>
        <boxGeometry args={[length * 0.55, height * 0.35, width * 0.92]} />
        <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.3} />
      </mesh>
      {[
        [length * 0.35, -height * 0.27, width * 0.5],
        [length * 0.35, -height * 0.27, -width * 0.5],
        [-length * 0.35, -height * 0.27, width * 0.5],
        [-length * 0.35, -height * 0.27, -width * 0.5],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.32, 0.22, 24]} />
          <meshStandardMaterial color="#0a0a0a" />
        </mesh>
      ))}
    </group>
  );
}

/* ─── Single placed part wrapper (transform + mesh) ─── */
/**
 * Single placed part scene node. Editing is handled by a world-space
 * TransformControls instance mounted at the viewport level so move axes never
 * inherit a part's local rotation.
 */
function PlacedPartGroup({
  part,
  libraryItem,
  selected,
  showLabel,
  onSelect,
  onFrame,
}: {
  part: PlacedPart;
  libraryItem: LibraryItem | null;
  selected: boolean;
  showLabel: boolean;
  onSelect: () => void;
  onFrame: (object: THREE.Object3D) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  if (part.hidden) return null;

  const inner = (
    <group
      ref={groupRef}
      name={`placed-${part.id}`}
      position={[part.position.x, part.position.y, part.position.z]}
      rotation={[part.rotation.x, part.rotation.y, part.rotation.z]}
      scale={[part.scale.x, part.scale.y, part.scale.z]}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (groupRef.current) onFrame(groupRef.current);
      }}
    >
      <PartMesh libraryItem={libraryItem} selected={selected} locked={part.locked} />
      {showLabel && (
        <PartLabel
          position={[0, 0.18, 0]}
          text={part.part_name ?? "Part"}
          tone={selected ? "primary" : "default"}
        />
      )}
    </group>
  );

  return inner;
}


/* ─── Camera preset driver ─── */
function CameraRig({ preset, template }: { preset: CameraPreset; template?: CarTemplate | null }) {
  const { camera } = useThree();
  const wb = (template?.wheelbase_mm ?? 2575) / 1000;
  const length = wb + 1.45;
  const dist = length * 1.8;

  useEffect(() => {
    if (preset === "free") return;
    const targets: Record<Exclude<CameraPreset, "free">, [number, number, number]> = {
      front: [dist, 1.2, 0],
      rear: [-dist, 1.2, 0],
      left: [0, 1.2, -dist],
      right: [0, 1.2, dist],
      top: [0.001, dist, 0],
      three_quarter: [dist * 0.75, dist * 0.55, dist * 0.75],
    };
    const t = targets[preset];
    camera.position.set(t[0], t[1], t[2]);
    camera.lookAt(0, 0.6, 0);
  }, [preset, dist, camera]);

  return null;
}

export function BuildStudioViewport({
  template,
  heroStlUrl,
  bodySkinUrl,
  bodySkinKind,
  shellTransform,
  shellEditMode,
  onShellCommit,
  onShellMeshReady,
  parts,
  libraryItemsById,
  snapZones = [],
  showSnapZones,
  selectedId,
  onSelect,
  transformMode,
  showGrid,
  preset,
  quality = "studio",
  paintFinish,
  materialTags,
  tool = "select",
  clipAxis = "x",
  translateSnapM = 0,
  rotateSnapDeg = 0,
  showLabels = true,
  measureLines = [],
  onMeasureLinesChange,
  livePoseRef,
  onTriangleCount,
  onCommit,
}: ViewportProps) {
  const finish: PaintFinish = paintFinish ?? DEFAULT_PAINT_FINISH;
  const settings = QUALITY_PRESETS[quality];
  const orbitRef = useRef<any>(null);
  const shellGroupRef = useRef<THREE.Group | null>(null);
  const transformInteractionRef = useRef(false);
  const selected = parts.find((p) => p.id === selectedId) ?? null;
  const [meshNode, setMeshNode] = useState<THREE.Object3D | null>(null);
  const [shellNode, setShellNode] = useState<THREE.Object3D | null>(null);
  const sceneRootRef = useRef<THREE.Group | null>(null);

  const showShellGizmo = !!shellEditMode && !!bodySkinUrl && !!shellNode;

  // Forward the loaded shell to the parent so it can run auto-fit / arch detection.
  useEffect(() => {
    onShellMeshReady?.(shellNode ?? null);
  }, [shellNode, onShellMeshReady]);

  // mm per scene-unit. We scale the car so its longest side ≈ wheelbase + 1.45m,
  // so 1 scene unit = 1 metre = 1000 mm.
  const worldToMm = 1000;
  const carLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

  return (
    <Canvas
      shadows
      camera={{ position: [4.5, 3, 4.5], fov: 38, near: 0.1, far: 100 }}
      onPointerMissed={() => {
        if (transformInteractionRef.current) return;
        if (tool === "select") onSelect(null);
      }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true, localClippingEnabled: true }}
    >
      <color attach="background" args={["#0a0a0c"]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-6, 4, -3]} intensity={0.45} color="#fb923c" />

      <Suspense fallback={null}>
        <Environment preset={finish.env_preset} />
      </Suspense>

      {showGrid && (
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
      )}

      <ShowroomFloor reflector={settings.reflectorFloor} accumulative={settings.accumulativeShadows} />

      {/* Bounds wraps everything that should be framed by double-click. */}
      <Bounds clip observe margin={1.2}>
        <FrameOnDoubleClick scene={sceneRootRef.current} />
        <group ref={sceneRootRef}>
          {heroStlUrl ? (
            <Suspense fallback={<CarPlaceholder template={template} />}>
              <HeroStlCar url={heroStlUrl} template={template} paintFinish={finish} materialTags={materialTags ?? null} onTriangleCount={onTriangleCount} />
            </Suspense>
          ) : (
            <CarPlaceholder template={template} />
          )}

          {bodySkinUrl && bodySkinKind && (
            <Suspense fallback={null}>
              <BodySkinOverlay
                url={bodySkinUrl}
                kind={bodySkinKind}
                template={template}
                transform={shellTransform ?? null}
                groupRef={shellGroupRef}
                onReady={setShellNode}
                editing={!!shellEditMode}
                highlight={!!shellEditMode}
              />
            </Suspense>
          )}

          {showSnapZones && snapZones.map((z) => (
            <SnapZoneViz
              key={z.id}
              zone={z}
              active={selected?.snap_zone_id === z.id}
              showLabel
            />
          ))}

          <SceneParts
            parts={parts}
            libraryItemsById={libraryItemsById}
            selectedId={selectedId}
            showLabels={showLabels && tool === "select"}
            onSelect={onSelect}
            onMeshFound={setMeshNode}
            onFrame={(obj) => {
              window.dispatchEvent(new CustomEvent("apex:frame-object", { detail: { object: obj } }));
            }}
          />
        </group>
      </Bounds>

      {tool === "select" && !shellEditMode && selected && meshNode && !selected.locked && (
        <PartTransformGizmo
          object={meshNode}
          mode={transformMode}
          size={0.75}
          space={transformMode === "translate" ? "world" : "local"}
          translateSnapM={translateSnapM}
          rotateSnapDeg={rotateSnapDeg}
          orbitRef={orbitRef}
          interactionRef={transformInteractionRef}
          onRelease={() => {
            const g = meshNode;
            onCommit(selected.id, {
              position: { x: g.position.x, y: g.position.y, z: g.position.z },
              rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
              scale: { x: g.scale.x, y: g.scale.y, z: g.scale.z },
            });
          }}
        />
      )}

      {/* Shell-fit gizmo stays a TransformControls (axis-locked feel works
          better for big body alignments than a free pivot). */}
      {showShellGizmo && shellNode && (
        <PartTransformGizmo
          object={shellNode}
          mode={transformMode}
          size={0.9}
          orbitRef={orbitRef}
          interactionRef={transformInteractionRef}
          onRelease={() => {
            const g = shellNode as THREE.Group;
            if (!g || !onShellCommit) return;
            onShellCommit({
              position: { x: g.position.x, y: g.position.y, z: g.position.z },
              rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
              scale: { x: g.scale.x, y: g.scale.y, z: g.scale.z },
            });
          }}
        />
      )}

      {/* Measurement tool — clicks pick on the scene root only (parts + car). */}
      <MeasureTool
        enabled={tool === "measure"}
        lines={measureLines}
        setLines={(l) => onMeasureLinesChange?.(l)}
        pickRoot={sceneRootRef.current}
        worldToMm={worldToMm}
      />

      {/* Section / clipping plane. */}
      <ClippingPlane enabled={tool === "clip"} axis={clipAxis} carLength={carLength} />

      <CameraRig preset={preset} template={template} />

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1.5}
        maxDistance={20}
        target={[0, 0.6, 0]}
      />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewcube
          color="#1f2937"
          opacity={1}
          strokeColor="#fb923c"
          textColor="#fb923c"
          hoverColor="#fb923c"
        />
      </GizmoHelper>

      <PostFX
        settings={settings}
        outlineTargets={[
          ...(meshNode && !shellEditMode ? [meshNode] : []),
          ...(shellNode && shellEditMode ? [shellNode] : []),
        ]}
      />
    </Canvas>
  );
}

/**
 * Wraps drei's TransformControls and reliably wires `dragging-changed`
 * (the underlying three.js event) so rotate/scale releases also trigger
 * orbit re-enable + commit. drei's `onMouseUp` only fires for translate.
 */
function PartTransformGizmo({
  object,
  mode,
  size = 0.7,
  space = "local",
  translateSnapM = 0,
  rotateSnapDeg = 0,
  orbitRef,
  interactionRef,
  onRelease,
}: {
  object: THREE.Object3D;
  mode: TransformMode;
  size?: number;
  space?: "local" | "world";
  translateSnapM?: number;
  rotateSnapDeg?: number;
  orbitRef: React.MutableRefObject<any>;
  interactionRef: React.MutableRefObject<boolean>;
  onRelease: () => void;
}) {
  const { camera, gl, scene, invalidate } = useThree();
  const controlsRef = useRef<TransformControlsImpl | null>(null);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;

  useEffect(() => {
    const controls = new TransformControlsImpl(camera, gl.domElement);
    controlsRef.current = controls;
    controls.setMode(mode);
    controls.setSize(size);
    controls.setSpace(space);
    controls.setTranslationSnap(translateSnapM > 0 ? translateSnapM : null);
    controls.setRotationSnap(rotateSnapDeg > 0 ? (rotateSnapDeg * Math.PI) / 180 : null);
    controls.attach(object);

    const handleDragging = (e: { value: boolean }) => {
      interactionRef.current = e.value;
      if (orbitRef.current) orbitRef.current.enabled = !e.value;
      if (!e.value) {
        releaseRef.current();
        window.setTimeout(() => {
          interactionRef.current = false;
        }, 0);
      }
      invalidate();
    };
    const handleChange = () => invalidate();

    controls.addEventListener("dragging-changed", handleDragging as any);
    controls.addEventListener("change", handleChange);
    const handlePointerDownCapture = (event: PointerEvent) => {
      const c = controls as any;
      c.pointerHover?.(c.getPointer?.(event));
      if (c.axis) interactionRef.current = true;
    };
    gl.domElement.addEventListener("pointerdown", handlePointerDownCapture, true);
    scene.add(controls);

    return () => {
      controls.removeEventListener("dragging-changed", handleDragging as any);
      controls.removeEventListener("change", handleChange);
      gl.domElement.removeEventListener("pointerdown", handlePointerDownCapture, true);
      controls.detach();
      scene.remove(controls);
      controls.dispose();
      interactionRef.current = false;
      controlsRef.current = null;
    };
  }, [camera, gl, scene, object, orbitRef, interactionRef, invalidate]);

  useEffect(() => {
    controlsRef.current?.setMode(mode);
    invalidate();
  }, [mode, invalidate]);

  useEffect(() => {
    controlsRef.current?.setSpace(space);
    controlsRef.current?.setTranslationSnap(translateSnapM > 0 ? translateSnapM : null);
    controlsRef.current?.setRotationSnap(rotateSnapDeg > 0 ? (rotateSnapDeg * Math.PI) / 180 : null);
    invalidate();
  }, [space, translateSnapM, rotateSnapDeg, invalidate]);

  useEffect(() => {
    controlsRef.current?.setSize(size);
    invalidate();
  }, [size, invalidate]);

  return null;
}

/** Renders all placed parts and reports the selected mesh node up. */
function SceneParts({
  parts,
  libraryItemsById,
  selectedId,
  showLabels,
  onSelect,
  onMeshFound,
  onFrame,
}: {
  parts: PlacedPart[];
  libraryItemsById: Map<string, LibraryItem>;
  selectedId: string | null;
  showLabels: boolean;
  onSelect: (id: string | null) => void;
  onMeshFound: (node: THREE.Object3D | null) => void;
  onFrame: (object: THREE.Object3D) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!selectedId || !groupRef.current) {
      onMeshFound(null);
      return;
    }
    const node = groupRef.current.getObjectByName(`placed-${selectedId}`);
    onMeshFound(node ?? null);
  }, [selectedId, parts, onMeshFound]);

  return (
    <group ref={groupRef}>
      {parts.map((p) => (
        <PlacedPartGroup
          key={p.id}
          part={p}
          libraryItem={p.library_item_id ? libraryItemsById.get(p.library_item_id) ?? null : null}
          selected={p.id === selectedId}
          showLabel={showLabels}
          onSelect={() => onSelect(p.id)}
          onFrame={onFrame}
        />
      ))}
    </group>
  );
}
