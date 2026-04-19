/**
 * generate-concept-mesh
 *
 * Turn an approved concept render into a 3D GLB using the Meshy
 * Image-to-3D API (their top-tier `meshy-5` model). Far better
 * geometry quality on hard-surface subjects (cars) than open-source
 * Replicate models.
 *
 * Body: { concept_id: string }
 * Returns: { status: "generating", concept_id } (202) — job runs in background.
 *
 * Auth: caller must own the concept (verified server-side).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MESHY_API_KEY = Deno.env.get("MESHY_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MESHY_BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 8 * 60 * 1000; // 8 minutes — Meshy can take a few mins on top model

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!MESHY_API_KEY) {
      return json({ error: "MESHY_API_KEY is not configured" }, 500);
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
      .select("id, user_id, project_id, render_front_url")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cErr || !concept) return json({ error: "Concept not found" }, 404);

    const frontImage = concept.render_front_url;
    if (!frontImage) return json({ error: "Concept has no front render" }, 400);

    // Mark generating
    await admin
      .from("concepts")
      .update({ preview_mesh_status: "generating", preview_mesh_error: null })
      .eq("id", concept_id);

    console.log("generate-concept-mesh: starting Meshy job for concept", concept_id);

    // Run the long Meshy job in the background so we don't hit the 150s
    // edge-runtime idle timeout. The client polls `preview_mesh_status` on
    // the concept row to know when it's done.
    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    EdgeRuntime.waitUntil(runMeshyJob({
      admin,
      concept_id,
      userId,
      projectId: concept.project_id,
      imageUrl: frontImage,
    }));

    return json({ status: "generating", concept_id }, 202);
  } catch (e) {
    console.error("generate-concept-mesh error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function runMeshyJob({
  admin, concept_id, userId, projectId, imageUrl,
}: {
  admin: ReturnType<typeof createClient>;
  concept_id: string;
  userId: string;
  projectId: string;
  imageUrl: string;
}) {
  try {
    // 1) Create the Image-to-3D task using Meshy's top model.
    // Docs: https://docs.meshy.ai/api/image-to-3d
    const createResp = await fetch(MESHY_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MESHY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        ai_model: "meshy-6",        // top-tier model
        topology: "quad",            // cleaner geometry for hard surfaces
        target_polycount: 50000,
        should_remesh: true,
        should_texture: true,
        enable_pbr: true,
        symmetry_mode: "auto",
      }),
    });

    if (!createResp.ok) {
      const t = await createResp.text();
      console.error("Meshy create failed:", createResp.status, t.slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Meshy ${createResp.status}: ${t.slice(0, 300)}`,
      }).eq("id", concept_id);
      return;
    }

    const createJson = await createResp.json();
    const taskId: string | undefined = createJson.result;
    if (!taskId) {
      console.error("Meshy returned no task id:", JSON.stringify(createJson).slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: "Meshy returned no task id",
      }).eq("id", concept_id);
      return;
    }
    console.log("Meshy task created:", taskId);

    // 2) Poll until it succeeds, fails, or times out.
    const start = Date.now();
    let task: any = null;
    while (true) {
      if (Date.now() - start > MAX_POLL_MS) {
        await admin.from("concepts").update({
          preview_mesh_status: "failed",
          preview_mesh_error: "Generation timed out after 8 minutes",
        }).eq("id", concept_id);
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(`${MESHY_BASE}/${taskId}`, {
        headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
      });
      if (!pollResp.ok) {
        console.warn("Meshy poll failed:", pollResp.status);
        continue;
      }
      task = await pollResp.json();
      console.log("Meshy poll status:", task.status, "progress:", task.progress);
      if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELED" || task.status === "EXPIRED") {
        break;
      }
    }

    if (task.status !== "SUCCEEDED") {
      const errMsg = task.task_error?.message || `Meshy status: ${task.status}`;
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: String(errMsg).slice(0, 500),
      }).eq("id", concept_id);
      return;
    }

    const glbUrl: string | undefined = task.model_urls?.glb;
    if (!glbUrl) {
      console.error("Meshy succeeded but no GLB url:", JSON.stringify(task.model_urls).slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: "Meshy returned no GLB URL",
      }).eq("id", concept_id);
      return;
    }
    console.log("Meshy output GLB:", glbUrl);

    // 3) Download and re-host in our public bucket so we control caching/expiry.
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

    // Cache-bust the public URL so the viewer fetches the new mesh.
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    await admin.from("concepts").update({
      preview_mesh_url: bustedUrl,
      preview_mesh_status: "ready",
      preview_mesh_error: null,
    }).eq("id", concept_id);

    console.log("generate-concept-mesh: success", bustedUrl);
  } catch (e) {
    console.error("runMeshyJob error:", e);
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
