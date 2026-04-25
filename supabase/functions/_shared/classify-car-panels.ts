/**
 * Classify split car-mesh components into known body-panel slots.
 *
 * Inputs are in canonical car frame: car points along the forward axis after
 * any axis remap has been applied upstream. We work in normalised bbox
 * coordinates so the heuristics are car-size-independent.
 *
 * Frame assumed at this point:
 *   +X = right, -X = left
 *   +Y = up
 *   forward depends on `forward_axis`; we re-orient externally so this
 *   classifier always sees -Z forward / +Z rear.
 *
 * Returns one assignment per component, with a confidence in [0,1] and a
 * `slot` from a closed vocabulary. Anything below `MIN_CONFIDENCE` falls
 * back to "unknown_<n>" so the admin can re-tag it manually.
 */
import type { SplitComponent } from "./stl-split-by-creases.ts";

export type PanelSlot =
  | "hood"
  | "roof"
  | "front_bumper"
  | "rear_bumper"
  | "door_l"
  | "door_r"
  | "fender_l"
  | "fender_r"
  | "mirror_l"
  | "mirror_r"
  | "wheel_l_f"
  | "wheel_l_r"
  | "wheel_r_f"
  | "wheel_r_r"
  | "trunk_lid"
  | "windshield"
  | "rear_window"
  | "side_window_l"
  | "side_window_r"
  | "unknown";

export interface PanelAssignment {
  componentIndex: number;
  slot: PanelSlot;
  /** When `unknown`, a 1-based ordinal so admins can disambiguate in the UI. */
  unknownIndex?: number;
  confidence: number;
  /** Human-readable reasoning for transparency in the admin UI. */
  reason: string;
}

export interface ClassifyResult {
  assignments: PanelAssignment[];
  /** Bbox of the entire car (union of all components). */
  carBbox: { min: [number, number, number]; max: [number, number, number] };
}

const MIN_CONFIDENCE = 0.6;

/**
 * Classify components. Components must already be in -Z forward / +Y up frame.
 */
export function classifyPanels(components: SplitComponent[]): ClassifyResult {
  if (components.length === 0) {
    return {
      assignments: [],
      carBbox: { min: [0, 0, 0], max: [0, 0, 0] },
    };
  }

  // Union bbox.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of components) {
    if (c.bbox.min[0] < minX) minX = c.bbox.min[0];
    if (c.bbox.min[1] < minY) minY = c.bbox.min[1];
    if (c.bbox.min[2] < minZ) minZ = c.bbox.min[2];
    if (c.bbox.max[0] > maxX) maxX = c.bbox.max[0];
    if (c.bbox.max[1] > maxY) maxY = c.bbox.max[1];
    if (c.bbox.max[2] > maxZ) maxZ = c.bbox.max[2];
  }
  const carBbox = {
    min: [minX, minY, minZ] as [number, number, number],
    max: [maxX, maxY, maxZ] as [number, number, number],
  };
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const sz = maxZ - minZ || 1;
  const totalArea = components.reduce((s, c) => s + c.areaM2, 0) || 1;

  // Score each candidate slot for each component.
  const scoreFor = (c: SplitComponent): { slot: PanelSlot; conf: number; reason: string } => {
    const cx = (c.centroid[0] - minX) / sx; // 0..1 left→right
    const cy = (c.centroid[1] - minY) / sy; // 0..1 bottom→top
    const cz = (c.centroid[2] - minZ) / sz; // 0..1 front→rear (after canonicalisation)
    const widthFrac = (c.bbox.max[0] - c.bbox.min[0]) / sx;
    const lengthFrac = (c.bbox.max[2] - c.bbox.min[2]) / sz;
    const heightFrac = (c.bbox.max[1] - c.bbox.min[1]) / sy;
    const areaFrac = c.areaM2 / totalArea;
    const upness = c.avgNormal[1]; // 1 = facing up, -1 = down
    const sideness = Math.abs(c.avgNormal[0]); // 1 = facing left/right
    const isLeft = c.centroid[0] < (minX + sx * 0.5);

    // Wheels: small, low (cy < 0.35), at corners. Cylindrical → side-facing avg
    // normal is weak (averages to near-zero) but we use position primarily.
    if (cy < 0.35 && areaFrac < 0.06 && widthFrac < 0.25 && lengthFrac < 0.30) {
      const isFront = cz < 0.35;
      const isRear = cz > 0.65;
      if (isFront || isRear) {
        const slot: PanelSlot = isLeft
          ? (isFront ? "wheel_l_f" : "wheel_l_r")
          : (isFront ? "wheel_r_f" : "wheel_r_r");
        return { slot, conf: 0.78, reason: `Small low corner component @ (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)})` };
      }
    }

    // Mirrors: tiny, mid-height, far off centreline.
    if (areaFrac < 0.025 && cy > 0.35 && cy < 0.75 && (cx < 0.18 || cx > 0.82) && cz > 0.20 && cz < 0.55) {
      return {
        slot: isLeft ? "mirror_l" : "mirror_r",
        conf: 0.72,
        reason: `Small high-offset component near A-pillar`,
      };
    }

    // Hood: top-facing, front 1/3, full width.
    if (upness > 0.4 && cy > 0.55 && cz < 0.40 && widthFrac > 0.55) {
      return { slot: "hood", conf: 0.85, reason: `Up-facing flat panel, front 1/3, full width` };
    }

    // Roof: top-facing, middle 1/3, full width.
    if (upness > 0.4 && cy > 0.75 && cz >= 0.30 && cz <= 0.65 && widthFrac > 0.55) {
      return { slot: "roof", conf: 0.82, reason: `Up-facing panel, mid length, top` };
    }

    // Trunk lid: top-facing, rear 1/3, full width.
    if (upness > 0.3 && cy > 0.55 && cz > 0.65 && widthFrac > 0.55 && areaFrac > 0.03) {
      return { slot: "trunk_lid", conf: 0.78, reason: `Up-facing panel, rear 1/3, full width` };
    }

    // Front bumper: front 15%, low-to-mid, full width.
    if (cz < 0.18 && cy < 0.55 && widthFrac > 0.55) {
      return { slot: "front_bumper", conf: 0.80, reason: `Frontmost full-width panel, low-mid` };
    }

    // Rear bumper: rear 15%, low-to-mid, full width.
    if (cz > 0.82 && cy < 0.55 && widthFrac > 0.55) {
      return { slot: "rear_bumper", conf: 0.80, reason: `Rearmost full-width panel, low-mid` };
    }

    // Doors: side-facing, mid length, mid height, one side.
    if (sideness > 0.5 && cz > 0.32 && cz < 0.68 && cy > 0.30 && cy < 0.75 && (cx < 0.30 || cx > 0.70)) {
      return {
        slot: isLeft ? "door_l" : "door_r",
        conf: 0.75,
        reason: `Side-facing panel mid-length on ${isLeft ? "left" : "right"} side`,
      };
    }

    // Fenders: side-facing, front 1/3, mid-low height, one side.
    if (sideness > 0.5 && cz < 0.32 && cy < 0.65 && (cx < 0.25 || cx > 0.75)) {
      return {
        slot: isLeft ? "fender_l" : "fender_r",
        conf: 0.70,
        reason: `Side-facing panel over front wheel arch, ${isLeft ? "left" : "right"}`,
      };
    }

    // Windshield: up-and-back facing (normal between up and forward), full width.
    if (c.avgNormal[1] > 0.3 && c.avgNormal[2] < -0.3 && widthFrac > 0.50 && cz < 0.50 && cy > 0.55) {
      return { slot: "windshield", conf: 0.65, reason: `Up-and-forward panel, top` };
    }

    // Rear window: up-and-forward facing, rear.
    if (c.avgNormal[1] > 0.3 && c.avgNormal[2] > 0.3 && widthFrac > 0.50 && cz > 0.50 && cy > 0.55) {
      return { slot: "rear_window", conf: 0.65, reason: `Up-and-rear panel, top` };
    }

    // Side windows: side-facing, high.
    if (sideness > 0.5 && cy > 0.65 && (cx < 0.25 || cx > 0.75)) {
      return {
        slot: isLeft ? "side_window_l" : "side_window_r",
        conf: 0.60,
        reason: `Side-facing high panel, ${isLeft ? "left" : "right"}`,
      };
    }

    return {
      slot: "unknown",
      conf: 0,
      reason: `No slot matched (centroid ${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}, normal-y ${upness.toFixed(2)}, areaFrac ${areaFrac.toFixed(3)})`,
    };
  };

  // First pass: raw best-slot per component.
  const raw = components.map((c, i) => {
    const r = scoreFor(c);
    return { componentIndex: i, ...r };
  });

  // Second pass: enforce uniqueness for singleton slots (hood, roof, trunk,
  // bumpers, windshield, rear window). Highest confidence wins; losers get
  // demoted to unknown.
  const SINGLETON_SLOTS: PanelSlot[] = [
    "hood", "roof", "trunk_lid", "front_bumper", "rear_bumper",
    "windshield", "rear_window",
  ];
  for (const slot of SINGLETON_SLOTS) {
    const candidates = raw.filter((r) => r.slot === slot);
    if (candidates.length <= 1) continue;
    candidates.sort((a, b) => b.conf - a.conf);
    for (let i = 1; i < candidates.length; i++) {
      candidates[i].slot = "unknown";
      candidates[i].conf = 0;
      candidates[i].reason += " (lost singleton tie-break)";
    }
  }

  // Confidence threshold → unknown bucket with ordinal numbering.
  let unknownCounter = 0;
  const assignments: PanelAssignment[] = raw.map((r) => {
    if (r.slot === "unknown" || r.conf < MIN_CONFIDENCE) {
      unknownCounter++;
      return {
        componentIndex: r.componentIndex,
        slot: "unknown",
        unknownIndex: unknownCounter,
        confidence: r.conf,
        reason: r.reason,
      };
    }
    return {
      componentIndex: r.componentIndex,
      slot: r.slot,
      confidence: r.conf,
      reason: r.reason,
    };
  });

  return { assignments, carBbox };
}

/**
 * Apply the car_stls.forward_axis convention to remap a Mesh in-place into
 * the canonical -Z-forward / +Y-up frame the classifier expects.
 *
 * The hero-car loader on the client already does this for rendering; the
 * splitter runs server-side so we replicate it here.
 */
export function canonicalisePositions(
  positions: Float32Array,
  forwardAxis: string,
): void {
  // Transform such that the input forward becomes -Z. Y is preserved (up).
  // For -y / +y forwards, swap Y and Z (Z-up source).
  const apply = (
    fn: (x: number, y: number, z: number) => [number, number, number],
  ) => {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      const r = fn(x, y, z);
      positions[i] = r[0];
      positions[i + 1] = r[1];
      positions[i + 2] = r[2];
    }
  };

  switch (forwardAxis) {
    case "-z":
      return; // already canonical
    case "+z":
      // Flip X and Z so forward is -Z.
      apply((x, y, z) => [-x, y, -z]);
      return;
    case "-x":
      // -X forward → -Z forward: rotate -90° around Y.
      apply((x, y, z) => [-z, y, x]);
      return;
    case "+x":
      // +X forward → -Z forward: rotate +90° around Y.
      apply((x, y, z) => [z, y, -x]);
      return;
    case "-y":
      // Z-up source, -Y forward. Swap Y/Z, then handle sign.
      apply((x, y, z) => [x, z, -y]);
      return;
    case "+y":
      apply((x, y, z) => [x, z, y]);
      return;
    default:
      return;
  }
}
