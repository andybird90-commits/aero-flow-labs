/**
 * Aero anchor system — gives every aero part a stable attachment point on
 * the car, whether the car is the procedural template body or a user-uploaded
 * mesh. Anchors are computed in **world** units (metres) in the same
 * coordinate frame the viewer uses (Y-up, +X = front, +Z = right).
 *
 * When a custom mesh is loaded, anchors are derived from its world bounding
 * box (front, rear, roof, sides, ground). When no mesh is loaded, we fall
 * back to dimensions inferred from the car_template (wheelbase, track,
 * frontal area).
 *
 * Each component can store a manual nudge in its `params` (`nudge_x`,
 * `nudge_y`, `nudge_z`, in metres) — applied on top of the anchor.
 */
import * as THREE from "three";
import type { CarTemplate } from "@/lib/repo";

export interface MeshBounds {
  /** World bounding box of the visible car (after fit/rotation/recentre). */
  box: THREE.Box3;
}

export interface AeroAnchors {
  /** Length along X (front − rear). */
  length: number;
  /** Width along Z. */
  width: number;
  /** Height along Y (top − ground). */
  height: number;
  /** Approx ground clearance (lowest point of body, m). */
  ride: number;
  /** Where each part attaches by default. World metres. */
  anchors: {
    splitter: THREE.Vector3;
    wing: THREE.Vector3;
    diffuser: THREE.Vector3;
    skirtsLeft: THREE.Vector3;
    skirtsRight: THREE.Vector3;
    canardsLeft: THREE.Vector3;
    canardsRight: THREE.Vector3;
    ducktail: THREE.Vector3;
  };
  /** True if anchors come from an uploaded mesh's bounds. */
  fromMesh: boolean;
}

/**
 * Compute anchors. Pass `meshBounds` when a custom mesh is loaded.
 * Otherwise template dims are used (matches procedural CarBody).
 */
export function computeAnchors(
  template?: CarTemplate | null,
  meshBounds?: MeshBounds | null,
  geometryRide?: { front_mm?: number | null; rear_mm?: number | null },
): AeroAnchors {
  let xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number;
  let fromMesh = false;

  if (meshBounds) {
    const b = meshBounds.box;
    if (isFinite(b.min.x) && isFinite(b.max.x)) {
      xMin = b.min.x; xMax = b.max.x;
      yMin = b.min.y; yMax = b.max.y;
      zMin = b.min.z; zMax = b.max.z;
      fromMesh = true;
    } else {
      ({ xMin, xMax, yMin, yMax, zMin, zMax } = templateBounds(template, geometryRide));
    }
  } else {
    ({ xMin, xMax, yMin, yMax, zMin, zMax } = templateBounds(template, geometryRide));
  }

  const length = xMax - xMin;
  const width = zMax - zMin;
  const height = yMax - yMin;
  const ride = yMin;

  // Default anchor positions — small inset margins so parts hug the body.
  const front = xMax;
  const rear = xMin;
  const left = zMin;
  const right = zMax;
  const roof = yMax;

  const anchors = {
    // Splitter sits at the very front, just above the ground.
    splitter: new THREE.Vector3(front - 0.02, ride + 0.04, 0),
    // Wing sits behind the rear, above roof line.
    wing: new THREE.Vector3(rear + 0.18, roof + 0.05, 0),
    // Diffuser tucks under the rear.
    diffuser: new THREE.Vector3(rear + 0.18, ride + 0.04, 0),
    // Side skirts run along the lower flanks.
    skirtsLeft: new THREE.Vector3(0, ride + 0.06, left + 0.005),
    skirtsRight: new THREE.Vector3(0, ride + 0.06, right - 0.005),
    // Canards on the front fenders, mid-height.
    canardsLeft: new THREE.Vector3(front - 0.35, ride + height * 0.45, left + 0.04),
    canardsRight: new THREE.Vector3(front - 0.35, ride + height * 0.45, right - 0.04),
    // Ducktail sits on the rear deck.
    ducktail: new THREE.Vector3(rear + 0.25, roof - 0.02, 0),
  };

  return { length, width, height, ride, anchors, fromMesh };
}

function templateBounds(
  template?: CarTemplate | null,
  geometryRide?: { front_mm?: number | null; rear_mm?: number | null },
) {
  const wheelbase = (template?.wheelbase_mm ?? 2575) / 1000;
  const track = (template?.track_front_mm ?? 1520) / 1000;
  const fa = template?.frontal_area_m2 ?? 2.04;
  const width = Math.max(track + 0.05, 1.7);
  const height = Math.max(0.45, (fa / Math.max(width, 1.4)) * 0.85);
  const length = wheelbase + 1.45;
  const ride =
    ((geometryRide?.front_mm ?? 130) + (geometryRide?.rear_mm ?? 135)) / 2 / 1000;
  const baseY = ride + 0.15;
  // Match CarBody: body box centred at baseY, wheels at ride+0.05
  return {
    xMin: -length / 2,
    xMax: length / 2,
    yMin: ride,
    yMax: baseY + height + height * 0.55, // approx top of greenhouse + roof slope
    zMin: -width / 2,
    zMax: width / 2,
  };
}

/** Read a component's manual nudge (metres) from its params. */
export function readNudge(params: any): { x: number; y: number; z: number } {
  return {
    x: typeof params?.nudge_x === "number" ? params.nudge_x : 0,
    y: typeof params?.nudge_y === "number" ? params.nudge_y : 0,
    z: typeof params?.nudge_z === "number" ? params.nudge_z : 0,
  };
}

/** Apply nudge to an anchor and return a new Vector3. */
export function nudged(
  anchor: THREE.Vector3,
  nudge: { x: number; y: number; z: number },
): THREE.Vector3 {
  return new THREE.Vector3(anchor.x + nudge.x, anchor.y + nudge.y, anchor.z + nudge.z);
}
