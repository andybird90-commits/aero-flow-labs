/**
 * meshify-part
 *
 * Async wrapper around Meshy 6 image-to-3d (multi-view via primary + texture
 * reference) to convert isolated part renders into a clean 3D GLB. Output
 * GLB is re-hosted in our `concept-renders` bucket and cached on the
 * matching `concept_parts` row.
 *
 * Two actions:
 *   action: "start"  → kicks off Meshy task, returns { task_id }
 *   action: "status" → polls Meshy. If succeeded, downloads GLB → re-hosts →
 *                      returns { status, glb_url, stl_url }.
 *
 * Body:
 *   { action: "start",  concept_id, part_kind, image_urls }
 *   { action: "status", concept_id, part_kind, task_id }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createImageTo3dTask, getImageTo3dTask } from "../_shared/meshy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
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

      const isMulti = image_urls.length > 1;
      const primaryImage = image_urls[0];
      // If we have multiple isolated views, use the second as a texture
      // reference so Meshy biases the back-side surfacing toward our renders.
      const textureRef = isMulti ? image_urls[1] : undefined;

      try {
        const { task_id } = await createImageTo3dTask({
          image_url: primaryImage,
          texture_image_url: textureRef,
          ai_model: "latest",
          enable_pbr: true,
          should_remesh: true,
          target_polycount: 30000,
          symmetry_mode: "auto",
          remove_lighting: true,
          target_formats: ["glb", "stl"],
        });
        console.log("meshify-part Meshy task created:", task_id, "for", part_kind);
        return json({ task_id, status: "IN_PROGRESS", progress: 0, is_multi: isMulti });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Meshy create failed";
        console.error("meshify-part Meshy create failed:", msg);
        return json({ error: msg }, 500);
      }
    }

    // ─────────── STATUS ───────────
    const taskId = body.task_id;
    if (!taskId) return json({ error: "task_id required for status" }, 400);

    const result = await getImageTo3dTask(taskId);
    console.log("meshify-part Meshy poll:", result.status, result.progress);

    if (result.status === "FAILED" || result.status === "CANCELED" || result.status === "EXPIRED") {
      return json({ status: "FAILED", error: (result.error || `Meshy ${result.status}`).slice(0, 500) });
    }
    if (result.status !== "SUCCEEDED") {
      return json({ status: "IN_PROGRESS", progress: result.progress });
    }

    const glbUrl = result.glb_url;
    if (!glbUrl) {
      console.error("Meshy succeeded but no GLB url");
      return json({ error: "Meshy returned no GLB" }, 500);
    }

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());

    // Store the GLB directly. The viewer + downstream pipeline already
    // accept GLB via the `glb_url` column.
    const path = `${userId}/${concept.project_id}/parts/${concept_id}/${part_kind}-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    // Cache against the concept_part row.
    const { error: cacheErr } = await admin
      .from("concept_parts")
      .update({ glb_url: bustedUrl })
      .eq("concept_id", concept_id)
      .eq("kind", part_kind)
      .eq("user_id", userId);
    if (cacheErr) console.warn("concept_parts glb cache failed:", cacheErr.message);

    return json({ status: "SUCCEEDED", progress: 100, stl_url: bustedUrl, glb_url: bustedUrl });
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
