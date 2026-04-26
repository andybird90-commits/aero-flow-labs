/**
 * bake-bodykit-from-shell
 *
 * Dispatcher: hands the heavy mesh work off to the external Blender worker
 * (`/jobs` endpoint, `bake_bodykit` op) and ingests the results back into
 * Supabase as `body_kit_parts`.
 *
 * The previous in-edge implementation tripped Lovable Cloud's ~5s CPU-time
 * cap on every non-trivial shell mesh; Blender has no such limit and does
 * proper boolean CSG via bpy.
 *
 * Body: { body_kit_id: string }
 *
 * Status flow:
 *   queued → baking → splitting → ready
 *   any    → failed (with `error`)
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

/** Worker-side defaults; the bake transform is captured by the user already. */
const TOLERANCE_MM = 4;
const MIN_PANEL_TRIS = 80;
/** Hard cap so a hung Blender job doesn't block the row forever. */
const MAX_POLL_SECONDS = 8 * 60;
const POLL_INTERVAL_MS = 4_000;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { body_kit_id?: string };
    if (!body.body_kit_id) return json({ error: "body_kit_id required" }, 400);
    const bodyKitId = body.body_kit_id;

    // --- Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Verify ownership + idempotency ---
    const { data: kitData, error: kitErr } = await admin
      .from("body_kits")
      .select("id, user_id, status")
      .eq("id", bodyKitId)
      .maybeSingle();
    if (kitErr) return json({ error: kitErr.message }, 500);
    if (!kitData) return json({ error: "body_kits row not found" }, 404);
    if ((kitData as any).user_id !== userId) return json({ error: "Forbidden" }, 403);
    if ((kitData as any).status === "ready") {
      return json({ ok: true, status: "ready", body_kit_id: bodyKitId, skipped: true });
    }

    if (!BLENDER_WORKER_URL || !BLENDER_WORKER_TOKEN) {
      const msg = "Blender worker not configured. Set BLENDER_WORKER_URL and BLENDER_WORKER_TOKEN.";
      await admin.from("body_kits")
        .update({ status: "failed", error: msg })
        .eq("id", bodyKitId);
      return json({ error: msg }, 503);
    }

    // Flip immediately so the UI reflects progress.
    await admin.from("body_kits")
      .update({ status: "baking", error: null })
      .eq("id", bodyKitId);

    const work = runBake(admin, bodyKitId, userId).catch(async (e) => {
      const msg = String((e as Error).message ?? e).slice(0, 1000);
      console.error("bake-bodykit-from-shell failed:", msg);
      await admin.from("body_kits")
        .update({ status: "failed", error: msg })
        .eq("id", bodyKitId);
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(work);
    }

    return json({ ok: true, status: "baking", body_kit_id: bodyKitId, async: true }, 202);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Heavy work — runs after the HTTP response.
// ──────────────────────────────────────────────────────────────────────────

interface PanelManifestEntry {
  key: string;          // e.g. "panel_3_stl"
  filename: string;
  slot: string;
  slot_name: string;
  confidence: number;
  triangle_count: number;
  area_m2?: number;
  bbox: { min: number[]; max: number[] };
  centroid: number[];
  ai_label?: string | null;
  ai_confidence?: number | null;
  ai_reasoning?: string | null;
}

async function runBake(admin: any, bodyKitId: string, userId: string): Promise<void> {
  // --- Reload kit + skin + donor ---
  const { data: kitData, error: kitErr } = await admin
    .from("body_kits")
    .select("*")
    .eq("id", bodyKitId)
    .maybeSingle();
  if (kitErr) throw new Error(kitErr.message);
  if (!kitData) throw new Error("body_kits row not found");
  const kit = kitData as {
    id: string;
    body_skin_id: string;
    donor_car_template_id: string | null;
    baked_transform: unknown;
  };

  if (!kit.donor_car_template_id) {
    throw new Error("No donor car template attached to this kit.");
  }

  const { data: skinData, error: skinErr } = await admin
    .from("body_skins")
    .select("file_url_stl, name")
    .eq("id", kit.body_skin_id)
    .maybeSingle();
  if (skinErr) throw new Error(`Skin lookup failed: ${skinErr.message}`);
  if (!skinData?.file_url_stl) {
    throw new Error("Body skin has no STL file. Re-export it as STL before baking.");
  }

  const { data: carStl, error: carErr } = await admin
    .from("car_stls")
    .select("repaired_stl_path, stl_path")
    .eq("car_template_id", kit.donor_car_template_id)
    .maybeSingle();
  if (carErr) throw new Error(`Donor lookup failed: ${carErr.message}`);
  if (!carStl) throw new Error("Donor car has no STL configured.");
  const donorPath = (carStl.repaired_stl_path ?? carStl.stl_path) as string | null;
  if (!donorPath) throw new Error("Donor car STL path missing.");

  // --- Sign URLs the worker can fetch (1h TTL — bake should finish well within) ---
  const donorUrl = await signOrPassthrough(admin, "car-stls", donorPath);
  const shellUrl = await signOrPassthrough(admin, "body-skins", skinData.file_url_stl);

  // --- POST job to Blender worker ---
  const dispatchResp = await fetch(
    `${BLENDER_WORKER_URL!.replace(/\/$/, "")}/jobs`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BLENDER_WORKER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_type: "bake_bodykit",
        inputs: {
          donor_stl_url: donorUrl,
          shell_stl_url: shellUrl,
          baked_transform: kit.baked_transform ?? {},
          tolerance_mm: TOLERANCE_MM,
          min_panel_tris: MIN_PANEL_TRIS,
        },
      }),
    },
  );
  if (!dispatchResp.ok) {
    const txt = await dispatchResp.text();
    throw new Error(`Blender worker dispatch failed (${dispatchResp.status}): ${txt.slice(0, 300)}`);
  }
  const { task_id: taskId } = await dispatchResp.json();
  if (!taskId) throw new Error("Blender worker returned no task_id");

  // --- Poll the worker until done ---
  const start = Date.now();
  let lastStatus = "queued";
  while (true) {
    if (Date.now() - start > MAX_POLL_SECONDS * 1000) {
      throw new Error(`Blender job ${taskId} timed out after ${MAX_POLL_SECONDS}s`);
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
      throw new Error(`Blender bake failed: ${(w.error ?? "unknown").slice(0, 500)}`);
    }
    if (lastStatus === "succeeded" || lastStatus === "completed" || lastStatus === "complete" || lastStatus === "done") {
      await admin.from("body_kits").update({ status: "splitting" }).eq("id", kit.id);
      await ingestWorkerOutputs(admin, kit.id, userId, w.outputs ?? {});
      return;
    }
    // running / queued / starting → keep polling
  }
}

/**
 * Ingest the outputs returned by the worker. Each value is a signed URL into
 * the `geometries` bucket (uploaded by the worker via `upload-blender-output`).
 * Keep STL outputs at their worker-uploaded signed URLs. Downloading/rehosting
 * multiple meshes inside the edge runtime can exceed the memory limit; the
 * worker already stored those bytes safely via `upload-blender-output`.
 */
async function ingestWorkerOutputs(
  admin: any,
  bodyKitId: string,
  userId: string,
  outputs: Record<string, string>,
): Promise<void> {
  const combinedUrl = outputs.combined_stl;
  const manifestUrl = outputs.panel_manifest_json;
  if (!combinedUrl) throw new Error("Worker did not return combined_stl");
  if (!manifestUrl) throw new Error("Worker did not return panel_manifest_json");

  // Manifest JSON is small enough to fetch in the edge runtime.
  const manifestBytes = await downloadBytes(manifestUrl);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    panels: PanelManifestEntry[];
    combined_triangle_count?: number;
    ai_attempts?: number;
    ai_notes?: string;
    ai_enabled?: boolean;
  };

  // Wipe existing rows (idempotent re-bake)
  await admin.from("body_kit_parts").delete().eq("body_kit_id", bodyKitId);

  const insertRows: Array<Record<string, unknown>> = [];
  let panelCount = 0;
  for (const panel of manifest.panels ?? []) {
    const url = outputs[panel.key];
    if (!url) {
      console.warn(`Manifest panel ${panel.key} has no matching output URL — skipping`);
      continue;
    }
    const centroid = panel.centroid ?? [];
    insertRows.push({
      body_kit_id: bodyKitId,
      user_id: userId,
      slot: panel.slot_name,
      label: panel.slot,
      confidence: panel.confidence,
      stl_path: url,
      triangle_count: panel.triangle_count,
      area_m2: typeof panel.area_m2 === "number" ? panel.area_m2 : 0,
      anchor_position: centroid.length === 3
        ? { x: centroid[0], y: centroid[1], z: centroid[2] }
        : null,
      bbox: {
        min: panel.bbox?.min ?? [0, 0, 0],
        max: panel.bbox?.max ?? [0, 0, 0],
      },
      ai_label: panel.ai_label ?? null,
      ai_confidence: panel.ai_confidence ?? null,
      ai_reasoning: panel.ai_reasoning ?? null,
    });
    panelCount++;
  }

  if (insertRows.length > 0) {
    const { error: insErr } = await admin.from("body_kit_parts").insert(insertRows);
    if (insErr) throw new Error(`Insert panels failed: ${insErr.message}`);
  }

  await admin.from("body_kits")
    .update({
      status: "ready",
      panel_count: panelCount,
      triangle_count: manifest.combined_triangle_count ?? null,
      combined_stl_path: combinedUrl,
      ai_attempts: manifest.ai_attempts ?? 0,
      ai_notes: manifest.ai_notes ?? null,
      error: null,
    })
    .eq("id", bodyKitId);
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Sign a private storage path, or pass through an https URL unchanged. */
async function signOrPassthrough(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  pathOrUrl: string,
): Promise<string> {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(pathOrUrl, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to sign ${bucket}/${pathOrUrl}: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download ${url.slice(0, 80)}… failed: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
