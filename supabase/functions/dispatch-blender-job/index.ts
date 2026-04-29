/**
 * dispatch-blender-job
 *
 * Admin-only entry point that records a row in `blender_jobs` and POSTs the
 * job to the external Blender worker. Mirrors `dispatch-geometry-job` but
 * targets the broader 14-operation `blender_job_type` set used in Phase 7.
 *
 * Body: {
 *   operation_type: BlenderJobType,
 *   parameters?: Record<string, unknown>,
 *   input_mesh_urls?: Record<string, string>,
 *   selected_part_ids?: string[],
 *   body_skin_id?: string | null,
 *   donor_car_template_id?: string | null,
 *   project_id?: string | null,
 * }
 *
 * Returns: { job_id, status, worker_task_id? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BLENDER_WORKER_URL = Deno.env.get("BLENDER_WORKER_URL");
const BLENDER_WORKER_TOKEN = Deno.env.get("BLENDER_WORKER_TOKEN");

const ALLOWED_OPS = new Set([
  "trim_part_to_car", "conform_edge_to_body", "thicken_shell", "add_return_lip",
  "add_mounting_tabs", "mirror_part", "split_for_print_bed", "repair_watertight",
  "decimate_mesh", "cut_wheel_arches", "cut_window_openings", "panelise_body_skin",
  "export_stl", "export_glb_preview",
  // Phase: AI-actor procedural part generation
  "generate_part",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      operation_type,
      parameters = {},
      input_mesh_urls = {},
      selected_part_ids = [],
      body_skin_id = null,
      donor_car_template_id = null,
      project_id = null,
    } = body ?? {};

    if (!operation_type || !ALLOWED_OPS.has(operation_type)) {
      return json({ error: `Unknown or missing operation_type: ${operation_type}` }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Admin-gate: this is a heavy backend operation we don't expose to engineers.
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    // 1) Insert queued row up-front so the UI can always poll, even on worker failure.
    const { data: inserted, error: insErr } = await admin
      .from("blender_jobs")
      .insert({
        user_id: userId,
        operation_type,
        parameters,
        input_mesh_urls,
        selected_part_ids,
        body_skin_id,
        donor_car_template_id,
        project_id,
        status: "queued",
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("blender_jobs insert failed:", insErr);
      return json({ error: `DB insert failed: ${insErr.message}` }, 500);
    }
    const jobId = inserted.id as string;

    if (!BLENDER_WORKER_URL || !BLENDER_WORKER_TOKEN) {
      const msg =
        "Blender worker not configured. Set BLENDER_WORKER_URL and BLENDER_WORKER_TOKEN in Lovable Cloud secrets.";
      await admin.from("blender_jobs").update({ status: "failed", error_log: msg }).eq("id", jobId);
      return json({ job_id: jobId, error: msg }, 503);
    }

    try {
      const workerResp = await fetch(`${BLENDER_WORKER_URL.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${BLENDER_WORKER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          job_type: operation_type,
          inputs: {
            ...input_mesh_urls,
            params: parameters,
            selected_part_ids,
            body_skin_id,
            donor_car_template_id,
          },
        }),
      });
      if (!workerResp.ok) {
        const t = await workerResp.text();
        const msg = `Worker ${workerResp.status}: ${t.slice(0, 300)}`;
        await admin.from("blender_jobs").update({ status: "failed", error_log: msg }).eq("id", jobId);
        return json({ job_id: jobId, error: msg }, 502);
      }
      const workerJson = await workerResp.json();
      const taskId = workerJson?.task_id as string | undefined;
      if (!taskId) {
        const msg = "Worker returned no task_id";
        await admin.from("blender_jobs").update({ status: "failed", error_log: msg }).eq("id", jobId);
        return json({ job_id: jobId, error: msg }, 502);
      }
      await admin
        .from("blender_jobs")
        .update({ status: "running", worker_task_id: taskId, started_at: new Date().toISOString() })
        .eq("id", jobId);
      return json({ job_id: jobId, worker_task_id: taskId, status: "running" });
    } catch (e) {
      const msg = `Worker call threw: ${e instanceof Error ? e.message : String(e)}`;
      await admin.from("blender_jobs").update({ status: "failed", error_log: msg }).eq("id", jobId);
      return json({ job_id: jobId, error: msg }, 502);
    }
  } catch (e) {
    console.error("dispatch-blender-job error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
