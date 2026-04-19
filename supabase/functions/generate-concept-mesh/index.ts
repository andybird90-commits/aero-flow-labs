/**
 * generate-concept-mesh
 *
 * Experimental: turn an approved concept render into a rough 3D GLB using
 * Replicate's `tencent/hunyuan-3d-3.1` image-to-3D model. The resulting
 * mesh is uploaded to the `concept-renders` bucket and the URL stored on
 * the concept row. This is a *visual reference* only — not exportable, not
 * the source for the parametric kit.
 *
 * Body: { concept_id: string }
 * Returns: { mesh_url: string } on success, { error } otherwise.
 *
 * Auth: caller must own the concept (verified server-side).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REPLICATE_MODEL = "tencent/hunyuan-3d-3.1";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!REPLICATE_API_TOKEN) {
      return json({ error: "REPLICATE_API_TOKEN is not configured" }, 500);
    }

    const { concept_id } = await req.json();
    if (!concept_id || typeof concept_id !== "string") {
      return json({ error: "concept_id is required" }, 400);
    }

    // Auth user
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load concept (verify ownership)
    const { data: concept, error: cErr } = await admin
      .from("concepts")
      .select("id, user_id, project_id, render_front_url, render_side_url, render_rear34_url, render_rear_url")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cErr || !concept) return json({ error: "Concept not found" }, 404);

    // Pick best reference image (front 3/4 preferred)
    const imageUrl =
      concept.render_front_url ||
      concept.render_rear34_url ||
      concept.render_side_url ||
      concept.render_rear_url;
    if (!imageUrl) return json({ error: "Concept has no rendered images" }, 400);

    // Mark generating
    await admin
      .from("concepts")
      .update({ preview_mesh_status: "generating", preview_mesh_error: null })
      .eq("id", concept_id);

    console.log("generate-concept-mesh: starting Replicate run for concept", concept_id);

    // Create prediction
    const createResp = await fetch("https://api.replicate.com/v1/models/" + REPLICATE_MODEL + "/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=5",
      },
      body: JSON.stringify({
        input: {
          image: imageUrl,
          // Hunyuan-3d-3.1 default params; let model decide texture/geometry quality.
        },
      }),
    });

    if (!createResp.ok) {
      const t = await createResp.text();
      console.error("Replicate create failed:", createResp.status, t.slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Replicate ${createResp.status}: ${t.slice(0, 200)}`,
      }).eq("id", concept_id);
      return json({ error: `Replicate error (${createResp.status})` }, 500);
    }

    let prediction = await createResp.json();
    console.log("Replicate prediction created:", prediction.id, "status:", prediction.status);

    // Poll until terminal state
    const start = Date.now();
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      if (Date.now() - start > MAX_POLL_MS) {
        await admin.from("concepts").update({
          preview_mesh_status: "failed",
          preview_mesh_error: "Generation timed out after 5 minutes",
        }).eq("id", concept_id);
        return json({ error: "Generation timed out" }, 504);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      if (!pollResp.ok) {
        console.warn("poll failed:", pollResp.status);
        continue;
      }
      prediction = await pollResp.json();
      console.log("Replicate poll status:", prediction.status);
    }

    if (prediction.status !== "succeeded") {
      const errMsg = prediction.error || `Replicate status: ${prediction.status}`;
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: String(errMsg).slice(0, 500),
      }).eq("id", concept_id);
      return json({ error: errMsg }, 500);
    }

    // Output is typically { mesh: "https://..." } or a string URL or array
    let glbUrl: string | undefined;
    const out = prediction.output;
    if (typeof out === "string") glbUrl = out;
    else if (Array.isArray(out)) glbUrl = out.find((u) => typeof u === "string" && /\.(glb|gltf)$/i.test(u)) ?? out[0];
    else if (out && typeof out === "object") {
      glbUrl = out.mesh || out.glb || out.model || Object.values(out).find((v) => typeof v === "string") as string | undefined;
    }
    if (!glbUrl) {
      console.error("No GLB url in output:", JSON.stringify(out).slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: "Replicate returned no mesh URL",
      }).eq("id", concept_id);
      return json({ error: "No mesh URL in Replicate output" }, 500);
    }

    console.log("Replicate output GLB:", glbUrl);

    // Download GLB and re-host in our bucket so it survives Replicate's expiry
    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) {
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Failed to download GLB: ${glbResp.status}`,
      }).eq("id", concept_id);
      return json({ error: `Failed to download GLB (${glbResp.status})` }, 500);
    }
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());
    const path = `${userId}/${concept.project_id}/preview-mesh-${concept_id}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) {
      console.error("upload failed:", upErr);
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Upload failed: ${upErr.message}`,
      }).eq("id", concept_id);
      return json({ error: "Failed to upload mesh" }, 500);
    }

    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    await admin.from("concepts").update({
      preview_mesh_url: publicUrl,
      preview_mesh_status: "ready",
      preview_mesh_error: null,
    }).eq("id", concept_id);

    console.log("generate-concept-mesh: success", publicUrl);
    return json({ mesh_url: publicUrl });
  } catch (e) {
    console.error("generate-concept-mesh error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
