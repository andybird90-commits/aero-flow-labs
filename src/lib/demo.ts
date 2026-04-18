/**
 * AeroLab Demo Dataset — Toyota GR86 (ZN8) Track Build
 * ─────────────────────────────────────────────────────
 * Investor / customer-ready realistic example.
 * Single source of truth for the showcase build, its variants,
 * simulation results, assumptions and confidence scoring.
 *
 * All numbers are physically plausible for a 1,275 kg RWD coupe
 * at 200 km/h, ρ = 1.225 kg/m³, frontal area 2.04 m².
 */

export type ConfLevel = "low" | "medium" | "high";
export type VariantTag = "Baseline" | "Splitter" | "Wing" | "Diffuser" | "Optimized";
export type JobState = "queued" | "running" | "converged" | "failed" | "warning";
export type SimKind = "preview" | "full";

/* ─── Demo car ──────────────────────────────────────────────── */
export const DEMO_CAR = {
  id: "gr86-zn8",
  make: "Toyota",
  model: "GR86",
  trim: "ZN8 · 2023",
  mass: 1275,            // kg
  wheelbase: 2575,       // mm
  trackF: 1520, trackR: 1550,
  frontalArea: 2.04,     // m²
  cdStock: 0.366,
  drivetrain: "RWD",
  tyre: "Michelin PS4S 245/40R18",
};

/* ─── Build ─────────────────────────────────────────────────── */
export const DEMO_BUILD = {
  id: "b-gr86-track",
  name: "GR86 Time-Attack Pack",
  car: DEMO_CAR,
  objective: "Track use" as const,
  modified: "2h ago",
  starred: true,
  notes: "Targeting Tsukuba 2000. Aero balance ~43% F to suit understeer-prone setup.",
};

/* ─── Reference / environment ───────────────────────────────── */
export const DEMO_ENV = {
  speed: 200,            // km/h
  yaw: 0,
  density: 1.225,
  temperature: 20,
  iterations: 2400,
  walltime: "18 m 04 s",
  solver: "OpenFOAM 11 · k-ω SST",
  meshCells: "42.6 M",
  yPlus: "1.2 (avg)",
};

/* ─── Variants ──────────────────────────────────────────────── */
export interface DemoVariant {
  id: string;
  name: string;
  tag: VariantTag;
  pkg: string;
  summary: string;

  // Performance
  cd: number;
  drag: number;          // kgf @ 200 km/h
  dfFront: number;
  dfRear: number;
  dfTotal: number;
  ld: number;
  balance: number;       // % front
  topSpeed: number;      // km/h
  trackScore: number;    // 0–100
  stabilityScore: number;

  // Pressure / velocity probes
  cpStagnation: number;  // front bumper
  cpRoof: number;        // roof peak (suction = neg)
  cpWing: number;        // under-wing
  cpUnderfloor: number;
  vMaxRoof: number;      // m/s
  vUnderfloor: number;

  confidence: ConfLevel;
  kind: SimKind;         // estimate vs CFD

  params: {
    splitter: number;
    canards: boolean;
    skirts: boolean;
    wingChord: number;
    wingAoA: number;
    diffAngle: number;
    rideF: number;
    rideR: number;
  };
}

export const DEMO_VARIANTS: DemoVariant[] = [
  {
    id: "v-base", name: "Baseline · OEM ZN8", tag: "Baseline",
    pkg: "Stock body, no aero modifications",
    summary: "Reference run. Mild front lift, rear lift dominates above 180 km/h.",
    cd: 0.366, drag: 116, dfFront: 12, dfRear: -34, dfTotal: -22,
    ld: -0.19, balance: 100, topSpeed: 226,
    trackScore: 28, stabilityScore: 35,
    cpStagnation: 0.94, cpRoof: -1.18, cpWing: 0, cpUnderfloor: -0.22,
    vMaxRoof: 78, vUnderfloor: 64,
    confidence: "high", kind: "full",
    params: { splitter: 0, canards: false, skirts: false, wingChord: 0, wingAoA: 0, diffAngle: 0, rideF: 130, rideR: 135 },
  },
  {
    id: "v-splitter", name: "Splitter · v1", tag: "Splitter",
    pkg: "65 mm carbon splitter + air dam",
    summary: "Stagnation pressure converted to front DF. Adds mild drag, noticeably nose-heavy.",
    cd: 0.354, drag: 114, dfFront: 88, dfRear: -12, dfTotal: 76,
    ld: 0.67, balance: 115.8, topSpeed: 222,
    trackScore: 48, stabilityScore: 44,
    cpStagnation: 1.06, cpRoof: -1.16, cpWing: 0, cpUnderfloor: -0.36,
    vMaxRoof: 79, vUnderfloor: 71,
    confidence: "high", kind: "full",
    params: { splitter: 65, canards: false, skirts: false, wingChord: 0, wingAoA: 0, diffAngle: 0, rideF: 120, rideR: 130 },
  },
  {
    id: "v-wing", name: "Wing · GT 1620", tag: "Wing",
    pkg: "1620 mm GT wing, 280 mm chord, 8° AoA",
    summary: "Strong rear DF, flow attached up to 230 km/h. Front balance now too light.",
    cd: 0.358, drag: 118, dfFront: 18, dfRear: 184, dfTotal: 202,
    ld: 1.71, balance: 8.9, topSpeed: 218,
    trackScore: 62, stabilityScore: 70,
    cpStagnation: 0.96, cpRoof: -1.22, cpWing: -1.62, cpUnderfloor: -0.28,
    vMaxRoof: 81, vUnderfloor: 66,
    confidence: "high", kind: "full",
    params: { splitter: 0, canards: false, skirts: false, wingChord: 280, wingAoA: 8, diffAngle: 0, rideF: 130, rideR: 118 },
  },
  {
    id: "v-diff", name: "Diffuser · 10° tunnel", tag: "Diffuser",
    pkg: "Flat floor + 10° rear diffuser, sealed",
    summary: "Underfloor pressure drops sharply. Best L/D delta of any single mod.",
    cd: 0.348, drag: 112, dfFront: 56, dfRear: 128, dfTotal: 184,
    ld: 1.64, balance: 30.4, topSpeed: 220,
    trackScore: 64, stabilityScore: 68,
    cpStagnation: 0.94, cpRoof: -1.18, cpWing: 0, cpUnderfloor: -0.92,
    vMaxRoof: 80, vUnderfloor: 88,
    confidence: "medium", kind: "full",
    params: { splitter: 0, canards: false, skirts: true, wingChord: 0, wingAoA: 0, diffAngle: 10, rideF: 110, rideR: 122 },
  },
  {
    id: "v-opt", name: "Optimized Package · v3", tag: "Optimized",
    pkg: "Splitter + canards + GT wing + diffuser + skirts",
    summary: "Adjoint-tuned. Balanced 43/57, highest L/D, converged at 8.2e-5 in 18 min.",
    cd: 0.342, drag: 112, dfFront: 121, dfRear: 163, dfTotal: 284,
    ld: 2.54, balance: 42.6, topSpeed: 218,
    trackScore: 84, stabilityScore: 76,
    cpStagnation: 1.04, cpRoof: -1.24, cpWing: -1.58, cpUnderfloor: -0.86,
    vMaxRoof: 82, vUnderfloor: 86,
    confidence: "high", kind: "full",
    params: { splitter: 65, canards: true, skirts: true, wingChord: 280, wingAoA: 8.5, diffAngle: 10, rideF: 105, rideR: 118 },
  },
];

export const DEMO_BASELINE = DEMO_VARIANTS[0];
export const DEMO_OPTIMIZED = DEMO_VARIANTS[4];

/* ─── Simulation jobs (history) ─────────────────────────────── */
export const DEMO_JOBS: {
  id: string; variantId: string; kind: SimKind; state: JobState;
  iters: number; walltime: string; residual: string; when: string;
}[] = [
  { id: "RUN-2186", variantId: "v-opt",      kind: "full",    state: "converged", iters: 2400, walltime: "18:04", residual: "8.2e-5", when: "2h ago"   },
  { id: "RUN-2185", variantId: "v-diff",     kind: "full",    state: "converged", iters: 2200, walltime: "16:42", residual: "9.4e-5", when: "5h ago"   },
  { id: "RUN-2184", variantId: "v-wing",     kind: "full",    state: "converged", iters: 2100, walltime: "15:18", residual: "8.8e-5", when: "yesterday"},
  { id: "RUN-2183", variantId: "v-splitter", kind: "full",    state: "converged", iters: 2000, walltime: "14:22", residual: "9.1e-5", when: "yesterday"},
  { id: "RUN-2182", variantId: "v-base",     kind: "full",    state: "converged", iters: 1800, walltime: "12:48", residual: "7.6e-5", when: "2d ago"   },
  { id: "RUN-2181", variantId: "v-wing",     kind: "preview", state: "converged", iters:  240, walltime: "00:34", residual: "—",      when: "2d ago"   },
];

/* ─── Assumptions snapshot (drives confidence) ──────────────── */
export const DEMO_ASSUMPTIONS = [
  { id: "geom",   label: "Geometry source",      value: "Parametric template + scanned add-ons", impact: "neutral" as const },
  { id: "wheels", label: "Wheel rotation",       value: "Full rotating (MRF)",                   impact: "good" as const    },
  { id: "floor",  label: "Underbody model",      value: "Detailed (sealed floor + diffuser)",    impact: "good" as const    },
  { id: "state",  label: "Solver state",         value: "Steady-state RANS",                     impact: "neutral" as const },
  { id: "yaw",    label: "Yaw sweep",            value: "0° single-point",                       impact: "warn" as const    },
  { id: "mesh",   label: "Mesh independence",    value: "Verified at 42.6 M cells",              impact: "good" as const    },
  { id: "ride",   label: "Ride height",          value: "Static (no suspension travel)",         impact: "warn" as const    },
];

/* ─── Helpers ───────────────────────────────────────────────── */
export const variantById = (id: string) => DEMO_VARIANTS.find((v) => v.id === id);

export const deltaVs = (v: DemoVariant, base: DemoVariant = DEMO_BASELINE) => ({
  cd: ((v.cd - base.cd) / base.cd) * 100,
  drag: v.drag - base.drag,
  dfTotal: v.dfTotal - base.dfTotal,
  ld: v.ld - base.ld,
  balance: v.balance - base.balance,
  topSpeed: v.topSpeed - base.topSpeed,
});
