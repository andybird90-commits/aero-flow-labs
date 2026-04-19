// Edge function: seed-demo-build
// Idempotently creates a complete demo workspace for the authenticated user:
// - GR86 car instance
// - "GR86 Time-Attack Pack" build (objective: track_use)
// - Geometry record (detailed underbody, MRF wheels)
// - 5 variants (Baseline, Splitter, Wing, Diffuser, Optimized)
// - 1 completed simulation job + result per variant
//
// Safe to call multiple times — checks if a build with the demo name already exists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEMO_BUILD_NAME = "GR86 Time-Attack Pack";

const VARIANTS = [
  {
    name: "Baseline · OEM ZN8", tag: "Baseline", is_baseline: true,
    components: [],
    result: {
      cd: 0.366, drag_kgf: 116, df_front_kgf: 12, df_rear_kgf: -34, df_total_kgf: -22,
      ld_ratio: -0.19, balance_front_pct: 100, top_speed_kmh: 226,
      track_score: 28, stability_score: 35,
      cp_stagnation: 0.94, cp_roof: -1.18, cp_wing: 0, cp_underfloor: -0.22,
      v_max_roof: 78, v_underfloor: 64, confidence: "high",
    },
  },
  {
    name: "Splitter · v1", tag: "Splitter", is_baseline: false,
    components: [{ kind: "splitter", params: { protrusion_mm: 65, material: "carbon" } }],
    result: {
      cd: 0.354, drag_kgf: 114, df_front_kgf: 88, df_rear_kgf: -12, df_total_kgf: 76,
      ld_ratio: 0.67, balance_front_pct: 115.8, top_speed_kmh: 222,
      track_score: 48, stability_score: 44,
      cp_stagnation: 1.06, cp_roof: -1.16, cp_wing: 0, cp_underfloor: -0.36,
      v_max_roof: 79, v_underfloor: 71, confidence: "high",
    },
  },
  {
    name: "Wing · GT 1620", tag: "Wing", is_baseline: false,
    components: [{ kind: "wing", params: { chord_mm: 280, span_mm: 1620, aoa_deg: 8 } }],
    result: {
      cd: 0.358, drag_kgf: 118, df_front_kgf: 18, df_rear_kgf: 184, df_total_kgf: 202,
      ld_ratio: 1.71, balance_front_pct: 8.9, top_speed_kmh: 218,
      track_score: 62, stability_score: 70,
      cp_stagnation: 0.96, cp_roof: -1.22, cp_wing: -1.62, cp_underfloor: -0.28,
      v_max_roof: 81, v_underfloor: 66, confidence: "high",
    },
  },
  {
    name: "Diffuser · 10° tunnel", tag: "Diffuser", is_baseline: false,
    components: [
      { kind: "diffuser", params: { angle_deg: 10, sealed: true } },
      { kind: "skirt",    params: { length_mm: 1200 } },
    ],
    result: {
      cd: 0.348, drag_kgf: 112, df_front_kgf: 56, df_rear_kgf: 128, df_total_kgf: 184,
      ld_ratio: 1.64, balance_front_pct: 30.4, top_speed_kmh: 220,
      track_score: 64, stability_score: 68,
      cp_stagnation: 0.94, cp_roof: -1.18, cp_wing: 0, cp_underfloor: -0.92,
      v_max_roof: 80, v_underfloor: 88, confidence: "medium",
    },
  },
  {
    name: "Optimized Package · v3", tag: "Optimized", is_baseline: false,
    components: [
      { kind: "splitter", params: { protrusion_mm: 65 } },
      { kind: "canard",   params: { angle_deg: 10, count: 2 } },
      { kind: "wing",     params: { chord_mm: 280, span_mm: 1620, aoa_deg: 8.5 } },
      { kind: "diffuser", params: { angle_deg: 10, sealed: true } },
      { kind: "skirt",    params: { length_mm: 1200 } },
    ],
    result: {
      cd: 0.342, drag_kgf: 112, df_front_kgf: 121, df_rear_kgf: 163, df_total_kgf: 284,
      ld_ratio: 2.54, balance_front_pct: 42.6, top_speed_kmh: 218,
      track_score: 84, stability_score: 76,
      cp_stagnation: 1.04, cp_roof: -1.24, cp_wing: -1.58, cp_underfloor: -0.86,
      v_max_roof: 82, v_underfloor: 86, confidence: "high",
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return jsonRes({ error: "Unauthorized" }, 401);

    // Idempotency: skip if demo build already exists
    const { data: existing } = await supabase.from("builds")
      .select("id").eq("user_id", user.id).eq("name", DEMO_BUILD_NAME).maybeSingle();
    if (existing) {
      return jsonRes({ build_id: existing.id, status: "exists" });
    }

    // 1) Find the GR86 template
    const { data: tpl, error: tplErr } = await supabase.from("car_templates")
      .select("*").eq("slug", "gr86-zn8").maybeSingle();
    if (tplErr || !tpl) return jsonRes({ error: "GR86 template not found" }, 500);

    // 2) Create car
    const { data: car, error: carErr } = await supabase.from("cars").insert({
      user_id: user.id, template_id: tpl.id, name: "Toyota GR86", nickname: "Demo car",
    }).select("*").single();
    if (carErr) throw carErr;

    // 3) Create build
    const { data: build, error: buildErr } = await supabase.from("builds").insert({
      user_id: user.id, car_id: car.id, name: DEMO_BUILD_NAME,
      objective: "track_use", status: "ready", starred: true,
      notes: "Targeting Tsukuba 2000. Aero balance ~43% F to suit understeer-prone setup.",
    }).select("*").single();
    if (buildErr) throw buildErr;

    // 4) Geometry
    const { data: geo, error: geoErr } = await supabase.from("geometries").insert({
      user_id: user.id, build_id: build.id, source: "parametric",
      ride_height_front_mm: 105, ride_height_rear_mm: 118,
      underbody_model: "detailed", wheel_rotation: "mrf", steady_state: true,
    }).select("*").single();
    if (geoErr) throw geoErr;

    // 5) Variants + components + jobs + results
    const assumptions = [
      { id: "geom",   label: "Geometry source", value: "Parametric template + scanned add-ons" },
      { id: "wheels", label: "Wheel rotation",  value: "Full rotating (MRF)" },
      { id: "floor",  label: "Underbody model", value: "Detailed (sealed floor + diffuser)" },
      { id: "state",  label: "Solver state",    value: "Steady-state RANS" },
    ];

    for (const v of VARIANTS) {
      const { data: variant, error: vErr } = await supabase.from("variants").insert({
        user_id: user.id, build_id: build.id, geometry_id: geo.id,
        name: v.name, tag: v.tag, status: "completed", is_baseline: v.is_baseline,
      }).select("*").single();
      if (vErr) throw vErr;

      for (const comp of v.components) {
        await supabase.from("aero_components").insert({
          user_id: user.id, variant_id: variant.id,
          kind: comp.kind, enabled: true, params: comp.params,
        });
      }

      const { data: job, error: jobErr } = await supabase.from("simulation_jobs").insert({
        user_id: user.id, variant_id: variant.id, kind: "full", state: "completed",
        speed_kmh: 200, yaw_deg: 0, air_density: 1.225,
        iterations_target: 2400, iterations_done: 2400, residual: "8.2e-5",
        walltime_s: 1084, solver: "OpenFOAM 11 · k-omega SST",
        credits_charged: 8, started_at: new Date(Date.now() - 1.1e6).toISOString(),
        completed_at: new Date(Date.now() - 7.2e5).toISOString(),
        assumptions_snapshot: assumptions,
      }).select("*").single();
      if (jobErr) throw jobErr;

      const { error: resErr } = await supabase.from("simulation_results").insert({
        user_id: user.id, job_id: job.id, variant_id: variant.id, kind: "full",
        ...v.result,
        confidence_reasons: v.result.confidence === "high"
          ? ["Detailed underbody", "MRF rotating wheels", "Mesh-independent"]
          : ["Diffuser flow separation suspected near 10°"],
      });
      if (resErr) throw resErr;
    }

    return jsonRes({ build_id: build.id, status: "created" });
  } catch (err) {
    console.error("seed-demo-build failed:", err);
    return jsonRes({ error: (err as Error).message }, 500);
  }
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
