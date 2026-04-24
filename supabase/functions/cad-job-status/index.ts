/**
 * cad-job-status
 *
 * Polls the external Onshape worker for a CAD job. On `succeeded`, downloads
 * the STEP / STL / GLB / preview artifacts and re-hosts them in the
 * `geometries` bucket so the client always reads from a stable Lovable URL.
 *
 * Body: { job_id: string }
 * Returns: { status, progress?, outputs? }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ONSHAPE_WORKER_URL = Deno.env.get("ONSHAPE_WORKER_URL");
const ONSHAPE_WORKER_TOKEN = Deno.env.get("ONSHAPE_WORKER_TOKEN");

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
    const { data: job, error: jobErr } = await admin
      .from("cad_jobs")
      .select("*")
      .eq("id", job_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (jobErr || !job) return json({ error: "Job not found" }, 404);

    if (job.status === "succeeded" || job.status === "failed") {
      return json({ status: job.status, outputs: job.outputs, error: job.error });
    }
    if (!job.worker_task_id) return json({ status: job.status });
    if (!ONSHAPE_WORKER_URL || !ONSHAPE_WORKER_TOKEN) {
      return json({ status: job.status, error: "Worker not configured" }, 503);
    }

    const pollResp = await fetch(
      `${ONSHAPE_WORKER_URL.replace(/\/$/, "")}/jobs/${job.worker_task_id}`,
      { headers: { Authorization: `Bearer ${ONSHAPE_WORKER_TOKEN}` } },
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
        .from("cad_jobs")
        .update({ status: "failed", error: String(errMsg).slice(0, 500) })
        .eq("id", job_id);
      return json({ status: "failed", error: errMsg });
    }

    if (wStatus === "succeeded" || wStatus === "completed" || wStatus === "done") {
      const out = (w?.outputs ?? {}) as Record<string, string | undefined>;

      // Block localhost URLs (worker must publish to a publicly-fetchable host).
      const unreachable = Object.entries(out)
        .filter(([, url]) => !!url)
        .filter(([, url]) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/)/i.test(url!))
        .map(([k]) => k);
      if (unreachable.length > 0) {
        const msg =
          `CAD worker returned non-public URL(s) for: ${unreachable.join(", ")}. ` +
          `The worker must upload outputs to a publicly fetchable host.`;
        await admin.from("cad_jobs").update({ status: "failed", error: msg.slice(0, 500) }).eq("id", job_id);
        return json({ status: "failed", error: msg });
      }

      const rehosted: Record<string, string> = {};
      const folder = `${userId}/${job.project_id ?? "_no_project"}/cad-jobs/${job_id}`;
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
          const ext =
            key.includes("step") ? "step" :
            key.includes("stl")  ? "stl" :
            key.includes("glb")  ? "glb" :
            key.includes("png")  ? "png" : "bin";
          const mime =
            ext === "step" ? "model/step" :
            ext === "stl"  ? "model/stl" :
            ext === "glb"  ? "model/gltf-binary" :
            ext === "png"  ? "image/png" : "application/octet-stream";
          const path = `${folder}/${key}.${ext}`;
          const { error: upErr } = await admin.storage
            .from("geometries")
            .upload(path, bytes, { contentType: mime, upsert: true });
          if (upErr) {
            console.warn(`re-host upload failed for ${key}:`, upErr.message);
            rehosted[key] = url;
            continue;
          }
          if (ext === "png") {
            rehosted[key] = admin.storage.from("geometries").getPublicUrl(path).data.publicUrl;
          } else {
            const { data: signed } = await admin.storage
              .from("geometries")
              .createSignedUrl(path, 60 * 60 * 24 * 7);
            rehosted[key] = signed?.signedUrl ?? url;
          }
        } catch (e) {
          console.warn(`re-host threw for ${key}:`, e);
          rehosted[key] = url;
        }
      }

      await admin
        .from("cad_jobs")
        .update({ status: "succeeded", outputs: rehosted })
        .eq("id", job_id);
      return json({ status: "succeeded", outputs: rehosted });
    }

    return json({ status: "running", progress: w?.progress ?? 0, raw_status: wStatus });
  } catch (e) {
    console.error("cad-job-status error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
