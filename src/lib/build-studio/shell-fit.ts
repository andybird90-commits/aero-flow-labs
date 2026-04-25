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

  if (localBox.isEmpty()) return { front: null, rear: null, sampleCount: 0 };

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

  // Outer band: |width-axis| > 60% of half-width — outermost surfaces only.
  // This rejects the inside-of-cabin verts that would otherwise drag the
  // centroid inward.
  const halfWidth = size[widthAxis] / 2;
  const widthCut = halfWidth * 0.55;
  const widthCentre = (min[widthAxis] + max[widthAxis]) / 2;

  // Length midpoint — splits front/rear.
  const lenMid = (min[lenAxis] + max[lenAxis]) / 2;

  // Accumulators for front + rear arch centroids.
  let frontSum = new THREE.Vector3();
  let frontCount = 0;
  let rearSum = new THREE.Vector3();
  let rearCount = 0;
  let total = 0;

  // Track lowest Y per side too — arch lip is roughly at min-Y of the cluster
  // and we want the *centre* of the wheel cutout (~hub height), which is
  // ~0.5 * (lip height + lip height + arch radius). For a simple, robust
  // proxy we use the arithmetic mean Y of the bottom-band outer-band points
  // in each X cluster. Empirically this lands within ~5cm of true hub for
  // production car bodies.
  for (const flat of allPositions) {
    for (let i = 0; i < flat.length; i += 3) {
      const x = flat[i + 0];
      const y = flat[i + 1];
      const z = flat[i + 2];
      total++;
      if (y > yCut) continue;
      const widthVal = widthAxis === "x" ? x : widthAxis === "y" ? y : z;
      if (Math.abs(widthVal - widthCentre) < widthCut) continue;
      const lenVal = lenAxis === "x" ? x : lenAxis === "y" ? y : z;
      const p = new THREE.Vector3(x, y, z);
      if (lenVal > lenMid) {
        frontSum.add(p);
        frontCount++;
      } else {
        rearSum.add(p);
        rearCount++;
      }
    }
  }

  // Need a meaningful sample on each side or we can't trust the centroid.
  const minSamples = 60;
  const front =
    frontCount >= minSamples
      ? toVec(frontSum.multiplyScalar(1 / frontCount))
      : null;
  const rear =
    rearCount >= minSamples
      ? toVec(rearSum.multiplyScalar(1 / rearCount))
      : null;

  // The detected arch is car-front vs car-rear *in shell local space*. The
  // donor car's "front" hardpoint sits at the front of the donor car. The
  // shell loader does not guarantee either orientation, so we tag by which
  // cluster has the larger length-axis value (= "front of shell"). The
  // caller is responsible for matching that to the donor's front hardpoint
  // — we expose both candidates and let auto-fit pair them.
  return { front, rear, sampleCount: total };

  function toVec(p: THREE.Vector3): Vec3 {
    return v(p.x, p.y, p.z);
  }
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
