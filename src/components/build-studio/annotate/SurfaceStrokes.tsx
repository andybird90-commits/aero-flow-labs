/**
 * R3F-side annotation pieces:
 *  - <CameraPoseProbe> publishes the current camera position/target/fov
 *    each frame into a parent-owned ref. Used by the screen overlay to
 *    pin / fade screen-space markup.
 *  - <SurfaceStrokeRecorder> raycasts pointer moves against the scene
 *    root and grows a polyline that hugs the surface.
 *  - <SurfaceStrokesRenderer> draws every persisted surface stroke as a
 *    soft tube offset along its average normal, so it sits *on* the body
 *    instead of fighting it.
 */
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  useAnnotationStore,
  type CameraPose,
  type SurfaceStroke,
  type Vec3,
} from "@/lib/build-studio/annotate/store";

interface PoseProbeProps {
  outRef: React.MutableRefObject<CameraPose | null>;
}

export function CameraPoseProbe({ outRef }: PoseProbeProps) {
  const { camera, size } = useThree();
  const target = useMemo(() => new THREE.Vector3(0, 0.6, 0), []);
  useFrame(() => {
    const aspect = size.width / Math.max(1, size.height);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 38;
    outRef.current = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: target.x, y: target.y, z: target.z },
      fov,
      aspect,
    };
  });
  return null;
}

interface RecorderProps {
  /** Group containing everything that should accept strokes (car + parts). */
  pickRoot: THREE.Object3D | null;
  /** Disable orbit controls while drawing. */
  orbitRef?: React.MutableRefObject<any>;
}

/**
 * Records strokes by raycasting pointer events against the pickRoot.
 * Lives at the scene-root level so events bubble up from real meshes.
 */
export function SurfaceStrokeRecorder({ pickRoot, orbitRef }: RecorderProps) {
  const { gl, camera, raycaster, size } = useThree();
  const drawingRef = useRef(false);
  const currentRef = useRef<SurfaceStroke | null>(null);
  const lastWorld = useRef<THREE.Vector3 | null>(null);

  const mode = useAnnotationStore((s) => s.mode);
  const color = useAnnotationStore((s) => s.color);
  const width = useAnnotationStore((s) => s.width);
  const activeLayerId = useAnnotationStore((s) => s.activeLayerId);
  const layers = useAnnotationStore((s) => s.layers);
  const addLayer = useAnnotationStore((s) => s.addLayer);
  const setActiveLayer = useAnnotationStore((s) => s.setActiveLayer);
  const appendStroke = useAnnotationStore((s) => s.appendStroke);

  const enabled = mode === "surface" && !!pickRoot;

  useEffect(() => {
    if (!enabled) return;
    const dom = gl.domElement;
    const ndc = new THREE.Vector2();

    const pick = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = dom.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(pickRoot!, true);
      return hits.length ? hits[0].point.clone() : null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const hit = pick(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      dom.setPointerCapture(e.pointerId);
      if (orbitRef?.current) orbitRef.current.enabled = false;

      // Ensure an active surface layer exists.
      let layerId = activeLayerId;
      const al = layers.find((l) => l.id === layerId);
      if (!al || al.kind !== "surface") {
        layerId = addLayer("surface");
      }
      setActiveLayer(layerId);

      drawingRef.current = true;
      currentRef.current = {
        id: `surf-${Date.now()}`,
        kind: "surface",
        color,
        width: Math.max(0.005, width * 0.003), // px → metres heuristic
        points: [{ x: hit.x, y: hit.y, z: hit.z }],
      };
      lastWorld.current = hit;
    };

    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current || !currentRef.current) return;
      const hit = pick(e.clientX, e.clientY);
      if (!hit) return;
      const last = lastWorld.current;
      if (last && hit.distanceTo(last) < 0.01) return;     // 1 cm
      currentRef.current.points.push({ x: hit.x, y: hit.y, z: hit.z });
      lastWorld.current = hit;
    };

    const finish = (e?: PointerEvent) => {
      if (e) {
        try {
          dom.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (orbitRef?.current) orbitRef.current.enabled = true;
      const stroke = currentRef.current;
      drawingRef.current = false;
      currentRef.current = null;
      lastWorld.current = null;
      if (!stroke || stroke.points.length < 2) return;
      const layerId =
        useAnnotationStore.getState().activeLayerId ??
        useAnnotationStore.getState().layers.find((l) => l.kind === "surface")?.id ??
        null;
      if (!layerId) return;
      appendStroke(layerId, stroke);
    };

    dom.addEventListener("pointerdown", onDown, true);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerup", finish);
    dom.addEventListener("pointerleave", finish);
    return () => {
      dom.removeEventListener("pointerdown", onDown, true);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerup", finish);
      dom.removeEventListener("pointerleave", finish);
      if (orbitRef?.current) orbitRef.current.enabled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pickRoot, color, width, activeLayerId, layers]);

  return null;
}

/* ─── Renderer ──────────────────────────────────────────────────────────── */

function strokeToTube(stroke: SurfaceStroke) {
  if (stroke.points.length < 2) return null;
  const pts = stroke.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.2);
  const segments = Math.max(8, Math.min(256, pts.length * 4));
  return new THREE.TubeGeometry(curve, segments, stroke.width / 2, 8, false);
}

export function SurfaceStrokesRenderer() {
  const layers = useAnnotationStore((s) => s.layers);

  const renderables = useMemo(() => {
    const out: Array<{ id: string; geom: THREE.BufferGeometry; color: string }> = [];
    for (const layer of layers) {
      if (!layer.visible || layer.kind !== "surface") continue;
      for (const s of layer.strokes) {
        if (s.kind !== "surface") continue;
        const geom = strokeToTube(s);
        if (geom) out.push({ id: s.id, geom, color: s.color });
      }
    }
    return out;
  }, [layers]);

  // Dispose old geometries when the renderable list changes.
  useEffect(() => {
    return () => renderables.forEach((r) => r.geom.dispose());
  }, [renderables]);

  return (
    <group>
      {renderables.map((r) => (
        <mesh key={r.id} geometry={r.geom} renderOrder={5} castShadow={false}>
          <meshStandardMaterial
            color={r.color}
            emissive={r.color}
            emissiveIntensity={1.8}
            metalness={0}
            roughness={0.35}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthTest
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      ))}
    </group>
  );
}
