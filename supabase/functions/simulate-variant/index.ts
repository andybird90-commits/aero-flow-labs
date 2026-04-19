// Edge function: simulate-variant
// Real-feel CFD solver simulation for an aero variant.
// - Validates ownership
// - Charges credits atomically
// - Progresses job state: queued → preprocessing → simulating → postprocessing → completed
// - Computes physically plausible deltas based on attached aero_components and geometry
// - Writes a simulation_results row when done
//
// Modes:
//   kind=preview → ~10 s wall, low confidence (surrogate)
//   kind=full    → ~45 s wall, high confidence (CFD-style)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Kind = "preview" | "full";

const COSTS: Record<Kind, number> = { preview: 1, full: 8 };

// Step plan in seconds — sums roughly to total walltime.
const PLAN: Record<Kind, { state: string; secs: number; iters: number }[]> = {
  preview: [
    { state: "preprocessing",  secs: 2,  iters: 0    },
    { state: "simulating",     secs: 6,  iters: 240  },
    { state: "postprocessing", secs: 2,  iters: 0    },
  ],
  full: [
    { state: "preprocessing",  secs: 6,  iters: 0    },
    { state: "simulating",     secs: 32, iters: 2400 },
    { state: "postprocessing", secs: 7,  iters: 0    },
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return j({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: uErr } = await supabase.auth.getUser();
    if (uErr || !user) return j({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const variant_id: string = body.variant_id;
    const kind: Kind = body.kind === "preview" ? "preview" : "full";
    const speed_kmh: number = Number(body.speed_kmh ?? 200);
    const yaw_deg: number = Number(body.yaw_deg ?? 0);
    const air_density: number = Number(body.air_density ?? 1.225);

    if (!variant_id) return j({ error: "variant_id required" }, 400);

    // Verify ownership and load variant + build + geometry + components
    const { data: variant } = await supabase.from("variants")
      .select("*, build:builds(*), geometry:geometries(*)")
      .eq("id", variant_id).maybeSingle();
    if (!variant || variant.user_id !== user.id) return j({ error: "Not found" }, 404);

    const { data: components } = await supabase.from("aero_components")
      .select("*").eq("variant_id", variant_id).eq("enabled", true);

    // Charge credits atomically
    const { error: credErr } = await admin.rpc("decrement_credits", {
      _user_id: user.id, _amount: COSTS[kind],
    });
    if (credErr) return j({ error: "Insufficient credits" }, 402);

    // Build assumptions snapshot
    const geom = variant.geometry as any;
    const assumptions = [
      { id: "geom",   label: "Geometry source",      value: geom?.source ?? "template" },
      { id: "wheels", label: "Wheel rotation",       value: geom?.wheel_rotation ?? "static" },
      { id: "floor",  label: "Underbody model",      value: geom?.underbody_model ?? "simplified" },
      { id: "state",  label: "Solver state",         value: geom?.steady_state ? "Steady-state RANS" : "Transient URANS" },
      { id: "ride",   label: "Ride height",          value: `F ${geom?.ride_height_front_mm ?? "?"} · R ${geom?.ride_height_rear_mm ?? "?"} mm` },
      { id: "speed",  label: "Inlet velocity",       value: `${speed_kmh} km/h` },
      { id: "rho",    label: "Air density",          value: `${air_density} kg/m³` },
    ];

    const totalIters = PLAN[kind].reduce((s, p) => s + p.iters, 0);

    // Create job (queued)
    const { data: job, error: jobErr } = await admin.from("simulation_jobs").insert({
      user_id: user.id, variant_id, kind, state: "queued",
      speed_kmh, yaw_deg, air_density,
      iterations_target: totalIters, iterations_done: 0,
      credits_charged: COSTS[kind],
      assumptions_snapshot: assumptions,
      started_at: new Date().toISOString(),
    }).select("*").single();
    if (jobErr) throw jobErr;

    // Mark variant as simulating
    await admin.from("variants").update({ status: "simulating" }).eq("id", variant_id);

    // Run async (don't block response)
    (async () => {
      try {
        let itersDone = 0;
        for (const step of PLAN[kind]) {
          await admin.from("simulation_jobs").update({
            state: step.state, iterations_done: itersDone,
          }).eq("id", job.id);

          // Stream progress updates within the simulating step
          if (step.iters > 0) {
            const ticks = 8;
            const perTick = step.iters / ticks;
            const tickMs = (step.secs * 1000) / ticks;
            for (let i = 0; i < ticks; i++) {
              await sleep(tickMs);
              itersDone += perTick;
              await admin.from("simulation_jobs").update({
                iterations_done: Math.round(itersDone),
                residual: (Math.exp(-i * 0.6) * 1.2e-3).toExponential(1),
              }).eq("id", job.id);
            }
          } else {
            await sleep(step.secs * 1000);
          }
        }

        // Compute results from components + geometry + speed
        const result = computeResult(components ?? [], geom, speed_kmh, kind);

        await admin.from("simulation_results").insert({
          user_id: user.id, job_id: job.id, variant_id, kind,
          ...result,
        });

        await admin.from("simulation_jobs").update({
          state: "completed",
          iterations_done: totalIters,
          residual: result.residual,
          walltime_s: PLAN[kind].reduce((s, p) => s + p.secs, 0),
          completed_at: new Date().toISOString(),
        }).eq("id", job.id);

        await admin.from("variants").update({ status: "completed" }).eq("id", variant_id);
      } catch (e) {
        console.error("Simulation failed:", e);
        await admin.from("simulation_jobs").update({
          state: "failed",
          error_message: (e as Error).message,
          completed_at: new Date().toISOString(),
        }).eq("id", job.id);
        await admin.from("variants").update({ status: "failed" }).eq("id", variant_id);
      }
    })();

    return j({ job_id: job.id, status: "started" });
  } catch (err) {
    console.error("simulate-variant error:", err);
    return j({ error: (err as Error).message }, 500);
  }
});

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Physically-plausible aero calculation.
// Models a 1275 kg coupe; deltas are summed from enabled components, modulated
// by geometry quality (underbody / wheel rotation) and speed^2.
function computeResult(components: any[], geom: any, speed_kmh: number, kind: Kind) {
  // Baseline (OEM ZN8 stock)
  let cd = 0.366;
  let dfFront = 12;
  let dfRear = -34;
  let drag = 116;

  // Speed scaling factor (everything reported at requested speed; baseline at 200 km/h)
  const sp = speed_kmh / 200;
  const q = sp * sp;

  // Geometry penalties
  const ub = geom?.underbody_model ?? "simplified";
  const wheels = geom?.wheel_rotation ?? "static";
  const ubFactor = ub === "detailed" ? 1.0 : ub === "simplified" ? 0.92 : 0.85;
  const wheelDragBoost = wheels === "static" ? 1.04 : wheels === "translating" ? 1.02 : 1.0;
  const rideF = geom?.ride_height_front_mm ?? 130;
  const rideLowering = (130 - rideF) * 0.6; // each mm lower = +0.6 kgf nose load

  // Component effects (kgf at 200 km/h baseline, then scaled by q)
  for (const c of components) {
    const p = c.params ?? {};
    switch (c.kind) {
      case "splitter": {
        const protrusion = Number(p.protrusion_mm ?? 60);
        const k = protrusion / 65; // 65mm = nominal
        dfFront += 76 * k;
        drag += 4 * k;
        cd += 0.004 * k;
        break;
      }
      case "canard": {
        const angle = Number(p.angle_deg ?? 10);
        const count = Number(p.count ?? 2);
        const k = (angle / 10) * (count / 2);
        dfFront += 18 * k;
        drag += 1.5 * k;
        cd += 0.002 * k;
        break;
      }
      case "wing": {
        const aoa = Number(p.aoa_deg ?? 8);
        const span = Number(p.span_mm ?? 1620);
        const chord = Number(p.chord_mm ?? 280);
        const stallPenalty = aoa > 12 ? Math.pow((aoa - 12) / 3, 2) : 0;
        const eff = Math.max(0, 1 - stallPenalty * 0.4);
        const k = (aoa / 8) * (span / 1620) * (chord / 280) * eff;
        dfRear += 196 * k;
        drag += 12 * k + stallPenalty * 6;
        cd += 0.012 * k + stallPenalty * 0.008;
        break;
      }
      case "diffuser": {
        const angle = Number(p.angle_deg ?? 10);
        const sealed = p.sealed !== false;
        const stallPenalty = angle > 13 ? Math.pow((angle - 13) / 2, 2) : 0;
        const eff = Math.max(0, 1 - stallPenalty * 0.5) * (sealed ? 1 : 0.65) * ubFactor;
        const k = (angle / 10) * eff;
        dfFront += 44 * k;
        dfRear += 118 * k;
        drag += -2 * k + stallPenalty * 4;
        cd += -0.004 * k + stallPenalty * 0.006;
        break;
      }
      case "skirt": {
        const k = Number(p.length_mm ?? 1200) / 1200;
        dfRear += 12 * k;
        drag += -1 * k;
        cd += -0.001 * k;
        break;
      }
      case "ducktail": {
        const h = Number(p.height_mm ?? 40);
        const k = h / 40;
        dfRear += 22 * k;
        drag += 1 * k;
        cd += 0.0015 * k;
        break;
      }
      case "underbody": {
        dfFront += 12;
        dfRear += 22;
        drag += -3;
        cd += -0.005;
        break;
      }
      case "louvers": {
        drag += -1.5;
        cd += -0.001;
        break;
      }
    }
  }

  dfFront += rideLowering;
  drag *= wheelDragBoost;
  cd *= wheelDragBoost;

  // Apply speed scaling
  drag *= q;
  dfFront *= q;
  dfRear *= q;

  // Add gentle preview noise to mark surrogate as less precise
  if (kind === "preview") {
    const noise = (k: number) => k * (1 + (Math.random() - 0.5) * 0.08);
    drag = noise(drag); dfFront = noise(dfFront); dfRear = noise(dfRear);
    cd = noise(cd);
  }

  const dfTotal = dfFront + dfRear;
  const ld = drag === 0 ? 0 : dfTotal / drag;
  const balanceFront = dfTotal === 0 ? 50 : (dfFront / dfTotal) * 100;

  // Top speed estimate (km/h): inverse of Cd, anchored at baseline 226
  const topSpeed = Math.round(226 * Math.pow(0.366 / Math.max(0.25, cd), 1 / 3));

  // Scores
  const trackScore = clamp(28 + dfTotal * 0.18 - Math.max(0, drag - 110) * 0.6, 0, 100);
  const stabScore = clamp(35 + Math.min(dfRear, 200) * 0.18 + (balanceFront < 50 ? 10 : 0), 0, 100);

  // Confidence
  const reasons: string[] = [];
  let confidence: "low" | "medium" | "high" = "high";
  if (kind === "preview") { confidence = "low"; reasons.push("Surrogate ROM — directional only"); }
  if (ub === "simplified") { confidence = downgrade(confidence); reasons.push("Simplified underbody"); }
  if (wheels === "static") { confidence = downgrade(confidence); reasons.push("Static wheels (no rotation)"); }
  if (ub === "detailed" && wheels === "mrf" && kind === "full") {
    reasons.push("Detailed underbody · MRF wheels · mesh-independent");
  }

  return {
    cd: round(cd, 4),
    drag_kgf: round(drag, 1),
    df_front_kgf: round(dfFront, 1),
    df_rear_kgf: round(dfRear, 1),
    df_total_kgf: round(dfTotal, 1),
    ld_ratio: round(ld, 3),
    balance_front_pct: round(balanceFront, 2),
    top_speed_kmh: topSpeed,
    track_score: round(trackScore, 1),
    stability_score: round(stabScore, 1),
    cp_stagnation: round(0.94 + (rideLowering > 0 ? 0.1 : 0), 3),
    cp_roof: round(-1.18 - (cd > 0.36 ? 0 : 0.06), 3),
    cp_wing: round(components.some((c) => c.kind === "wing") ? -1.58 : 0, 3),
    cp_underfloor: round(-0.22 - (components.filter((c) => ["diffuser", "skirt", "underbody"].includes(c.kind)).length) * 0.18, 3),
    v_max_roof: round(78 * sp, 1),
    v_underfloor: round((64 + (components.filter((c) => ["diffuser", "skirt"].includes(c.kind)).length) * 12) * sp, 1),
    confidence,
    confidence_reasons: reasons,
    residual: kind === "full" ? "8.2e-5" : "1.4e-3",
  };
}

function downgrade(c: "low" | "medium" | "high"): "low" | "medium" | "high" {
  if (c === "high") return "medium";
  if (c === "medium") return "low";
  return "low";
}
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function round(v: number, dp: number) { const p = Math.pow(10, dp); return Math.round(v * p) / p; }
