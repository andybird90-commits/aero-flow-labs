/**
 * dispatch-geometry-job
 *
 * Dispatches a body-conforming part fitting job to the external Blender
 * worker. Records the request in `geometry_jobs` so the client can poll
 * status, then POSTs to the worker URL stored in `BLENDER_WORKER_URL`.
 *
 * Body:
 *   {
 *     concept_id?: string,
 *     project_id?: string,
 *     part_kind: string,            // body-conforming kind
 *     mount_zone: string,
 *     side: "left" | "right" | "center",
 *     job_type: "prepare_base_mesh" | "fit_part_to_zone" | "mirror_part" | "export_stl",
 *     inputs: { base_mesh_url?, part_template_url?, zone?, params? }
 *   }
 *
 * Returns: { job_id }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      concept_id = null,
      project_id = null,
      part_kind,
      mount_zone,
      side = "center",
      job_type,
      inputs = {},
    } = body ?? {};

    if (!part_kind || !mount_zone || !job_type) {
      return json({ error: "part_kind, mount_zone and job_type are required" }, 400);
    }
    const allowedJobs = ["prepare_base_mesh", "fit_part_to_zone", "mirror_part", "export_stl"];
    if (!allowedJobs.includes(job_type)) {
      return json({ error: `Unknown job_type: ${job_type}` }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Insert the job row up-front so the client can poll even if the worker
    //    POST below fails or the worker isn't configured yet.
    const { data: inserted, error: insErr } = await admin
      .from("geometry_jobs")
      .insert({
        user_id: userId,
        concept_id,
        project_id,
        part_kind,
        mount_zone,
        side,
        job_type,
        status: "queued",
        inputs,
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("geometry_jobs insert failed:", insErr);
      return json({ error: `DB insert failed: ${insErr.message}` }, 500);
    }
    const jobId = inserted.id as string;

    // 2) If worker isn't configured, leave the row queued with a clear error
    //    so the user knows what to do next.
    if (!BLENDER_WORKER_URL || !BLENDER_WORKER_TOKEN) {
      const msg =
        "Blender worker not configured. Set BLENDER_WORKER_URL and BLENDER_WORKER_TOKEN in Lovable Cloud secrets.";
      await admin
        .from("geometry_jobs")
        .update({ status: "failed", error: msg })
        .eq("id", jobId);
      return json({ job_id: jobId, error: msg }, 503);
    }

    // 3) Fire the worker. We don't await full completion — just the task_id.
    try {
      const workerResp = await fetch(`${BLENDER_WORKER_URL.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${BLENDER_WORKER_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_type, inputs }),
      });
      if (!workerResp.ok) {
        const t = await workerResp.text();
        const msg = `Worker ${workerResp.status}: ${t.slice(0, 300)}`;
        await admin
          .from("geometry_jobs")
          .update({ status: "failed", error: msg })
          .eq("id", jobId);
        return json({ job_id: jobId, error: msg }, 502);
      }
      const workerJson = await workerResp.json();
      const taskId = workerJson?.task_id as string | undefined;
      if (!taskId) {
        const msg = "Worker returned no task_id";
        await admin.from("geometry_jobs").update({ status: "failed", error: msg }).eq("id", jobId);
        return json({ job_id: jobId, error: msg }, 502);
      }
      await admin
        .from("geometry_jobs")
        .update({ status: "running", worker_task_id: taskId })
        .eq("id", jobId);
      return json({ job_id: jobId, worker_task_id: taskId, status: "running" });
    } catch (e) {
      const msg = `Worker call threw: ${e instanceof Error ? e.message : String(e)}`;
      await admin.from("geometry_jobs").update({ status: "failed", error: msg }).eq("id", jobId);
      return json({ job_id: jobId, error: msg }, 502);
    }
  } catch (e) {
    console.error("dispatch-geometry-job error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
