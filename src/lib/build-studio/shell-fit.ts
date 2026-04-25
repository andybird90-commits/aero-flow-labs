/**
 * Shell-fit auto-alignment helpers.
 *
 * "Shell drift" is the dominant failure mode when overlaying an AI-generated
 * body skin on a donor car: the overall silhouette is right, but the
 * wheelbase is ~10-30% off, so the wheel arches sit ahead of or behind the
 * actual wheels. This module solves that automatically.
 *
 * Two strategies are exposed:
 *
 *  1. `autoFitToWheelbase(shellMesh, hardpoints)` — detects the front + rear
 *     wheel-arch centres directly from the shell's geometry (no user input)
 *     and solves a similarity transform mapping them to the donor car's
 *     `front_wheel_centre` / `rear_wheel_centre` hardpoints.
 *
 *  2. `solveFromLockedHardpoints(pairs)` — re-uses the Kabsch solver in
 *     `hardpoints.ts` against the pairs the user has already locked via the
 *     manual click-to-pair UI.
 *
 * Both return a {@link SolvedShellTransform} that can be written straight
 * back to `shell_alignments`.
 */
import * as THREE from "three";
import {
  HARDPOINT_LABELS,
  solveShellTransform,
  type CarHardpoint,
  type HardpointPair,
  type SolvedShellTransform,
} from "./hardpoints";
import type { LockedHardpointPair } from "./shell-alignments";
import type { Vec3 } from "./placed-parts";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Result of detecting wheel arches on the shell mesh, in *shell-local* coords. */
export interface DetectedArches {
  front: Vec3 | null;
  rear: Vec3 | null;
  /** Total candidate vertices used — for diagnostics. */
  sampleCount: number;
  /**
   * Which axis (x/y/z) of the shell-local frame represents vehicle *length*.
   * Needed by callers to convert arch span → wheelbase under non-uniform
   * scale.
   */
  lengthAxis: "x" | "y" | "z";
}

/* ─────────────────────────────────────────────────────────────────────────
 * Wheel-arch detection
 *
 * Heuristic: a car's wheel arches are the two largest *low-down* concave
 * cutouts on each side of the body. Their centres sit roughly at:
 *   - Y = (vehicle ground) + (wheel radius)         — ≈ bottom 25% of bbox
 *   - |Z| close to half-track                       — outer surface
 *   - X split into front-half and rear-half         — gives us 2 clusters
 *
 * We sample vertices in the bottom band, project onto the XY plane (ignoring
 * left-vs-right by flipping all Z to one side), then take the centroid of
 * the cluster of vertices whose triangle normals point *outward* + slightly
 * *down* — those are the arch lip vertices. Front/rear is decided by sign
 * of X relative to the centre.
 *
 * This is intentionally tolerance-tolerant: any shell with visible wheel
 * cutouts will produce reasonable arch centres. Fully-skirted bodies
 * (concept cars, race covers) will fail gracefully and return nulls.
 * ──────────────────────────────────────────────────────────────────────── */
export function detectWheelArches(root: THREE.Object3D): DetectedArches {
  // Walk every mesh under the shell and collect vertex positions in the
  // shell's *local* frame (i.e. before the user-applied alignment transform).
  // We deliberately use untransformed positions so the result is invariant
  // to whatever alignment is currently applied — pure geometry feature.
  const allPositions: Float32Array[] = [];
  root.updateMatrixWorld(true);

  // Compute the inverse of the root transform so we can express vertices in
  // the root's local frame regardless of nested rotations applied at load.
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tmp = new THREE.Vector3();

  const localBox = new THREE.Box3();
  root.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const flat = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      tmp.applyMatrix4(m.matrixWorld).applyMatrix4(rootInv);
      flat[i * 3 + 0] = tmp.x;
      flat[i * 3 + 1] = tmp.y;
      flat[i * 3 + 2] = tmp.z;
      localBox.expandByPoint(tmp);
    }
    allPositions.push(flat);
  });

  if (localBox.isEmpty())
    return { front: null, rear: null, sampleCount: 0, lengthAxis: "x" };

  const size = new THREE.Vector3();
  localBox.getSize(size);
  const min = localBox.min;
  const max = localBox.max;

  // Determine which axis is *length* (longest), *height* (vertical, usually Y
  // because the loader rotates STL by -π/2 around X so +Y is up), and
  // *width* (the remaining one). We will be tolerant either way.
  const axes = (["x", "y", "z"] as const)
    .map((k) => ({ k, span: size[k] }))
    .sort((a, b) => b.span - a.span);
  const lenAxis = axes[0].k; // longest
  const heightAxis = "y"; // wrapper guarantees +Y is up
  const widthAxis = (["x", "y", "z"] as const).find(
    (k) => k !== lenAxis && k !== heightAxis,
  ) as "x" | "y" | "z";

  // Bottom band: lower 35% of height — wheel arches live there.
  const yCut = min.y + size.y * 0.35;

  // Outer band: |width-axis - centre| > 55% of half-width — outermost only.
  const halfWidth = size[widthAxis] / 2;
  const widthCut = halfWidth * 0.55;
  const widthCentre = (min[widthAxis] + max[widthAxis]) / 2;

  // ── Arch-LIP detection via length-binned local Y minima ───────────────
  // The real arch lip is the LOCAL MINIMUM of Y inside each length-axis
  // bin — i.e. the lowest body point at that length position. We bin the
  // length axis, take the min-Y vertex in each, then fit two clusters
  // (front half, rear half) weighted by arch depth.
  //
  // CRITICAL: we exclude the outermost ~12% at each end of the length axis
  // because splitters, diffusers and rear wings dip lower than wheel arches
  // and, if included, drag the detected arch centre off the wheels —
  // producing a wildly wrong shell wheelbase. Real wheel arches always sit
  // within the 12–88% length band on production cars.
  const N_BINS = 80;
  const binMinY = new Float32Array(N_BINS).fill(Infinity);
  const binAtMinX = new Float32Array(N_BINS);
  const binAtMinY = new Float32Array(N_BINS);
  const binAtMinZ = new Float32Array(N_BINS);
  const lenSpan = max[lenAxis] - min[lenAxis];
  if (lenSpan < 1e-6)
    return { front: null, rear: null, sampleCount: 0, lengthAxis: lenAxis };

  // Length-axis trim band — ignore overhanging aero appendages.
  const lenTrim = 0.12;
  const lenLo = min[lenAxis] + lenSpan * lenTrim;
  const lenHi = max[lenAxis] - lenSpan * lenTrim;

  let total = 0;
  for (const flat of allPositions) {
    for (let i = 0; i < flat.length; i += 3) {
      const x = flat[i + 0];
      const y = flat[i + 1];
      const z = flat[i + 2];
      total++;
      if (y > yCut) continue;
      const lenVal = lenAxis === "x" ? x : lenAxis === "y" ? y : z;
      if (lenVal < lenLo || lenVal > lenHi) continue; // skip splitter/diffuser/wing zone
      const widthVal = widthAxis === "x" ? x : widthAxis === "y" ? y : z;
      if (Math.abs(widthVal - widthCentre) < widthCut) continue;
      const t = (lenVal - lenLo) / (lenHi - lenLo);
      const bin = Math.min(N_BINS - 1, Math.max(0, Math.floor(t * N_BINS)));
      if (y < binMinY[bin]) {
        binMinY[bin] = y;
        binAtMinX[bin] = x;
        binAtMinY[bin] = y;
        binAtMinZ[bin] = z;
      }
    }
  }

  const archBins: { len: number; x: number; y: number; z: number; depth: number }[] = [];
  const validYs = Array.from(binMinY).filter((y) => Number.isFinite(y));
  if (validYs.length < 8)
    return { front: null, rear: null, sampleCount: total, lengthAxis: lenAxis };
  validYs.sort((a, b) => a - b);
  // Body floor (between arches) ≈ 85th percentile of bin min-Ys.
  const groundY = validYs[Math.floor(validYs.length * 0.85)];
  for (let bin = 0; bin < N_BINS; bin++) {
    if (!Number.isFinite(binMinY[bin])) continue;
    const len =
      lenAxis === "x" ? binAtMinX[bin] : lenAxis === "y" ? binAtMinY[bin] : binAtMinZ[bin];
    const depth = groundY - binMinY[bin]; // positive = bin dips lower than body floor
    if (depth <= 0) continue;
    archBins.push({ len, x: binAtMinX[bin], y: binAtMinY[bin], z: binAtMinZ[bin], depth });
  }
  if (archBins.length < 4)
    return { front: null, rear: null, sampleCount: total, lengthAxis: lenAxis };

  // Split into front/rear by length midpoint, weight by depth² so the
  // *deepest* dip in each half (the wheel arch peak) dominates over
  // shallower undulations.
  const lenMid = (lenLo + lenHi) / 2;
  let fSx = 0, fSy = 0, fSz = 0, fW = 0;
  let rSx = 0, rSy = 0, rSz = 0, rW = 0;
  for (const b of archBins) {
    const w = b.depth * b.depth;
    if (b.len > lenMid) {
      fSx += b.x * w; fSy += b.y * w; fSz += b.z * w; fW += w;
    } else {
      rSx += b.x * w; rSy += b.y * w; rSz += b.z * w; rW += w;
    }
  }

  const front = fW > 0 ? v(fSx / fW, fSy / fW, fSz / fW) : null;
  const rear = rW > 0 ? v(rSx / rW, rSy / rW, rSz / rW) : null;

  return { front, rear, sampleCount: total, lengthAxis: lenAxis };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Auto-fit to wheelbase
 * ──────────────────────────────────────────────────────────────────────── */
export interface AutoFitResult {
  /** Solved transform — can be written straight to shell_alignments. */
  transform: SolvedShellTransform;
  /** Pairs we used (for the user to inspect / re-lock as manual pairs). */
  pairs: HardpointPair[];
  /** Detected arches in shell-local space, for diagnostics + UI markers. */
  arches: DetectedArches;
  /** Donor car hardpoints we paired against. */
  carPoints: { front: Vec3; rear: Vec3 };
}

/**
 * One-click wheelbase fit. Detects shell wheel arches and solves a
 * translation+uniform-scale transform that maps them onto the donor car's
 * front+rear wheel-centre hardpoints.
 *
 * With only 2 pairs the rotation is undersolved by Kabsch (we'd need a 3rd
 * point off-axis), so we deliberately add a virtual 3rd pair on the
 * vehicle centreline at ground level. This keeps the body upright and
 * stops it from rolling/yawing when scaled.
 */
export function autoFitToWheelbase(
  shellRoot: THREE.Object3D,
  carHardpoints: CarHardpoint[],
): AutoFitResult | null {
  const front = carHardpoints.find((h) => h.point_type === "front_wheel_centre");
  const rear = carHardpoints.find((h) => h.point_type === "rear_wheel_centre");
  if (!front || !rear) return null;

  const arches = detectWheelArches(shellRoot);
  if (!arches.front || !arches.rear) return null;

  // The detection labels arches by *shell* front/rear (whichever has the
  // larger length-axis value). Match them to the donor car by aligning the
  // signs: whichever shell arch has the larger length-axis value is paired
  // with the donor car hardpoint that *also* has the larger length-axis
  // value (the donor's "front" by convention sits at +X or -X depending on
  // forward axis — using the sign here makes us robust to either).
  //
  // We score the two possible pairings and take the one with the smaller
  // intra-pair length difference vs the wheelbase.
  const carWb = distance(front.position, rear.position);
  const shellWbA = distance(arches.front, arches.rear);
  const shellWbB = shellWbA; // same magnitude, we're choosing labelling only

  const pairingA: HardpointPair[] = [
    { car: front.position, shell: arches.front },
    { car: rear.position, shell: arches.rear },
  ];
  const pairingB: HardpointPair[] = [
    { car: front.position, shell: arches.rear },
    { car: rear.position, shell: arches.front },
  ];

  // Pick the labelling whose orientation matches: distance after a
  // pure-translation alignment should be similar to wheelbase. We pick the
  // pairing where the centroid-to-centroid vectors point in the same
  // direction.
  const bestPairs = scorePairing(pairingA) >= scorePairing(pairingB)
    ? pairingA
    : pairingB;

  // Add virtual ground-centre point for both sides — keeps roll/yaw locked
  // and means the Kabsch SVD is non-degenerate (3 non-collinear points).
  const carGround: Vec3 = midpoint3D(front.position, rear.position, true);
  const shellGround: Vec3 = midpoint3D(bestPairs[0].shell, bestPairs[1].shell, true);
  const fullPairs: HardpointPair[] = [
    ...bestPairs,
    { car: carGround, shell: shellGround },
  ];

  const transform = solveShellTransform(fullPairs);
  if (!transform) return null;

  return {
    transform,
    pairs: bestPairs,
    arches,
    carPoints: { front: front.position, rear: rear.position },
  };

  function scorePairing(pairs: HardpointPair[]): number {
    // Higher = better. We prefer the pairing whose shell vector
    // (front - rear) points in the same direction as the car's vector.
    const carVec = sub(pairs[0].car, pairs[1].car);
    const shellVec = sub(pairs[0].shell, pairs[1].shell);
    const cn = norm(carVec) || 1;
    const sn = norm(shellVec) || 1;
    return (
      (carVec.x * shellVec.x + carVec.y * shellVec.y + carVec.z * shellVec.z) /
      (cn * sn)
    );
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Match wheelbase exactly — pure 1D scale fix.
 *
 * Lighter-touch alternative to `autoFitToWheelbase`: rather than solving a
 * full similarity transform (which can over-rotate when arches are slightly
 * mis-detected on one side), this just computes the ratio between the donor
 * wheelbase and the detected shell-arch span and applies it as **uniform
 * scale**, then re-translates so the *midpoint* of the shell arches sits on
 * the *midpoint* of the donor wheel-centres. Rotation is left untouched.
 *
 * Use case: shell silhouette is correct but the wheelbase is X mm short or
 * long (the dominant failure mode for AI-generated bodies).
 * ──────────────────────────────────────────────────────────────────────── */
export interface WheelbaseFitResult {
  transform: SolvedShellTransform;
  shellWheelbaseM: number;
  donorWheelbaseM: number;
  scaleFactor: number;
}

export function matchWheelbaseExact(
  shellRoot: THREE.Object3D,
  carHardpoints: CarHardpoint[],
  currentTransform: { position: Vec3; rotation: Vec3; scale: Vec3 } | null,
): WheelbaseFitResult | null {
  const front = carHardpoints.find((h) => h.point_type === "front_wheel_centre");
  const rear = carHardpoints.find((h) => h.point_type === "rear_wheel_centre");
  if (!front || !rear) return null;

  const arches = detectWheelArches(shellRoot);
  if (!arches.front || !arches.rear) return null;

  // ── Critical: detected arches are in shell-LOCAL space (i.e. AFTER the
  // wrapper's load-time normalize-scale, but BEFORE the user's
  // currentTransform). The shell rendered in the scene = local × scale +
  // position, so to compare its rendered wheelbase to the donor wheelbase
  // we must include `currentTransform.scale` on the length axis.
  const baseScale = currentTransform?.scale ?? { x: 1, y: 1, z: 1 };
  const basePosition = currentTransform?.position ?? { x: 0, y: 0, z: 0 };
  const lenAxis = arches.lengthAxis; // "x" | "y" | "z" of shell-local frame
  const localShellWb = distance(arches.front, arches.rear);
  if (localShellWb < 1e-4) return null;
  // World wheelbase the user is currently *seeing* on screen.
  const worldShellWb = localShellWb * baseScale[lenAxis];
  const donorWb = distance(front.position, rear.position); // world metres
  if (worldShellWb < 1e-4) return null;

  // Correction factor: how much we need to multiply the *current* scale by
  // so the rendered arch span matches the donor wheelbase exactly.
  const correctionFactor = donorWb / worldShellWb;
  const newScale: Vec3 = {
    x: baseScale.x * correctionFactor,
    y: baseScale.y * correctionFactor,
    z: baseScale.z * correctionFactor,
  };

  // Re-derive translation so the shell-arch midpoint lands on the donor
  // wheel-centre midpoint. After scale: rendered point = (local * newScale) +
  // position. We want (shellMid * newScale) + position = donorMid.
  const shellMid = midpoint3D(arches.front, arches.rear, false);
  const donorMid = midpoint3D(front.position, rear.position, false);
  const newPosition: Vec3 = {
    // For X/Z (length + width) — clamp the midpoint to donor.
    x: donorMid.x - shellMid.x * newScale.x,
    z: donorMid.z - shellMid.z * newScale.z,
    // For Y (height) — preserve the user's current vertical placement so
    // we don't drop the body into the ground or float it above the car.
    // We compensate for the scale change so the *current* world Y of the
    // shell-arch midpoint stays put.
    y: basePosition.y + shellMid.y * (baseScale.y - newScale.y),
  };

  return {
    transform: {
      position: newPosition,
      rotation: currentTransform?.rotation ?? { x: 0, y: 0, z: 0 },
      scale: newScale,
      // RMS = 0 by construction (we made the wheelbase exact).
      rms: 0,
    },
    shellWheelbaseM: worldShellWb,
    donorWheelbaseM: donorWb,
    scaleFactor: correctionFactor,
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Manual: solve from locked hardpoint pairs
 * ──────────────────────────────────────────────────────────────────────── */
export function solveFromLockedHardpoints(
  locked: LockedHardpointPair[],
  carHardpoints: CarHardpoint[],
): SolvedShellTransform | null {
  const byId = new Map(carHardpoints.map((h) => [h.id, h]));
  const pairs: HardpointPair[] = [];
  for (const lp of locked) {
    const car = byId.get(lp.car_hardpoint_id);
    if (!car) continue;
    pairs.push({ car: car.position, shell: lp.shell });
  }
  if (pairs.length < 2) return null;
  return solveShellTransform(pairs);
}

/** Human-friendly description of a hardpoint pair count → fit quality. */
export function describeFitQuality(rmsM: number): string {
  if (rmsM < 0.005) return "Excellent (<5 mm)";
  if (rmsM < 0.02) return "Good (<2 cm)";
  if (rmsM < 0.05) return "Acceptable (<5 cm)";
  return "Poor — try adding more pairs";
}

/** Human label for a car hardpoint, falling back to its enum label. */
export function hardpointDisplay(h: CarHardpoint): string {
  return h.label || HARDPOINT_LABELS[h.point_type];
}

/* ─── tiny vec3 helpers ─── */
function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return v(a.x - b.x, a.y - b.y, a.z - b.z);
}
function norm(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
function midpoint3D(a: Vec3, b: Vec3, dropY: boolean): Vec3 {
  const mx = (a.x + b.x) / 2;
  const my = dropY ? Math.min(a.y, b.y) - 0.05 : (a.y + b.y) / 2;
  const mz = (a.z + b.z) / 2;
  return v(mx, my, mz);
}
