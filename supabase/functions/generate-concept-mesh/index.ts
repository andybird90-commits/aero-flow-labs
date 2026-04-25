/**
 * generate-concept-mesh
 *
 * Turn an approved concept into a 3D GLB using Meshy 6 image-to-3d.
 *
 * Pipeline:
 *   1. Fetch the 4 concept render URLs from the `concepts` row.
 *   2. Pick the best primary view (side gives us silhouette + length).
 *      Use front 3/4 as the texture reference so Meshy biases the
 *      surfacing toward the styled face.
 *   3. POST to Meshy image-to-3d.
 *   4. Poll until done, download GLB, re-host in our `concept-renders` bucket.
 *
 * Body: { concept_id: string }
 * Returns: { status: "generating", concept_id } (202) — job runs in background.
 *
 * Auth: caller must own the concept (verified server-side).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createImageTo3dTask, getImageTo3dTask } from "../_shared/meshy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { concept_id } = await req.json();
    if (!concept_id || typeof concept_id !== "string") {
      return json({ error: "concept_id is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as any;

    const { data: concept, error: cErr } = await admin
      .from("concepts")
      .select("id, user_id, project_id, render_front_url, render_side_url, render_rear34_url, render_rear_url")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cErr || !concept) return json({ error: "Concept not found" }, 404);

    if (!concept.render_front_url && !concept.render_side_url) {
      return json({ error: "Concept has no front or side render" }, 400);
    }

    // Side gives the cleanest silhouette + true length for Meshy's vision
    // model. Fall back to front 3/4 if side missing.
    const primary = concept.render_side_url ?? concept.render_front_url;
    const textureRef = concept.render_side_url
      ? (concept.render_front_url ?? concept.render_rear34_url ?? null)
      : (concept.render_rear34_url ?? null);

    await admin
      .from("concepts")
      .update({ preview_mesh_status: "generating", preview_mesh_error: null })
      .eq("id", concept_id);

    console.log("generate-concept-mesh: starting Meshy 6 job for concept", concept_id);

    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    EdgeRuntime.waitUntil(runMeshyJob({
      admin,
      concept_id,
      userId,
      projectId: concept.project_id,
      primary: primary!,
      textureRef,
    }));

    return json({ status: "generating", concept_id }, 202);
  } catch (e) {
    console.error("generate-concept-mesh error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function runMeshyJob({
  admin, concept_id, userId, projectId, primary, textureRef,
}: {
  admin: any;
  concept_id: string;
  userId: string;
  projectId: string;
  primary: string;
  textureRef: string | null;
}) {
  try {
    const { task_id } = await createImageTo3dTask({
      image_url: primary,
      texture_image_url: textureRef ?? undefined,
      ai_model: "latest",
      enable_pbr: true,
      should_remesh: true,
      target_polycount: 50000,
      symmetry_mode: "auto",
      remove_lighting: true,
      target_formats: ["glb", "stl"],
    });
    console.log("Meshy task created:", task_id);

    const start = Date.now();
    let result = await getImageTo3dTask(task_id);
    while (
      result.status !== "SUCCEEDED" &&
      result.status !== "FAILED" &&
      result.status !== "CANCELED" &&
      result.status !== "EXPIRED"
    ) {
      if (Date.now() - start > MAX_POLL_MS) {
        await admin.from("concepts").update({
          preview_mesh_status: "failed",
          preview_mesh_error: "Generation timed out after 10 minutes",
        }).eq("id", concept_id);
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        result = await getImageTo3dTask(task_id);
      } catch (e) {
        console.warn("Meshy poll error (continuing):", e);
      }
    }

    if (result.status !== "SUCCEEDED") {
      const errMsg = result.error || `Meshy ${result.status}`;
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: String(errMsg).slice(0, 500),
      }).eq("id", concept_id);
      return;
    }

    const glbUrl = result.glb_url;
    if (!glbUrl) {
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: "Meshy returned no GLB URL",
      }).eq("id", concept_id);
      return;
    }
    console.log("Meshy output GLB:", glbUrl);

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
