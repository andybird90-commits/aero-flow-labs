/**
 * repair-car-stl
 *
 * Admin-only. Sends a hero-car STL to the external Blender worker to be
 * made watertight + manifold (weld -> fill holes -> voxel remesh fallback),
 * then re-uploads the repaired STL to the `car-stls` bucket and updates the
 * `car_stls` row with stats.
 *
 * The boolean aero-kit pipeline refuses to run on non-manifold inputs, so
 * `manifold_clean` is the gate the rest of the system reads.
 *
 * Body: { car_stl_id: string }
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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BLENDER_WORKER_URL = Deno.env.get("BLENDER_WORKER_URL");
const BLENDER_WORKER_TOKEN = Deno.env.get("BLENDER_WORKER_TOKEN");

const VOXEL_SIZE_MM = 12;
const MAX_POLL_SECONDS = 6 * 60;
const POLL_INTERVAL_MS = 3_000;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { car_stl_id?: string };
    if (!body.car_stl_id) return json({ error: "car_stl_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userRes.user.id,
      _role: "admin",
    });
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!isAdmin) return json({ error: "Admin role required" }, 403);

    if (!BLENDER_WORKER_URL || !BLENDER_WORKER_TOKEN) {
      return json({ error: "Blender worker not configured (BLENDER_WORKER_URL / BLENDER_WORKER_TOKEN)" }, 503);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: row, error: rowErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("id", body.car_stl_id)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: "car_stls row not found" }, 404);

    // Run the heavy work in the background; respond immediately.
    const work = runRepair(admin, row.id, row.stl_path).catch(async (e) => {
      const msg = String((e as Error).message ?? e).slice(0, 1000);
      console.error("repair-car-stl failed:", msg);
      // Surface failure on the row so the admin UI can show it.
      await admin.from("car_stls")
        .update({ notes: `[repair failed] ${msg}` })
        .eq("id", row.id);
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(work);
    }

    return json({ ok: true, status: "queued", car_stl_id: row.id, async: true }, 202);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

async function runRepair(admin: any, carStlId: string, stlPath: string): Promise<void> {
  // 1. Sign the source STL so the worker can fetch it (1h TTL).
  const { data: signed, error: signErr } = await admin.storage
    .from("car-stls")
    .createSignedUrl(stlPath, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Sign source failed: ${signErr?.message ?? "unknown"}`);
  }

  // 2. Dispatch the Blender repair job.
  const dispatchResp = await fetch(
    `${BLENDER_WORKER_URL!.replace(/\/$/, "")}/jobs`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BLENDER_WORKER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_type: "repair_donor_stl",
        inputs: {
          stl_url: signed.signedUrl,
          voxel_size_mm: VOXEL_SIZE_MM,
        },
      }),
    },
  );
  if (!dispatchResp.ok) {
    const txt = await dispatchResp.text();
    throw new Error(`Blender dispatch failed (${dispatchResp.status}): ${txt.slice(0, 300)}`);
  }
  const { task_id: taskId } = await dispatchResp.json();
  if (!taskId) throw new Error("Blender worker returned no task_id");

  // 3. Poll until done.
  const start = Date.now();
  let lastStatus = "queued";
  let outputs: Record<string, string> = {};
  while (true) {
    if (Date.now() - start > MAX_POLL_SECONDS * 1000) {
      throw new Error(`Repair job ${taskId} timed out after ${MAX_POLL_SECONDS}s`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const pr = await fetch(
      `${BLENDER_WORKER_URL!.replace(/\/$/, "")}/jobs/${taskId}`,
      { headers: { Authorization: `Bearer ${BLENDER_WORKER_TOKEN}` } },
    );
    if (!pr.ok) {
      const t = await pr.text();
      throw new Error(`Worker poll failed (${pr.status}): ${t.slice(0, 200)}`);
    }
    const w = await pr.json();
    lastStatus = w.status ?? lastStatus;
    if (lastStatus === "failed" || lastStatus === "error" || lastStatus === "canceled") {
      throw new Error(`Blender repair failed: ${(w.error ?? "unknown").slice(0, 500)}`);
    }
    if (lastStatus === "succeeded" || lastStatus === "completed" || lastStatus === "complete" || lastStatus === "done") {
      outputs = w.outputs ?? {};
      break;
    }
  }

  const repairedUrl = outputs.repaired_stl;
  const statsUrl = outputs.repair_stats_json;
  if (!repairedUrl) throw new Error("Worker did not return repaired_stl");
  if (!statsUrl) throw new Error("Worker did not return repair_stats_json");

  // 4. Fetch stats (small JSON).
  const statsResp = await fetch(statsUrl);
  if (!statsResp.ok) throw new Error(`Stats download failed: ${statsResp.status}`);
  const stats = await statsResp.json() as {
    manifold: boolean;
    triangle_count_after: number;
    bbox_min: [number, number, number];
    bbox_max: [number, number, number];
    voxel_remeshed: boolean;
    voxel_size_mm: number | null;
    non_manifold_edges_before: number;
    non_manifold_edges_after: number;
  };

  // 5. Stream the repaired STL from the worker's signed URL back into the
  //    `car-stls` bucket. Stream it through to avoid buffering large files.
  const repairedPath = stlPath.replace(/\.(stl|obj)$/i, "") + ".repaired.stl";
  const meshResp = await fetch(repairedUrl);
  if (!meshResp.ok || !meshResp.body) {
    throw new Error(`Repaired STL download failed: ${meshResp.status}`);
  }
  const contentLength = meshResp.headers.get("Content-Length") ?? undefined;
  const uploadHeaders: Record<string, string> = {
    "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
    "apikey": SERVICE_ROLE_KEY,
    "Content-Type": "model/stl",
    "x-upsert": "true",
  };
  if (contentLength) uploadHeaders["Content-Length"] = contentLength;
  const upResp = await fetch(
    `${SUPABASE_URL}/storage/v1/object/car-stls/${repairedPath}`,
    {
      method: "POST",
      headers: uploadHeaders,
      body: meshResp.body,
      ...({ duplex: "half" } as Record<string, unknown>),
    },
  );
  if (!upResp.ok) {
    const t = await upResp.text();
    throw new Error(`Upload repaired STL failed (${upResp.status}): ${t.slice(0, 300)}`);
  }

  // 6. Update the row.
  const { error: updErr } = await admin
    .from("car_stls")
    .update({
      repaired_stl_path: repairedPath,
      manifold_clean: stats.manifold,
      triangle_count: stats.triangle_count_after,
      bbox_min_mm: stats.bbox_min,
      bbox_max_mm: stats.bbox_max,
      notes: `Repaired via Blender (${stats.voxel_remeshed ? `voxel ${stats.voxel_size_mm}mm` : "weld+fill"}). ` +
        `Non-manifold edges: ${stats.non_manifold_edges_before} -> ${stats.non_manifold_edges_after}.`,
    })
    .eq("id", carStlId);
  if (updErr) throw new Error(updErr.message);

  console.log(`repair-car-stl done for ${carStlId}: manifold=${stats.manifold} tris=${stats.triangle_count_after}`);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
