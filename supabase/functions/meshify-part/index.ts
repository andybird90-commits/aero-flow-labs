/**
 * meshify-part
 *
 * Take the user-approved set of isolated part renders (4 angles on white)
 * produced by `render-isolated-part`, send them to Meshy multi-image-to-3d,
 * poll until done, re-host the GLB in our public bucket, return the URL.
 *
 * This is synchronous from the client's POV — it waits for the GLB. Meshy
 * usually finishes in 1-3 minutes for a single small part.
 *
 * Body: { concept_id: string; part_kind: string; image_urls: string[] }
 * Returns: { glb_url: string }
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

const MESHY_MULTI = "https://api.meshy.ai/openapi/v1/multi-image-to-3d";
const POLL_MS = 4000;
const MAX_MS = 8 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!MESHY_API_KEY) return json({ error: "MESHY_API_KEY is not configured" }, 500);

    const { concept_id, part_kind, image_urls } = await req.json() as {
      concept_id?: string; part_kind?: string; image_urls?: string[];
    };
    if (!concept_id || !part_kind || !Array.isArray(image_urls) || image_urls.length === 0) {
      return json({ error: "concept_id, part_kind, image_urls required" }, 400);
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

    // Meshy accepts up to 4 images.
    const inputUrls = image_urls.slice(0, 4);

    const createResp = await fetch(MESHY_MULTI, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MESHY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_urls: inputUrls,
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

    const start = Date.now();
    let task: any = null;
    while (true) {
      if (Date.now() - start > MAX_MS) {
        return json({ error: "Meshy timed out" }, 504);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      const pollResp = await fetch(`${MESHY_MULTI}/${taskId}`, {
        headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
      });
      if (!pollResp.ok) {
        console.warn("Meshy poll failed:", pollResp.status);
        continue;
      }
      task = await pollResp.json();
      console.log("meshify-part poll:", task.status, task.progress);
      if (["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(task.status)) break;
    }

    if (task.status !== "SUCCEEDED") {
      const msg = task.task_error?.message || `Meshy status: ${task.status}`;
      return json({ error: String(msg).slice(0, 500) }, 500);
    }

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

    return json({ glb_url: bustedUrl });
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
