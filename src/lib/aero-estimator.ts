/**
 * Deterministic surrogate aero predictions.
 * Used as instant feedback in the UI before/until a CFD job has run.
 * Same physics model as the simulate-variant edge function so the
 * delta arrows the user sees match what the solver will produce.
 *
 * All numbers per variant @ 200 km/h, ρ = 1.225 kg/m³, A_f = 2.04 m²
 * for the GR86 reference. Numbers stay physically plausible (1,275 kg
 * RWD coupe).
 */
import type { AeroComponent, Geometry, SimResult } from "@/lib/repo";

export interface AeroEstimate {
  cd: number;
  cl: number;            // total lift coefficient (negative = downforce)
  drag_kgf: number;
  df_front_kgf: number;
  df_rear_kgf: number;
  df_total_kgf: number;
  ld: number;
  balance_front_pct: number;
  top_speed_kmh: number;
}

/** Stock GR86 baseline @ 200 km/h. */
const BASE = {
  cd: 0.366,
  cl: 0.18,        // mild rear lift
  drag_kgf: 116,
  df_front_kgf: 12,
  df_rear_kgf: -34,
  df_total_kgf: -22,
  top_speed_kmh: 226,
};

function paramN(p: any, key: string, dflt = 0): number {
  const v = p?.[key];
  return typeof v === "number" ? v : dflt;
}

function paramB(p: any, key: string, dflt = false): boolean {
  return typeof p?.[key] === "boolean" ? p[key] : dflt;
}

interface Contribution {
  cd: number;
  dfFront: number;
  dfRear: number;
}

/** Per-component contribution at 200 km/h. */
function contributionFor(c: AeroComponent): Contribution {
  if (!c.enabled) return { cd: 0, dfFront: 0, dfRear: 0 };
  const p = (c.params ?? {}) as Record<string, any>;

  switch (c.kind) {
    case "splitter": {
      const protrusion = paramN(p, "splProtrusion", 60);   // mm
      const depth = paramN(p, "splDepth", 110);
      const k = (protrusion / 60) * (depth / 110);
      return { cd: 0.004 * k, dfFront: 78 * k, dfRear: -6 * k };
    }
    case "canards": {
      const angle = paramN(p, "canAngle", 12);
      const pairs = paramN(p, "elements", 1);
      const stallPenalty = angle > 18 ? 0.6 : 1;
      const k = (angle / 12) * pairs * stallPenalty;
      return { cd: 0.002 * k, dfFront: 14 * k, dfRear: -2 * k };
    }
    case "skirts": {
      const depth = paramN(p, "skDepth", 70);
      const cov = paramN(p, "skLength", 90) / 100;
      const k = (depth / 70) * cov;
      return { cd: -0.001 * k, dfFront: 6 * k, dfRear: 10 * k };
    }
    case "wing": {
      const aoa = paramN(p, "aoa", 8);
      const chord = paramN(p, "chord", 280);
      const elements = paramN(p, "elements", 2);
      const gurney = paramN(p, "gurney", 12);
      const stalled = aoa > 14;
      const k = (aoa / 8) * (chord / 280) * (1 + 0.35 * (elements - 1)) * (1 + gurney / 60);
      const eff = stalled ? 0.5 : 1;
      return { cd: 0.020 * k * eff, dfFront: 6 * k * eff, dfRear: 178 * k * eff };
    }
    case "ducktail": {
      const h = paramN(p, "duckHeight", 38);
      const k = h / 38;
      return { cd: 0.003 * k, dfFront: -4 * k, dfRear: 32 * k };
    }
    case "diffuser": {
      const angle = paramN(p, "diffAngle", 11);
      const length = paramN(p, "diffLength", 780);
      const strakes = paramN(p, "diffStrakes", 4);
      const stalled = angle > 15;
      const k = (angle / 11) * (length / 780) * (1 + strakes * 0.04);
      const eff = stalled ? 0.55 : 1;
      return { cd: -0.004 * k * eff, dfFront: 38 * k * eff, dfRear: 96 * k * eff };
    }
    case "underbody": {
      const cov = paramN(p, "ubCoverage", 85) / 100;
      const naca = paramN(p, "ubNACA", 2);
      const k = cov * (1 + naca * 0.08);
      return { cd: -0.008 * k, dfFront: 12 * k, dfRear: 18 * k };
    }
    case "ride": {
      // included separately via geometry, leave neutral here
      return { cd: 0, dfFront: 0, dfRear: 0 };
    }
    default:
      return { cd: 0, dfFront: 0, dfRear: 0 };
  }
}

/** Geometry-based bias: lower ride heights → more underfloor downforce, more rake → rearward bias. */
function geometryBias(geo: Geometry | null | undefined) {
  if (!geo) return { cd: 0, dfFront: 0, dfRear: 0 };
  const rideF = geo.ride_height_front_mm ?? 130;
  const rideR = geo.ride_height_rear_mm ?? 135;
  // baseline reference 130/135
  const lowerF = (130 - rideF) / 130;   // positive when lowered
  const lowerR = (135 - rideR) / 135;
  const dfFront = 18 * Math.max(-0.5, lowerF);
  const dfRear = 12 * Math.max(-0.5, lowerR);
  const cd = -0.002 * (lowerF + lowerR);
  // wheel rotation / underbody fidelity penalties on absolute Cl
  const wheelPenalty = geo.wheel_rotation === "static" ? 0.92 : 1;
  const ubPenalty = geo.underbody_model === "simplified" ? 0.94 : 1;
  return {
    cd,
    dfFront: dfFront * wheelPenalty * ubPenalty,
    dfRear: dfRear * wheelPenalty * ubPenalty,
  };
}

export function estimateAero(
  components: AeroComponent[] = [],
  geometry?: Geometry | null,
): AeroEstimate {
  let cd = BASE.cd;
  let dfFront = BASE.df_front_kgf;
  let dfRear = BASE.df_rear_kgf;

  for (const c of components) {
    const k = contributionFor(c);
    cd += k.cd;
    dfFront += k.dfFront;
    dfRear += k.dfRear;
  }
  const geo = geometryBias(geometry);
  cd += geo.cd;
  dfFront += geo.dfFront;
  dfRear += geo.dfRear;

  const dfTotal = dfFront + dfRear;
  const drag_kgf = (cd / BASE.cd) * BASE.drag_kgf;
  const ld = drag_kgf > 0 ? dfTotal / drag_kgf : 0;
  // Cl ≈ -dfTotal × g / (½ρV²A) — simplified relation to baseline
  const cl = -dfTotal / Math.max(60, drag_kgf) * 0.6;
  const balance_front_pct = dfTotal !== 0 ? (dfFront / dfTotal) * 100 : 50;
  // Top speed: drag-limited, rough scaling
  const top_speed_kmh = BASE.top_speed_kmh * Math.pow(BASE.cd / cd, 1 / 3);

  return {
    cd: round(cd, 3),
    cl: round(cl, 2),
    drag_kgf: round(drag_kgf, 0),
    df_front_kgf: round(dfFront, 0),
    df_rear_kgf: round(dfRear, 0),
    df_total_kgf: round(dfTotal, 0),
    ld: round(ld, 2),
    balance_front_pct: round(balance_front_pct, 1),
    top_speed_kmh: round(top_speed_kmh, 0),
  };
}

function round(n: number, d: number): number {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
}

/** Pull aero metrics from a saved sim result, falling back to estimate. */
export function aeroFromResult(
  result: SimResult | null | undefined,
  fallback: AeroEstimate,
): AeroEstimate & { isStale: boolean; fromSim: boolean } {
  if (!result) return { ...fallback, isStale: false, fromSim: false };
  return {
    cd: Number(result.cd),
    cl: 0, // not stored explicitly; UI mostly shows Cd / DF
    drag_kgf: Number(result.drag_kgf),
    df_front_kgf: Number(result.df_front_kgf),
    df_rear_kgf: Number(result.df_rear_kgf),
    df_total_kgf: Number(result.df_total_kgf),
    ld: Number(result.ld_ratio),
    balance_front_pct: Number(result.balance_front_pct),
    top_speed_kmh: result.top_speed_kmh ? Number(result.top_speed_kmh) : fallback.top_speed_kmh,
    isStale: result.is_stale,
    fromSim: true,
  };
}

/** Diff vs baseline for arrow displays. */
export function aeroDelta(current: AeroEstimate, baseline: AeroEstimate) {
  return {
    cd: round(current.cd - baseline.cd, 3),
    cdPct: round(((current.cd - baseline.cd) / baseline.cd) * 100, 1),
    drag: round(current.drag_kgf - baseline.drag_kgf, 0),
    dfTotal: round(current.df_total_kgf - baseline.df_total_kgf, 0),
    dfFront: round(current.df_front_kgf - baseline.df_front_kgf, 0),
    dfRear: round(current.df_rear_kgf - baseline.df_rear_kgf, 0),
    ld: round(current.ld - baseline.ld, 2),
    balance: round(current.balance_front_pct - baseline.balance_front_pct, 1),
    topSpeed: round(current.top_speed_kmh - baseline.top_speed_kmh, 0),
  };
}
