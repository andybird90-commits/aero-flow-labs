/**
 * ARRig — wraps the car/parts/shell so they can be anchored to the real-world
 * floor in an AR session.
 *
 * Behaviour:
 *   • While `mode === 'placing'`: runs hit-test against the user's room and
 *     publishes the hit pose to `arStore.reticlePosition`. The first `select`
 *     event commits the anchor and switches to 'anchored'.
 *   • While `mode === 'anchored'`: applies the anchor transform + scale to a
 *     wrapper group. Two-controller (or two-finger) pinch-scales the rig
 *     between 0.05× and 4×. A long-press on the model re-enters 'placing'.
 *   • While `measureMode` is on (and anchored): a single `select` adds a
 *     point. After two points, the next `select` resets and starts over.
 *
 * If we're NOT in an AR session (mode === 'off'), the rig is a transparent
 * group — children render at their natural Showroom transform.
 */
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useHitTest, useXR, useXREvent } from "@react-three/xr";
import * as THREE from "three";
import { arStore, useARAnchor } from "@/lib/showroom/ar-anchor";

interface ARRigProps {
  children: React.ReactNode;
  /** Approx natural length of the car in metres — used as the "1.0 = life-size" baseline. */
  carLengthMeters: number;
}

export function ARRig({ children, carLengthMeters }: ARRigProps) {
  const ar = useARAnchor();
  const { isPresenting, controllers } = useXR();
  const groupRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const lastReticlePose = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion } | null>(null);
  const pinchBaseline = useRef<{ dist: number; scale: number } | null>(null);
  const { camera } = useThree();

  /* ─── XR session start/end ─── */
  useEffect(() => {
    if (isPresenting) {
      arStore.startSession();
    } else {
      arStore.endSession();
    }
  }, [isPresenting]);

  /* ─── Hit-test loop (runs only while in session + placing) ─── */
  const tmpPos = useRef(new THREE.Vector3()).current;
  const tmpQuat = useRef(new THREE.Quaternion()).current;
  const tmpScale = useRef(new THREE.Vector3()).current;

  useHitTest((hitMatrix) => {
    if (ar.mode !== "placing") return;
    hitMatrix.decompose(tmpPos, tmpQuat, tmpScale);
    lastReticlePose.current = {
      pos: tmpPos.clone(),
      quat: tmpQuat.clone(),
    };
    // Throttle store updates to once per frame (this callback already is).
    arStore.set({
      reticlePosition: [tmpPos.x, tmpPos.y, tmpPos.z],
      reticleQuat: [tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w],
    });
  });

  /* ─── select / squeeze events from XR controllers (and tap on phones) ─── */
  useXREvent("select", (e) => {
    const current = arStore.get();
    if (current.mode === "placing") {
      arStore.anchorHere();
      return;
    }
    if (current.mode === "anchored" && current.measureMode) {
      // Place a measurement point at the current reticle position (or, if no
      // hit-test, at a point in front of the user).
      let p: [number, number, number];
      if (current.reticlePosition) {
        p = current.reticlePosition;
      } else {
        const ctrl = e.target;
        const v = new THREE.Vector3(0, 0, -0.5).applyQuaternion(ctrl.quaternion).add(ctrl.position);
        p = [v.x, v.y, v.z];
      }
      arStore.addMeasurePoint(p);
    }
  });

  // Long-squeeze to reposition.
  const squeezeStart = useRef<number | null>(null);
  useXREvent("squeezestart", () => {
    squeezeStart.current = performance.now();
  });
  useXREvent("squeezeend", () => {
    const t = squeezeStart.current ?? 0;
    squeezeStart.current = null;
    if (performance.now() - t > 600 && arStore.get().mode === "anchored") {
      arStore.reposition();
    }
  });

  /* ─── Two-controller pinch-scale (VR / dual controllers) ─── */
  useFrame(() => {
    const cur = arStore.get();
    if (cur.mode !== "anchored") return;
    if (!controllers || controllers.length < 2) {
      if (pinchBaseline.current) pinchBaseline.current = null;
      return;
    }
    const a = controllers[0].controller.position;
    const b = controllers[1].controller.position;
    const dist = a.distanceTo(b);

    if (!pinchBaseline.current) {
      pinchBaseline.current = { dist, scale: cur.scale };
      return;
    }
    if (dist <= 0) return;
    const ratio = dist / pinchBaseline.current.dist;
    const newScale = pinchBaseline.current.scale * ratio;
    if (Math.abs(newScale - cur.scale) > 0.01) {
      arStore.setScale(newScale);
    }
  });

  /* ─── Two-finger touch pinch (AR phone fallback) ─── */
  useEffect(() => {
    if (!isPresenting) return;
    const gl = (camera as any).gl as HTMLCanvasElement | undefined;
    const canvas: HTMLCanvasElement | null =
      (typeof document !== "undefined" && document.querySelector("canvas")) || null;
    if (!canvas) return;

    let baseline: { dist: number; scale: number } | null = null;
    const dist = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      return Math.hypot(dx, dy);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && arStore.get().mode === "anchored") {
        baseline = { dist: dist(e), scale: arStore.get().scale };
        arStore.set({ scaling: true });
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && baseline) {
        const d = dist(e);
        if (d > 0) arStore.setScale(baseline.scale * (d / baseline.dist));
      }
    };
    const onEnd = () => {
      baseline = null;
      arStore.set({ scaling: false });
    };
    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchmove", onMove, { passive: true });
    canvas.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onEnd);
    };
  }, [isPresenting, camera]);

  /* ─── Apply anchor transform every frame ─── */
  useFrame(() => {
    const g = groupRef.current;
    const inner = innerRef.current;
    if (!g || !inner) return;

    if (!isPresenting) {
      // Non-AR: identity transform, render children where they naturally sit.
      g.position.set(0, 0, 0);
      g.quaternion.identity();
      inner.scale.setScalar(1);
      return;
    }

    if (ar.mode === "anchored" && ar.anchorPosition && ar.anchorQuat) {
      g.position.set(...ar.anchorPosition);
      g.quaternion.set(...ar.anchorQuat);
      // The car's natural size in scene units is `carLengthMeters`. To make
      // 1.0 mean "life-size" in AR, we multiply by user scale only.
      inner.scale.setScalar(ar.scale);
    } else {
      // Hide while placing — only reticle is visible.
      inner.scale.setScalar(0.0001);
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={innerRef}>{children}</group>
    </group>
  );
}
