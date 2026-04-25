/**
 * AR anchor store — shared state for the AR-placement experience.
 *
 * Lives outside React-Three-Fiber so the DOM HUD (outside <Canvas>) and the
 * in-scene `<ARRig>` can both read/write it without prop-drilling.
 *
 * Why a tiny custom store and not Zustand? r3f already pulls in Zustand, but
 * we don't want to depend on a specific export here. A 30-line subscribable
 * store is enough and keeps the surface area trivial to test.
 */
import { useEffect, useState } from "react";

export type ARMode = "off" | "placing" | "anchored";

export interface ARAnchorState {
  /** Where we are in the AR flow. */
  mode: ARMode;
  /** Anchor position in AR world space (metres). */
  anchorPosition: [number, number, number] | null;
  /** Quaternion (xyzw) — derived from hit-test floor normal. */
  anchorQuat: [number, number, number, number] | null;
  /** Multiplier applied on top of the scene's natural size. 1 = life-size. */
  scale: number;
  /** Live hit-test reticle pose (pre-anchor) so we can show a ring. */
  reticlePosition: [number, number, number] | null;
  reticleQuat: [number, number, number, number] | null;
  /** True while the user has pinch / two-controller scaling underway. */
  scaling: boolean;
  /** Two-tap measurement points (world-space metres). */
  measurePoints: Array<[number, number, number]>;
  /** Whether measurement tool is the active interaction. */
  measureMode: boolean;
}

const initial: ARAnchorState = {
  mode: "off",
  anchorPosition: null,
  anchorQuat: null,
  scale: 1,
  reticlePosition: null,
  reticleQuat: null,
  scaling: false,
  measurePoints: [],
  measureMode: false,
};

let state: ARAnchorState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const arStore = {
  get(): ARAnchorState {
    return state;
  },
  set(patch: Partial<ARAnchorState>) {
    state = { ...state, ...patch };
    emit();
  },
  reset() {
    state = { ...initial };
    emit();
  },
  startSession() {
    state = { ...initial, mode: "placing" };
    emit();
  },
  endSession() {
    state = { ...initial, mode: "off" };
    emit();
  },
  anchorHere() {
    if (!state.reticlePosition) return false;
    state = {
      ...state,
      mode: "anchored",
      anchorPosition: state.reticlePosition,
      anchorQuat: state.reticleQuat,
    };
    emit();
    return true;
  },
  reposition() {
    state = {
      ...state,
      mode: "placing",
      anchorPosition: null,
      anchorQuat: null,
      measurePoints: [],
    };
    emit();
  },
  setScale(s: number) {
    const clamped = Math.max(0.05, Math.min(4, s));
    if (clamped === state.scale) return;
    state = { ...state, scale: clamped };
    emit();
  },
  toggleMeasure() {
    state = { ...state, measureMode: !state.measureMode, measurePoints: [] };
    emit();
  },
  addMeasurePoint(p: [number, number, number]) {
    const next = [...state.measurePoints, p];
    if (next.length > 2) next.shift();
    state = { ...state, measurePoints: next };
    emit();
  },
  clearMeasure() {
    state = { ...state, measurePoints: [] };
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** React hook — returns the full state and re-renders on change. */
export function useARAnchor(): ARAnchorState {
  const [snapshot, setSnapshot] = useState(arStore.get());
  useEffect(() => arStore.subscribe(() => setSnapshot(arStore.get())), []);
  return snapshot;
}

/** Distance between two 3-vectors (metres). */
export function distance(a: [number, number, number], b: [number, number, number]) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
