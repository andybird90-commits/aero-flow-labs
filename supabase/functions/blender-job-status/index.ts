/**
 * blender-job-status
 *
 * Polls the Blender worker for a single `blender_jobs` row, re-hosts any
 * output mesh / preview into the `blender-outputs` storage bucket so URLs
 * remain stable, and updates the row.
 *
 * Body: { job_id: string }
 * Returns: { status, outputs?, error? }
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
    const { job_id } = await req.json();
    if (!job_id) return json({ error: "job_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Admin-gate: same as dispatch.
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const { data: job, error: jobErr } = await admin
      .from("blender_jobs").select("*").eq("id", job_id).maybeSingle();
    if (jobErr || !job) return json({ error: "Job not found" }, 404);

    if (job.status === "complete" || job.status === "failed") {
      return json({ status: job.status, outputs: job.output_file_urls, error: job.error_log });
    }
    if (!job.worker_task_id) return json({ status: job.status });
    if (!BLENDER_WORKER_URL || !BLENDER_WORKER_TOKEN) {
      return json({ status: job.status, error: "Worker not configured" }, 503);
    }

    const pollResp = await fetch(
      `${BLENDER_WORKER_URL.replace(/\/$/, "")}/jobs/${job.worker_task_id}`,
      { headers: { Authorization: `Bearer ${BLENDER_WORKER_TOKEN}` } },
    );
    if (!pollResp.ok) {
      const t = await pollResp.text();
      return json({ status: job.status, error: `Worker ${pollResp.status}: ${t.slice(0, 200)}` }, 502);
    }
    const w = await pollResp.json();
    const wStatus: string = w?.status ?? "running";

    if (wStatus === "running" || wStatus === "queued" || wStatus === "starting") {
      return json({ status: "running", progress: w?.progress ?? 0 });
    }

    if (wStatus === "failed" || wStatus === "canceled" || wStatus === "error") {
      const errMsg = (w?.error ?? `Worker reported ${wStatus}`) as string;
      await admin
        .from("blender_jobs")
        .update({ status: "failed", error_log: String(errMsg).slice(0, 1000), completed_at: new Date().toISOString() })
        .eq("id", job_id);
      return json({ status: "failed", error: errMsg });
    }

    if (wStatus === "succeeded" || wStatus === "completed" || wStatus === "done" || wStatus === "complete") {
      const out = (w?.outputs ?? {}) as Record<string, string | undefined>;

      // Block localhost URLs — edge runtime can't reach them and we'd silently
      // store dead links.
      const unreachable = Object.entries(out)
        .filter(([, url]) => !!url && /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/)/i.test(url!))
        .map(([k]) => k);
      if (unreachable.length > 0) {
        const msg =
          `Worker returned non-public URL(s) for: ${unreachable.join(", ")}. ` +
          `Outputs must be publicly fetchable from the Lovable Cloud edge runtime.`;
        await admin
          .from("blender_jobs")
          .update({ status: "failed", error_log: msg.slice(0, 1000), completed_at: new Date().toISOString() })
          .eq("id", job_id);
        return json({ status: "failed", error: msg });
      }

      const rehosted: Record<string, string> = {};
      let preview: string | null = null;
      const folder = `${userId}/${job.project_id ?? "_no_project"}/blender-jobs/${job_id}`;
      for (const [key, url] of Object.entries(out)) {
        if (!url) continue;
        try {
          const fetched = await fetch(url);
          if (!fetched.ok) {
            console.warn(`re-host fetch failed for ${key}:`, fetched.status);
            rehosted[key] = url;
            continue;
          }
          const bytes = new Uint8Array(await fetched.arrayBuffer());
          const ext = key.includes("stl") ? "stl"
            : key.includes("glb") ? "glb"
            : key.includes("png") ? "png"
            : key.includes("jpg") || key.includes("jpeg") ? "jpg"
            : "bin";
          const mime = ext === "stl" ? "model/stl"
            : ext === "glb" ? "model/gltf-binary"
            : ext === "png" ? "image/png"
            : ext === "jpg" ? "image/jpeg"
            : "application/octet-stream";
          const path = `${folder}/${key}.${ext}`;
          const { error: upErr } = await admin.storage
            .from("blender-outputs")
            .upload(path, bytes, { contentType: mime, upsert: true });
          if (upErr) {
            console.warn(`re-host upload failed for ${key}:`, upErr.message);
            rehosted[key] = url;
            continue;
          }
          const { data: signed } = await admin.storage
            .from("blender-outputs")
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          rehosted[key] = signed?.signedUrl ?? url;
          if (!preview && (ext === "png" || ext === "jpg")) preview = rehosted[key];
        } catch (e) {
          console.warn(`re-host threw for ${key}:`, e);
          rehosted[key] = url;
        }
      }

      await admin
        .from("blender_jobs")
        .update({
          status: "complete",
          output_file_urls: rehosted,
          preview_file_url: preview,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job_id);
      return json({ status: "complete", outputs: rehosted });
    }

    return json({ status: "running", progress: w?.progress ?? 0, raw_status: wStatus });
  } catch (e) {
    console.error("blender-job-status error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
