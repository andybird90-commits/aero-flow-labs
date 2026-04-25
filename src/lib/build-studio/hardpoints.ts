/**
 * Car hardpoints — admin-managed reference markers on a car_template.
 *
 * Hardpoints are anatomically meaningful points on a real car body
 * (front-bumper centre, wheel-hub centres, A-pillar bases, mirror bases,
 * rocker fore/aft, etc.). They are used by Shell Fit Mode to *align* a
 * generated body skin to the donor car: the user pairs N skin landmarks
 * with the matching car hardpoints, and we solve for the rigid + uniform
 * scale transform that best matches them.
 *
 * Data lives in `car_hardpoints`. RLS allows anyone authenticated to read,
 * admins to write.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Vec3 } from "./placed-parts";

export type CarHardpointType = Database["public"]["Enums"]["car_hardpoint_type"];

export interface CarHardpoint {
  id: string;
  car_template_id: string;
  point_type: CarHardpointType;
  label: string | null;
  notes: string | null;
  position: Vec3;
  created_at: string;
  updated_at: string;
}

/* ─── Queries / mutations ─── */

export function useCarHardpoints(carTemplateId: string | null | undefined) {
  return useQuery({
    queryKey: ["car_hardpoints", carTemplateId],
    enabled: !!carTemplateId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("car_hardpoints")
        .select("*")
        .eq("car_template_id", carTemplateId!)
        .order("point_type", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CarHardpoint[];
    },
  });
}

export function useAddCarHardpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      car_template_id: string;
      point_type: CarHardpointType;
      label?: string;
      position?: Vec3;
    }) => {
      const { data, error } = await (supabase as any)
        .from("car_hardpoints")
        .insert({
          car_template_id: input.car_template_id,
          point_type: input.point_type,
          label: input.label ?? null,
          position: input.position ?? { x: 0, y: 0.5, z: 0 },
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as CarHardpoint;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["car_hardpoints", vars.car_template_id] });
    },
  });
}

export function useUpdateCarHardpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      car_template_id: string;
      patch: Partial<Pick<CarHardpoint, "position" | "label" | "notes" | "point_type">>;
    }) => {
      const { data, error } = await (supabase as any)
        .from("car_hardpoints")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as CarHardpoint;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["car_hardpoints", vars.car_template_id] });
    },
  });
}

export function useDeleteCarHardpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; car_template_id: string }) => {
      const { error } = await (supabase as any)
        .from("car_hardpoints")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["car_hardpoints", vars.car_template_id] });
    },
  });
}

/* ─── Display metadata ─── */

export const HARDPOINT_LABELS: Record<CarHardpointType, string> = {
  front_bumper_center: "Front bumper centre",
  rear_bumper_center: "Rear bumper centre",
  front_left_wheel_hub: "Wheel hub — FL",
  front_right_wheel_hub: "Wheel hub — FR",
  rear_left_wheel_hub: "Wheel hub — RL",
  rear_right_wheel_hub: "Wheel hub — RR",
  windshield_base: "Windshield base",
  windshield_top: "Windshield top",
  rear_window_base: "Rear window base",
  rear_window_top: "Rear window top",
  left_mirror_base: "Mirror base — L",
  right_mirror_base: "Mirror base — R",
  left_a_pillar_base: "A-pillar base — L",
  right_a_pillar_base: "A-pillar base — R",
  left_rocker_front: "Rocker front — L",
  right_rocker_front: "Rocker front — R",
  left_rocker_rear: "Rocker rear — L",
  right_rocker_rear: "Rocker rear — R",
  roof_center: "Roof centre",
  hood_front_center: "Hood front centre",
  trunk_rear_center: "Trunk rear centre",
};

export const HARDPOINT_TYPES: CarHardpointType[] = Object.keys(
  HARDPOINT_LABELS,
) as CarHardpointType[];

/* ─── Shell Fit alignment math ─── */

export interface HardpointPair {
  car: Vec3;
  shell: Vec3;
}

export interface SolvedShellTransform {
  position: Vec3;
  rotation: Vec3; // Euler XYZ radians
  scale: Vec3; // uniform — same value in x/y/z
  rms: number; // residual root-mean-square error in metres
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const scale = (a: Vec3, s: number): Vec3 => v(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: Vec3): number => Math.sqrt(dot(a, a));

const centroid = (pts: Vec3[]): Vec3 => {
  if (pts.length === 0) return v(0, 0, 0);
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  return v(cx / pts.length, cy / pts.length, cz / pts.length);
};

/**
 * Solve a similarity transform (R, t, s) such that
 *   car_i ≈ s * R * shell_i + t
 * for N >= 3 paired hardpoints, using a Kabsch SVD on a 3×3 covariance matrix.
 *
 * Falls back to translation-only when fewer than 3 pairs are provided.
 * Returns Euler XYZ rotation extracted from the solved rotation matrix.
 */
export function solveShellTransform(pairs: HardpointPair[]): SolvedShellTransform | null {
  if (pairs.length === 0) return null;

  const carPts = pairs.map((p) => p.car);
  const shellPts = pairs.map((p) => p.shell);
  const cCar = centroid(carPts);
  const cShell = centroid(shellPts);

  // Translation-only fallback (1–2 pairs): no rotation/scale solvable.
  if (pairs.length < 3) {
    const t = sub(cCar, cShell);
    return {
      position: t,
      rotation: v(0, 0, 0),
      scale: v(1, 1, 1),
      rms: 0,
    };
  }

  // Centre both sets.
  const xCar = carPts.map((p) => sub(p, cCar));
  const xShell = shellPts.map((p) => sub(p, cShell));

  // Covariance H = sum(shell_i * car_i^T) — 3×3.
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < pairs.length; i++) {
    const s = xShell[i];
    const c = xCar[i];
    H[0][0] += s.x * c.x;  H[0][1] += s.x * c.y;  H[0][2] += s.x * c.z;
    H[1][0] += s.y * c.x;  H[1][1] += s.y * c.y;  H[1][2] += s.y * c.z;
    H[2][0] += s.z * c.x;  H[2][1] += s.z * c.y;  H[2][2] += s.z * c.z;
  }

  const svd = svd3(H);
  if (!svd) return null;
  const { U, V } = svd;

  // R = V * diag(1,1,d) * U^T, where d = det(V * U^T) (handles reflection).
  const Vt = transpose3(V);
  const Ut = transpose3(U);
  const VUt = mul3(V, Ut);
  let d = det3(VUt);
  d = d < 0 ? -1 : 1;
  const D: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, d],
  ];
  const R = mul3(mul3(V, D), Ut);

  // Uniform scale s = sum(σ_i) * d_i / sum(||shell_i||^2)
  // Approximate by ratio of variances (Umeyama 1991).
  let varShell = 0;
  for (const p of xShell) varShell += dot(p, p);
  varShell = varShell || 1;

  // Trace(D * S) where S is diag of singular values.
  const sigma = svd.S;
  let traceDS = sigma[0] + sigma[1] + d * sigma[2];
  let s = traceDS / varShell;
  if (!isFinite(s) || s <= 0) s = 1;

  // t = cCar - s * R * cShell
  const Rcs = applyMat3(R, cShell);
  const t = sub(cCar, scale(Rcs, s));

  // Residuals.
  let sse = 0;
  for (let i = 0; i < pairs.length; i++) {
    const pred = add(scale(applyMat3(R, shellPts[i]), s), t);
    const e = sub(pred, carPts[i]);
    sse += dot(e, e);
  }
  const rms = Math.sqrt(sse / pairs.length);

  return {
    position: t,
    rotation: rotationMatrixToEuler(R),
    scale: v(s, s, s),
    rms,
  };
}

/* ─── Tiny 3×3 linear-algebra helpers ─── */

function transpose3(m: number[][]): number[][] {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

function mul3(a: number[][], b: number[][]): number[][] {
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function applyMat3(m: number[][], p: Vec3): Vec3 {
  return v(
    m[0][0] * p.x + m[0][1] * p.y + m[0][2] * p.z,
    m[1][0] * p.x + m[1][1] * p.y + m[1][2] * p.z,
    m[2][0] * p.x + m[2][1] * p.y + m[2][2] * p.z,
  );
}

/** Extract Euler XYZ from a rotation matrix (Three.js convention). */
function rotationMatrixToEuler(m: number[][]): Vec3 {
  // Three.js XYZ order:
  //   y = asin(clamp(m13, -1, 1))
  //   if |m13| < 1: x = atan2(-m23, m33), z = atan2(-m12, m11)
  //   else        : x = atan2( m32, m22), z = 0
  const m11 = m[0][0], m12 = m[0][1], m13 = m[0][2];
  const m22 = m[1][1], m23 = m[1][2];
  const m32 = m[2][1], m33 = m[2][2];

  const y = Math.asin(Math.max(-1, Math.min(1, m13)));
  let x: number, z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return v(x, y, z);
}

/**
 * Symmetric eigen-decomp of A^T A → 3×3 SVD.
 * Returns U, S (singular values), V s.t. A = U * diag(S) * V^T.
 *
 * Implementation: build A^T A (symmetric 3×3), use Jacobi eigen rotations to
 * get V and σ_i^2, then U columns = (1/σ_i) * A * V_i.
 */
function svd3(A: number[][]): { U: number[][]; S: number[]; V: number[][] } | null {
  // ATA
  const ATA: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      ATA[i][j] = A[0][i] * A[0][j] + A[1][i] * A[1][j] + A[2][i] * A[2][j];
    }
  }
  const eig = jacobiEigen3(ATA);
  if (!eig) return null;
  // Sort eigenvalues desc.
  const idx = [0, 1, 2].sort((a, b) => eig.values[b] - eig.values[a]);
  const sigmaSq = idx.map((i) => Math.max(eig.values[i], 0));
  const V: number[][] = [
    [eig.vectors[0][idx[0]], eig.vectors[0][idx[1]], eig.vectors[0][idx[2]]],
    [eig.vectors[1][idx[0]], eig.vectors[1][idx[1]], eig.vectors[1][idx[2]]],
    [eig.vectors[2][idx[0]], eig.vectors[2][idx[1]], eig.vectors[2][idx[2]]],
  ];
  const S = sigmaSq.map((s) => Math.sqrt(s));
  // U columns = A * V_i / σ_i (or arbitrary unit if σ=0).
  const U: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < 3; k++) {
    const vCol = v(V[0][k], V[1][k], V[2][k]);
    const Av = applyMat3(A, vCol);
    const s = S[k] || 1e-9;
    U[0][k] = Av.x / s;
    U[1][k] = Av.y / s;
    U[2][k] = Av.z / s;
  }
  // Re-orthonormalize U via Gram-Schmidt to absorb noise.
  gramSchmidtCols(U);
  return { U, S, V };
}

function jacobiEigen3(
  Ain: number[][],
): { values: number[]; vectors: number[][] } | null {
  const A = [
    [Ain[0][0], Ain[0][1], Ain[0][2]],
    [Ain[1][0], Ain[1][1], Ain[1][2]],
    [Ain[2][0], Ain[2][1], Ain[2][2]],
  ];
  const Vm = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 100; iter++) {
    // Find largest off-diagonal.
    let p = 0,
      q = 1,
      maxV = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > maxV) {
      p = 0;
      q = 2;
      maxV = Math.abs(A[0][2]);
    }
    if (Math.abs(A[1][2]) > maxV) {
      p = 1;
      q = 2;
      maxV = Math.abs(A[1][2]);
    }
    if (maxV < 1e-12) break;
    const apq = A[p][q];
    const app = A[p][p];
    const aqq = A[q][q];
    const theta = (aqq - app) / (2 * apq);
    const t =
      theta >= 0
        ? 1 / (theta + Math.sqrt(1 + theta * theta))
        : 1 / (theta - Math.sqrt(1 + theta * theta));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    // Update A.
    A[p][p] = app - t * apq;
    A[q][q] = aqq + t * apq;
    A[p][q] = 0;
    A[q][p] = 0;
    for (let i = 0; i < 3; i++) {
      if (i !== p && i !== q) {
        const aip = A[i][p];
        const aiq = A[i][q];
        A[i][p] = c * aip - s * aiq;
        A[p][i] = A[i][p];
        A[i][q] = s * aip + c * aiq;
        A[q][i] = A[i][q];
      }
    }
    // Update V.
    for (let i = 0; i < 3; i++) {
      const vip = Vm[i][p];
      const viq = Vm[i][q];
      Vm[i][p] = c * vip - s * viq;
      Vm[i][q] = s * vip + c * viq;
    }
  }
  return { values: [A[0][0], A[1][1], A[2][2]], vectors: Vm };
}

function gramSchmidtCols(M: number[][]) {
  const cols = [0, 1, 2].map((k) => v(M[0][k], M[1][k], M[2][k]));
  // c0
  let n0 = norm(cols[0]) || 1e-9;
  cols[0] = scale(cols[0], 1 / n0);
  // c1 -= (c0·c1) c0
  let d10 = dot(cols[1], cols[0]);
  cols[1] = sub(cols[1], scale(cols[0], d10));
  let n1 = norm(cols[1]) || 1e-9;
  cols[1] = scale(cols[1], 1 / n1);
  // c2 = c0 × c1 (right-handed)
  cols[2] = v(
    cols[0].y * cols[1].z - cols[0].z * cols[1].y,
    cols[0].z * cols[1].x - cols[0].x * cols[1].z,
    cols[0].x * cols[1].y - cols[0].y * cols[1].x,
  );
  for (let k = 0; k < 3; k++) {
    M[0][k] = cols[k].x;
    M[1][k] = cols[k].y;
    M[2][k] = cols[k].z;
  }
}
