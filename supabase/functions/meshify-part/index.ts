/**
 * meshify-part
 *
 * Async wrapper around Meshy single-image-to-3d to avoid the 150s edge
 * function timeout. Two actions:
 *
 *   action: "start"  → kicks off Meshy job, returns { task_id } immediately
 *   action: "status" → polls Meshy once. If SUCCEEDED, downloads the GLB,
 *                      re-hosts it in our bucket, returns { status, glb_url }.
 *                      Otherwise returns { status, progress }.
 *
 * The client polls "status" every few seconds until status is terminal.
 *
 * Body:
 *   { action: "start",  concept_id, part_kind, image_urls }
 *   { action: "status", concept_id, part_kind, task_id }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MESHY_API_KEY = Deno.env.get("MESHY_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MESHY_SINGLE = "https://api.meshy.ai/openapi/v1/image-to-3d";
const MESHY_MULTI  = "https://api.meshy.ai/openapi/v1/multi-image-to-3d";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!MESHY_API_KEY) return json({ error: "MESHY_API_KEY is not configured" }, 500);

    const body = await req.json() as {
      action?: "start" | "status";
      concept_id?: string;
      part_kind?: string;
      image_urls?: string[];
      task_id?: string;
    };
    const action = body.action ?? "start";
    const { concept_id, part_kind } = body;

    if (!concept_id || !part_kind) {
      return json({ error: "concept_id and part_kind required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: concept } = await admin
      .from("concepts")
      .select("id, project_id, user_id")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!concept) return json({ error: "Concept not found" }, 404);

    // ─────────── START ───────────
    if (action === "start") {
      const image_urls = body.image_urls;
      if (!Array.isArray(image_urls) || image_urls.length === 0) {
        return json({ error: "image_urls required" }, 400);
      }
      const inputUrl = image_urls[0];

      const createResp = await fetch(MESHY_SINGLE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MESHY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image_url: inputUrl,
          ai_model: "meshy-6",
          topology: "triangle",
          target_polycount: 30000,
          should_remesh: true,
          should_texture: true,
          enable_pbr: true,
          symmetry_mode: "auto",
        }),
      });
      if (!createResp.ok) {
        const t = await createResp.text();
        console.error("Meshy create failed:", createResp.status, t.slice(0, 500));
        return json({ error: `Meshy ${createResp.status}: ${t.slice(0, 300)}` }, 500);
      }
      const createJson = await createResp.json();
      const taskId: string | undefined = createJson.result;
      if (!taskId) return json({ error: "Meshy returned no task id" }, 500);
      console.log("meshify-part task created:", taskId, "for", part_kind);
      return json({ task_id: taskId, status: "IN_PROGRESS", progress: 0 });
    }

    // ─────────── STATUS ───────────
    const taskId = body.task_id;
    if (!taskId) return json({ error: "task_id required for status" }, 400);

    const pollResp = await fetch(`${MESHY_SINGLE}/${taskId}`, {
      headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
    });
    if (!pollResp.ok) {
      const t = await pollResp.text();
      return json({ error: `Meshy poll ${pollResp.status}: ${t.slice(0, 200)}` }, 500);
    }
    const task = await pollResp.json();
    const status: string = task.status;
    const progress: number = task.progress ?? 0;
    console.log("meshify-part poll:", status, progress);

    if (status === "FAILED" || status === "CANCELED" || status === "EXPIRED") {
      const msg = task.task_error?.message || `Meshy status: ${status}`;
      return json({ status, error: String(msg).slice(0, 500) });
    }

    if (status !== "SUCCEEDED") {
      return json({ status, progress });
    }

    // SUCCEEDED — download GLB and re-host it
    const glbUrl: string | undefined = task.model_urls?.glb;
    if (!glbUrl) return json({ error: "Meshy returned no GLB" }, 500);

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());

    const path = `${userId}/${concept.project_id}/parts/${concept_id}/${part_kind}-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    return json({ status: "SUCCEEDED", progress: 100, glb_url: bustedUrl });
  } catch (e) {
    console.error("meshify-part error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
