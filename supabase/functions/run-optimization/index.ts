// Edge function: run-optimization
// Generates candidate aero combinations, scores them against the chosen objective,
// progresses an optimization_job through states, and writes ranked candidates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COST = 24;
const TOTAL_CANDIDATES = 16;

// Objective weights {df, drag, balance, stability}
const OBJECTIVE_WEIGHTS: Record<string, { df: number; drag: number; balance: number; stability: number; balanceTarget: number }> = {
  top_speed:            { df: 5,  drag: 75, balance: 10, stability: 10, balanceTarget: 45 },
  track_use:            { df: 60, drag: 15, balance: 15, stability: 10, balanceTarget: 43 },
  balance:              { df: 30, drag: 30, balance: 25, stability: 15, balanceTarget: 50 },
  high_speed_stability: { df: 35, drag: 25, balance: 10, stability: 30, balanceTarget: 40 },
  rear_grip:            { df: 45, drag: 15, balance: 30, stability: 10, balanceTarget: 36 },
  custom:               { df: 30, drag: 30, balance: 20, stability: 20, balanceTarget: 50 },
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
    const build_id: string = body.build_id;
    const objective: string = body.objective ?? "track_use";
    const allowed_components: string[] = body.allowed_components ?? ["splitter", "canard", "wing", "diffuser", "skirt", "underbody"];
    const constraints = body.constraints ?? {};

    if (!build_id) return j({ error: "build_id required" }, 400);

    const { data: build } = await supabase.from("builds").select("*, geometry:geometries(*)").eq("id", build_id).maybeSingle();
    if (!build || build.user_id !== user.id) return j({ error: "Build not found" }, 404);

    // Charge credits
    const { error: credErr } = await admin.rpc("decrement_credits", {
      _user_id: user.id, _amount: COST,
    });
    if (credErr) return j({ error: "Insufficient credits" }, 402);

    const { data: job, error: jobErr } = await admin.from("optimization_jobs").insert({
      user_id: user.id, build_id, objective,
      allowed_components, constraints,
      objective_weights: OBJECTIVE_WEIGHTS[objective] ?? OBJECTIVE_WEIGHTS.custom,
      candidates_total: TOTAL_CANDIDATES, candidates_evaluated: 0,
      state: "queued", credits_charged: COST,
      started_at: new Date().toISOString(),
    }).select("*").single();
    if (jobErr) throw jobErr;

    (async () => {
      try {
        await admin.from("optimization_jobs").update({ state: "preprocessing" }).eq("id", job.id);
        await sleep(3000);
        await admin.from("optimization_jobs").update({ state: "simulating" }).eq("id", job.id);

        const candidates: any[] = [];
        for (let i = 0; i < TOTAL_CANDIDATES; i++) {
          await sleep(1800);
          const cand = generateCandidate(i, allowed_components, objective, constraints);
          candidates.push(cand);
          await admin.from("optimization_jobs").update({
            candidates_evaluated: i + 1,
            ranked_candidates: rank(candidates, objective).slice(0, 5),
          }).eq("id", job.id);
        }

        await admin.from("optimization_jobs").update({ state: "postprocessing" }).eq("id", job.id);
        await sleep(2500);

        const ranked = rank(candidates, objective);
        const best = ranked[0];
        const reasoning = buildReasoning(best, objective);

        await admin.from("optimization_jobs").update({
          state: "completed",
          ranked_candidates: ranked,
          best_candidate: best,
          reasoning,
          confidence: "high",
          walltime_s: Math.round((Date.now() - new Date(job.started_at!).getTime()) / 1000),
          completed_at: new Date().toISOString(),
        }).eq("id", job.id);
      } catch (e) {
        console.error("Optimization failed:", e);
        await admin.from("optimization_jobs").update({
          state: "failed",
          completed_at: new Date().toISOString(),
        }).eq("id", job.id);
      }
    })();

    return j({ job_id: job.id, status: "started" });
  } catch (err) {
    console.error("run-optimization error:", err);
    return j({ error: (err as Error).message }, 500);
  }
});

function generateCandidate(idx: number, allowed: string[], objective: string, constraints: any) {
  const parts: any[] = [];
  let cd = 0.366, dfF = 12, dfR = -34, drag = 116;

  // Bias picks based on objective
  const wantHighDF = ["track_use", "rear_grip"].includes(objective);
  const wantLowDrag = ["top_speed", "high_speed_stability"].includes(objective);

  if (allowed.includes("splitter") && Math.random() < 0.95) {
    const p = 50 + Math.round(Math.random() * 30);
    parts.push({ kind: "splitter", params: { protrusion_mm: p } });
    dfF += 76 * (p / 65); drag += 4 * (p / 65); cd += 0.004 * (p / 65);
  }
  if (allowed.includes("canard") && (wantHighDF ? Math.random() < 0.85 : Math.random() < 0.4)) {
    const a = 8 + Math.round(Math.random() * 6);
    parts.push({ kind: "canard", params: { angle_deg: a, count: 2 } });
    dfF += 18 * (a / 10); drag += 1.5 * (a / 10);
  }
  if (allowed.includes("wing") && (wantLowDrag ? Math.random() < 0.5 : Math.random() < 0.95)) {
    const aoa = wantLowDrag ? 4 + Math.random() * 3 : 7 + Math.random() * 4;
    const k = aoa / 8;
    parts.push({ kind: "wing", params: { aoa_deg: round(aoa, 1), span_mm: 1620, chord_mm: 280 } });
    dfR += 196 * k; drag += 12 * k; cd += 0.012 * k;
  }
  if (allowed.includes("diffuser") && Math.random() < 0.9) {
    const angle = 8 + Math.round(Math.random() * 4);
    parts.push({ kind: "diffuser", params: { angle_deg: angle, sealed: true } });
    dfF += 44 * (angle / 10); dfR += 118 * (angle / 10); drag -= 2 * (angle / 10); cd -= 0.004 * (angle / 10);
  }
  if (allowed.includes("skirt") && Math.random() < 0.7) {
    parts.push({ kind: "skirt", params: { length_mm: 1200 } });
    dfR += 12; drag -= 1;
  }
  if (allowed.includes("underbody") && Math.random() < 0.85) {
    parts.push({ kind: "underbody", params: {} });
    dfF += 12; dfR += 22; drag -= 3; cd -= 0.005;
  }

  const dfTotal = dfF + dfR;
  const ld = drag === 0 ? 0 : dfTotal / drag;
  const balance = dfTotal === 0 ? 50 : (dfF / dfTotal) * 100;
  const topSpeed = Math.round(226 * Math.pow(0.366 / Math.max(0.25, cd), 1 / 3));

  return {
    id: `C-${(idx + 1).toString().padStart(2, "0")}`,
    cd: round(cd, 3),
    drag_kgf: round(drag, 1),
    df_front_kgf: round(dfF, 1),
    df_rear_kgf: round(dfR, 1),
    df_total_kgf: round(dfTotal, 1),
    ld_ratio: round(ld, 2),
    balance_front_pct: round(balance, 1),
    top_speed_kmh: topSpeed,
    parts,
    manufacturability: 60 + Math.round(Math.random() * 35),
  };
}

function rank(cands: any[], objective: string) {
  const w = OBJECTIVE_WEIGHTS[objective] ?? OBJECTIVE_WEIGHTS.custom;
  const scored = cands.map((c) => {
    // Normalize each metric to [0, 1] and weight
    const dfScore = Math.min(1, Math.max(0, c.df_total_kgf / 320));
    const dragScore = Math.min(1, Math.max(0, 1 - (c.drag_kgf - 105) / 30));
    const balanceScore = 1 - Math.min(1, Math.abs(c.balance_front_pct - w.balanceTarget) / 20);
    const stabScore = Math.min(1, Math.max(0, c.df_rear_kgf / 220));
    const total = (dfScore * w.df + dragScore * w.drag + balanceScore * w.balance + stabScore * w.stability) / 100;
    return { ...c, score: round(total * 100, 1), confidence: c.manufacturability > 70 ? "high" : "medium" };
  });
  return scored.sort((a, b) => b.score - a.score).map((c, i) => ({ ...c, rank: i + 1 }));
}

function buildReasoning(best: any, objective: string) {
  const parts = best.parts.map((p: any) => p.kind).join(" + ");
  return `Best candidate combines ${parts}. ` +
    `Achieves L/D ${best.ld_ratio} at ${best.balance_front_pct}% front balance ` +
    `(target for ${objective}: ${OBJECTIVE_WEIGHTS[objective]?.balanceTarget ?? 50}%). ` +
    `Total downforce ${best.df_total_kgf} kgf at ${best.drag_kgf} kgf drag. ` +
    `Manufacturability score ${best.manufacturability}/100.`;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function round(v: number, dp: number) { const p = Math.pow(10, dp); return Math.round(v * p) / p; }
function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
