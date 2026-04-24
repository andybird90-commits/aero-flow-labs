/**
 * dispatch-cad-job
 *
 * Records a parametric CAD build request in `cad_jobs`, then forwards the
 * recipe to the external CAD worker (CadQuery reference impl). Returns the
 * inserted row id so the client can poll `cad-job-status`.
 *
 * Body:
 *   {
 *     concept_id?, project_id?, part_kind, part_label?,
 *     recipe: object,            // from generate-cad-recipe (or hand-built)
 *     inputs?: object             // optional auxiliary context (base_mesh_url etc.)
 *   }
 *
 * Returns: { job_id, worker_task_id?, status }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Engine-agnostic worker secrets. Falls back to the legacy ONSHAPE_* names
// for backward compatibility if those are still set.
const CAD_WORKER_URL =
  Deno.env.get("CAD_WORKER_URL") ?? Deno.env.get("ONSHAPE_WORKER_URL");
const CAD_WORKER_TOKEN =
  Deno.env.get("CAD_WORKER_TOKEN") ?? Deno.env.get("ONSHAPE_WORKER_TOKEN");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      concept_id = null,
      project_id = null,
      part_kind,
      part_label = null,
      recipe,
      inputs = {},
    } = body ?? {};

    if (!part_kind || !recipe || typeof recipe !== "object") {
      return json({ error: "part_kind and recipe required" }, 400);
    }
    // New builder-based recipe (version 2). The AI generates {builder, params} only —
    // no free-form CadQuery operations.
    const isBuilderRecipe =
      typeof recipe.builder === "string" &&
      recipe.params &&
      typeof recipe.params === "object";
    // Legacy free-form recipe (version 1) — still accepted for backward compat.
    const isLegacyRecipe = Array.isArray(recipe.features);
    if (!isBuilderRecipe && !isLegacyRecipe) {
      return json({
        error: "recipe must be either {builder, params} (v2) or {features:[]} (v1)",
      }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: inserted, error: insErr } = await admin
      .from("cad_jobs")
      .insert({
        user_id: userId,
        concept_id,
        project_id,
        part_kind,
        part_label,
        recipe,
        inputs,
        status: "queued",
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("cad_jobs insert failed:", insErr);
      return json({ error: `DB insert failed: ${insErr.message}` }, 500);
    }
    const jobId = inserted.id as string;

    if (!CAD_WORKER_URL || !CAD_WORKER_TOKEN) {
      const msg =
        "CAD worker not configured. Set CAD_WORKER_URL and CAD_WORKER_TOKEN in Lovable Cloud secrets.";
      await admin.from("cad_jobs").update({ status: "failed", error: msg }).eq("id", jobId);
      return json({ job_id: jobId, error: msg }, 503);
    }

    try {
      // The worker still speaks v1 (`recipe.features[]`). Wrap a v2 builder
      // call as a single `builder` feature so existing workers accept it,
      // while also forwarding the v2 fields at top-level for newer workers.
      const workerPayload = isBuilderRecipe
        ? {
            recipe: {
              part_type: recipe.part_type ?? part_kind,
              features: [
                {
                  // Legacy worker iterates features and reads `type`. Use
                  // "builder" so a builder-aware worker can dispatch, and
                  // also include `op` for the same reason.
                  type: "builder",
                  op: "builder",
                  builder: recipe.builder,
                  part_type: recipe.part_type ?? part_kind,
                  params: recipe.params,
                },
              ],
              builder: recipe.builder,
              params: recipe.params,
            },
            // v2 fields at top-level for builder-aware workers
            builder: recipe.builder,
            part_type: recipe.part_type ?? part_kind,
            params: recipe.params,
            inputs,
            part_kind,
          }
        : { recipe, inputs, part_kind }; // v1 legacy passthrough
      const workerResp = await fetch(`${CAD_WORKER_URL.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CAD_WORKER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(workerPayload),
      });
      if (!workerResp.ok) {
        const t = await workerResp.text();
        const msg = `Worker ${workerResp.status}: ${t.slice(0, 300)}`;
        await admin.from("cad_jobs").update({ status: "failed", error: msg }).eq("id", jobId);
        return json({ job_id: jobId, error: msg }, 502);
      }
      const w = await workerResp.json();
      const taskId = w?.task_id as string | undefined;
      if (!taskId) {
        const msg = "Worker returned no task_id";
        await admin.from("cad_jobs").update({ status: "failed", error: msg }).eq("id", jobId);
        return json({ job_id: jobId, error: msg }, 502);
      }
      await admin
        .from("cad_jobs")
        .update({ status: "running", worker_task_id: taskId })
        .eq("id", jobId);
      return json({ job_id: jobId, worker_task_id: taskId, status: "running" });
    } catch (e) {
      const msg = `Worker call threw: ${e instanceof Error ? e.message : String(e)}`;
      await admin.from("cad_jobs").update({ status: "failed", error: msg }).eq("id", jobId);
      return json({ job_id: jobId, error: msg }, 502);
    }
  } catch (e) {
    console.error("dispatch-cad-job error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
