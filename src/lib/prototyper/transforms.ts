/**
 * Pure client-side transform helpers for Place mode.
 * No AI, no network — just maths on a placement instance.
 */

import { defaultCentre, flipSide, type MountZone, type PartSide, type ViewAngle } from "./mount-zones";

export interface PlacementTransform {
  x: number;          // normalized centre 0..1
  y: number;          // normalized centre 0..1
  scale: number;      // multiplier on saved silhouette
  rotation: number;   // radians
  mirror: boolean;
  perspective?: {
    tl: { x: number; y: number };
    tr: { x: number; y: number };
    br: { x: number; y: number };
    bl: { x: number; y: number };
  } | null;
}

export interface PlacementInstance {
  instance_id: string;        // local uuid
  frozen_part_id: string;
  side: PartSide;
  zone: MountZone;
  transform: PlacementTransform;
  locked: boolean;
}

export function makeInstance(
  frozenPartId: string,
  zone: MountZone,
  side: PartSide,
  view: ViewAngle,
  baseScale = 1,
): PlacementInstance {
  const c = defaultCentre(zone, side, view);
  return {
    instance_id: crypto.randomUUID(),
    frozen_part_id: frozenPartId,
    zone,
    side,
    transform: {
      x: c.x,
      y: c.y,
      scale: baseScale,
      rotation: 0,
      mirror: false,
      perspective: null,
    },
    locked: false,
  };
}

export function cloneInstance(src: PlacementInstance): PlacementInstance {
  return {
    ...src,
    instance_id: crypto.randomUUID(),
    locked: false,
    transform: {
      ...src.transform,
      x: Math.min(0.95, src.transform.x + 0.06),
      y: Math.min(0.95, src.transform.y + 0.04),
    },
  };
}

export function mirrorInstance(src: PlacementInstance): PlacementInstance {
  return {
    ...src,
    transform: { ...src.transform, mirror: !src.transform.mirror },
  };
}

/**
 * Snap to opposite side: flip mirror, jump x to (1 - x), flip side,
 * and on 3/4 views apply a small perspective skew that mirrors the
 * vanishing direction so the part still reads correctly.
 */
export function snapOpposite(
  src: PlacementInstance,
  view: ViewAngle,
): PlacementInstance {
  const newSide = flipSide(src.side);
  const newX = 1 - src.transform.x;

  let perspective: PlacementTransform["perspective"] = null;
  if (view === "front34") {
    // On front 3/4 the far side reads narrower at top → squeeze top corners.
    perspective = {
      tl: { x: 0.06, y: 0.04 },
      tr: { x: 0.94, y: 0.0 },
      br: { x: 1.0,  y: 1.0 },
      bl: { x: 0.0,  y: 0.96 },
    };
  } else if (view === "rear34") {
    perspective = {
      tl: { x: 0.0,  y: 0.0 },
      tr: { x: 0.94, y: 0.04 },
      br: { x: 1.0,  y: 0.96 },
      bl: { x: 0.06, y: 1.0 },
    };
  }

  return {
    ...src,
    side: newSide,
    instance_id: crypto.randomUUID(),
    transform: {
      ...src.transform,
      x: newX,
      mirror: !src.transform.mirror,
      perspective,
    },
  };
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
