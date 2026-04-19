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

// firtoz/trellis — Microsoft TRELLIS, best open-source image-to-3D for hard surfaces (cars, mech).
// Single image in, GLB out. Much cleaner topology than Hunyuan.
const REPLICATE_VERSION = "e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c";
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

    // Trellis takes a single image
    const frontImage = concept.render_front_url;
    if (!frontImage) return json({ error: "Concept has no front render" }, 400);

    // Trellis input schema: images (array), generate model output, GLB format
    const input: Record<string, unknown> = {
      images: [frontImage],
      texture_size: 2048,
      mesh_simplify: 0.95,
      generate_model: true,
      save_gaussian_ply: false,
      ss_sampling_steps: 38,
      slat_sampling_steps: 38,
      ss_guidance_strength: 7.5,
      slat_guidance_strength: 3,
    };

    // Mark generating
    await admin
      .from("concepts")
      .update({ preview_mesh_status: "generating", preview_mesh_error: null })
      .eq("id", concept_id);

    console.log("generate-concept-mesh: starting Replicate run for concept", concept_id, "with views:", Object.keys(input).filter(k => k.endsWith("_image")));

    // Run the long Replicate job in the background so we don't hit the 150s
    // edge-runtime idle timeout. The client polls `preview_mesh_status` on
    // the concept row to know when it's done.
    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    EdgeRuntime.waitUntil(runReplicateJob({ admin, concept_id, userId, projectId: concept.project_id, input }));

    return json({ status: "generating", concept_id }, 202);
  } catch (e) {
    console.error("generate-concept-mesh error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function runReplicateJob({
  admin, concept_id, userId, projectId, input,
}: {
  admin: ReturnType<typeof createClient>;
  concept_id: string;
  userId: string;
  projectId: string;
  input: Record<string, unknown>;
}) {
  try {
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=5",
      },
      body: JSON.stringify({ version: REPLICATE_VERSION, input }),
    });

    if (!createResp.ok) {
      const t = await createResp.text();
      console.error("Replicate create failed:", createResp.status, t.slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Replicate ${createResp.status}: ${t.slice(0, 200)}`,
      }).eq("id", concept_id);
      return;
    }

    let prediction = await createResp.json();
    console.log("Replicate prediction created:", prediction.id, "status:", prediction.status);

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
        return;
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
      return;
    }

    let glbUrl: string | undefined;
    const out = prediction.output;
    if (typeof out === "string") glbUrl = out;
    else if (Array.isArray(out)) glbUrl = out.find((u: unknown) => typeof u === "string" && /\.(glb|gltf)$/i.test(u as string)) ?? out[0];
    else if (out && typeof out === "object") {
      glbUrl = out.mesh || out.glb || out.model || Object.values(out).find((v) => typeof v === "string") as string | undefined;
    }
    if (!glbUrl) {
      console.error("No GLB url in output:", JSON.stringify(out).slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: "Replicate returned no mesh URL",
      }).eq("id", concept_id);
      return;
    }

    console.log("Replicate output GLB:", glbUrl);

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) {
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Failed to download GLB: ${glbResp.status}`,
      }).eq("id", concept_id);
      return;
    }
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());
    const path = `${userId}/${projectId}/preview-mesh-${concept_id}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) {
      console.error("upload failed:", upErr);
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Upload failed: ${upErr.message}`,
      }).eq("id", concept_id);
      return;
    }

    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    await admin.from("concepts").update({
      preview_mesh_url: publicUrl,
      preview_mesh_status: "ready",
      preview_mesh_error: null,
    }).eq("id", concept_id);

    console.log("generate-concept-mesh: success", publicUrl);
  } catch (e) {
    console.error("runReplicateJob error:", e);
    await admin.from("concepts").update({
      preview_mesh_status: "failed",
      preview_mesh_error: e instanceof Error ? e.message.slice(0, 500) : "Unknown error",
    }).eq("id", concept_id);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
