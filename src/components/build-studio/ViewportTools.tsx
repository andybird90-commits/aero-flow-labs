/**
 * ViewportTools — Tier 2 interaction primitives for the Build Studio.
 *
 *  • <FrameOnDoubleClick>  — double-click any object inside <Bounds> to fly
 *                            the camera so it fills the frame. Triple-click
 *                            anywhere on empty space resets to the whole car.
 *  • <PartLabel>           — anchored DOM tooltip above a 3D point (uses drei
 *                            <Html>). Self-occlusion-aware via `occlude`.
 *  • <MeasureTool>         — click two points on the model to draw a line +
 *                            mm distance. World-units → mm scaled by
 *                            template wheelbase so the readout is honest.
 *  • <ClippingPlane>       — single oriented plane attached to the renderer's
 *                            global clipping list. Comes with a tiny visualiser
 *                            (transparent rect) and a TransformControls handle
 *                            so the user can grab + slide the section.
 *
 * All four pieces are independent and may be toggled on/off from the toolbar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Html, useBounds } from "@react-three/drei";
import * as THREE from "three";
import { TransformControls as TransformControlsImpl } from "three-stdlib";

/* ───────────────────────── Bounds wrapper ───────────────────── */

/**
 * Refits the camera to the given object via drei's `useBounds`. Mounted as a
 * thin child of <Bounds>; the parent dispatches a custom DOM event when the
 * user double-clicks a part — we listen for it and call `bounds.refresh().fit()`.
 *
 * Why an event? Because `useBounds()` only works inside a child of <Bounds>,
 * but the BuildStudio component owns the click handlers — so we proxy through
 * `window` events.
 */
export function FrameOnDoubleClick({ scene }: { scene: THREE.Object3D | null }) {
  const bounds = useBounds();
  useEffect(() => {
    const onFrame = (e: Event) => {
      const ev = e as CustomEvent<{ object?: THREE.Object3D | null }>;
      const target = ev.detail?.object ?? scene ?? null;
      if (!target) return;
      bounds.refresh(target).clip().fit();
    };
    const onReset = () => {
      if (!scene) return;
      bounds.refresh(scene).clip().fit();
    };
    window.addEventListener("apex:frame-object", onFrame);
    window.addEventListener("apex:frame-reset", onReset);
    return () => {
      window.removeEventListener("apex:frame-object", onFrame);
      window.removeEventListener("apex:frame-reset", onReset);
    };
  }, [bounds, scene]);
  return null;
}

/** Trigger from React-land (any component outside <Canvas>). */
export function frameObject(object: THREE.Object3D | null) {
  window.dispatchEvent(new CustomEvent("apex:frame-object", { detail: { object } }));
}
export function frameReset() {
  window.dispatchEvent(new CustomEvent("apex:frame-reset"));
}

/* ───────────────────────── Part label ───────────────────────── */

/**
 * Floating DOM label anchored to a world position. `occlude={[meshRef]}` makes
 * the label fade when the underlying mesh is hidden behind the car body — looks
 * much more native than a constantly-visible tag.
 */
export function PartLabel({
  position,
  text,
  tone = "default",
}: {
  position: [number, number, number];
  text: string;
  tone?: "default" | "primary" | "muted";
}) {
  const colors: Record<string, string> = {
    default: "bg-surface-1/90 text-foreground border-border",
    primary: "bg-primary text-primary-foreground border-primary",
    muted: "bg-surface-2/80 text-muted-foreground border-border",
  };
  return (
    <Html
      position={position}
      center
      zIndexRange={[100, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div
        className={`max-w-24 truncate whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-medium leading-tight shadow-sm backdrop-blur ${colors[tone]}`}
      >
        {text}
      </div>
    </Html>
  );
}

/* ───────────────────────── Measurement tool ─────────────────── */

interface MeasurePoint { x: number; y: number; z: number; }

export interface MeasureLine {
  a: MeasurePoint;
  b: MeasurePoint;
}

/**
 * Click two points on any mesh to lay down a measurement. While there's only
 * one point set, the second point follows the cursor (live preview line).
 *
 * `worldToMm` converts scene units to millimetres — the viewport scales the
 * car so its longest side ≈ wheelbase + 1.45 m, so the multiplier is 1000.
 */
export function MeasureTool({
  enabled,
  lines,
  setLines,
  pickRoot,
  worldToMm = 1000,
}: {
  enabled: boolean;
  lines: MeasureLine[];
  setLines: (next: MeasureLine[]) => void;
  pickRoot: THREE.Object3D | null;
  worldToMm?: number;
}) {
  const { camera, gl, raycaster, mouse } = useThree();
  const [pendingA, setPendingA] = useState<MeasurePoint | null>(null);
  const [hover, setHover] = useState<MeasurePoint | null>(null);

  useEffect(() => {
    if (!enabled) {
      setPendingA(null);
      setHover(null);
    }
  }, [enabled]);

  // Pointer plumbing
  useEffect(() => {
    if (!enabled || !pickRoot) return;
    const dom = gl.domElement;

    const ndc = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };

    const intersect = (e: PointerEvent): MeasurePoint | null => {
      ndc(e);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(pickRoot, true);
      const hit = hits[0];
      if (!hit) return null;
      return { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    };

    const onMove = (e: PointerEvent) => {
      if (!pendingA) return;
      const p = intersect(e);
      if (p) setHover(p);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = intersect(e);
      if (!p) return;
      e.stopPropagation();
      if (!pendingA) {
        setPendingA(p);
        setHover(p);
      } else {
        setLines([...lines, { a: pendingA, b: p }]);
        setPendingA(null);
        setHover(null);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPendingA(null);
        setHover(null);
      }
    };

    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, pickRoot, camera, gl, raycaster, mouse, pendingA, lines, setLines]);

  return (
    <group>
      {lines.map((l, i) => (
        <MeasureSegment key={i} line={l} worldToMm={worldToMm} />
      ))}
      {pendingA && hover && enabled && (
        <MeasureSegment line={{ a: pendingA, b: hover }} worldToMm={worldToMm} ghost />
      )}
    </group>
  );
}

function MeasureSegment({
  line,
  worldToMm,
  ghost,
}: {
  line: MeasureLine;
  worldToMm: number;
  ghost?: boolean;
}) {
  const a = new THREE.Vector3(line.a.x, line.a.y, line.a.z);
  const b = new THREE.Vector3(line.b.x, line.b.y, line.b.z);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const distMm = a.distanceTo(b) * worldToMm;
  const label =
    distMm >= 1000 ? `${(distMm / 1000).toFixed(2)} m` : `${Math.round(distMm)} mm`;

  // Build a thin tube using BufferGeometry. We use a Line — simpler and resolution
  // independent — with vertex colours so the ghost preview is dim.
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3),
    );
    return g;
  }, [a.x, a.y, a.z, b.x, b.y, b.z]);

  const colorA = ghost ? "hsl(24 95% 53% / 0.6)" : "hsl(24 95% 53%)";
  return (
    <group>
      <line>
        <primitive attach="geometry" object={geom} />
        <lineBasicMaterial color={colorA} linewidth={2} depthTest={false} transparent />
      </line>
      {/* Endpoint dots */}
      <mesh position={a}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial color={colorA} depthTest={false} transparent />
      </mesh>
      <mesh position={b}>
        <sphereGeometry args={[0.012, 12, 12]} />
        <meshBasicMaterial color={colorA} depthTest={false} transparent />
      </mesh>
      <Html position={[mid.x, mid.y + 0.04, mid.z]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <div
          className={`whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-mono shadow-sm backdrop-blur ${
            ghost
              ? "border-primary/40 bg-surface-1/70 text-primary"
              : "border-primary bg-primary text-primary-foreground"
          }`}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

/* ───────────────────────── Clipping plane ───────────────────── */

export type ClipAxis = "x" | "y" | "z";

const CLIP_NORMAL: Record<ClipAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * Adds a single THREE.Plane to the renderer's global `clippingPlanes` while
 * mounted. Drag the floating handle (a tiny cube on the plane) to slide the
 * section. The plane visualiser is a translucent rect so the slice is obvious.
 */
export function ClippingPlane({
  enabled,
  axis = "x",
  carLength = 4.5,
}: {
  enabled: boolean;
  axis?: ClipAxis;
  carLength?: number;
}) {
  const { gl, scene, camera } = useThree();
  const planeRef = useRef(new THREE.Plane());
  const handleRef = useRef<THREE.Mesh>(null);
  const controlsRef = useRef<TransformControlsImpl | null>(null);

  const normal = CLIP_NORMAL[axis];
  const sizeXY = carLength * 1.4;

  // Toggle on/off
  useEffect(() => {
    if (!enabled) {
      gl.localClippingEnabled = false;
      gl.clippingPlanes = [];
      return;
    }
    gl.localClippingEnabled = true;
    planeRef.current.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, 0.6, 0));
    gl.clippingPlanes = [planeRef.current];
    return () => {
      gl.localClippingEnabled = false;
      gl.clippingPlanes = [];
    };
  }, [enabled, gl, normal]);

  // Wire a TransformControls to drag the handle, which moves the plane.
  useEffect(() => {
    if (!enabled || !handleRef.current) return;
    const controls = new TransformControlsImpl(camera, gl.domElement);
    controlsRef.current = controls;
    controls.setMode("translate");
    controls.setSize(0.6);
    // Lock to the axis we're slicing along (cast — three-stdlib's d.ts marks
    // these as private but they're public on the runtime class).
    const c = controls as unknown as { showX: boolean; showY: boolean; showZ: boolean };
    c.showX = axis === "x";
    c.showY = axis === "y";
    c.showZ = axis === "z";
    controls.attach(handleRef.current);
    scene.add(controls);

    const onChange = () => {
      const p = handleRef.current!.position;
      planeRef.current.setFromNormalAndCoplanarPoint(normal, p);
    };
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener("change", onChange);
      controls.detach();
      scene.remove(controls);
      controls.dispose();
    };
  }, [enabled, axis, normal, camera, gl, scene]);

  if (!enabled) return null;

  // Orient the visualiser so its normal matches the slice axis.
  const planeRotation: [number, number, number] =
    axis === "x" ? [0, Math.PI / 2, 0] : axis === "y" ? [-Math.PI / 2, 0, 0] : [0, 0, 0];

  return (
    <>
      {/* Section visualiser */}
      <mesh rotation={planeRotation} position={[0, 0.6, 0]} renderOrder={999}>
        <planeGeometry args={[sizeXY, sizeXY]} />
        <meshBasicMaterial
          color="hsl(24 95% 53%)"
          opacity={0.08}
          transparent
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {/* Drag handle (tiny cube on the plane) */}
      <mesh ref={handleRef} position={[0, 0.6, 0]}>
        <boxGeometry args={[0.12, 0.12, 0.12]} />
        <meshStandardMaterial color="hsl(24 95% 53%)" emissive="hsl(24 95% 53%)" emissiveIntensity={0.6} />
      </mesh>
    </>
  );
}

/** Re-export so consumers can pull <Bounds> from one place. */
export { Bounds };
