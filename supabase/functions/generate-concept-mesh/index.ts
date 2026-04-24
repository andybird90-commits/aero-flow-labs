/**
 * generate-concept-mesh
 *
 * Turn an approved concept into a 3D GLB using Hyper3D Rodin Gen-2 (Ultra)
 * via Replicate. We feed all 4 angles (front 3/4, side, rear 3/4, rear) so
 * Rodin has proper multi-view coverage instead of guessing the back of the
 * car from a single front shot.
 *
 * Pipeline:
 *   1. Fetch the 4 concept render URLs from the `concepts` row.
 *   2. Background-remove each one via Replicate (851-labs/background-remover)
 *      so Rodin gets a clean silhouette on a transparent backdrop. Concept
 *      renders we show in the UI keep their dramatic studio backdrop — these
 *      cleaned versions are only used as model input.
 *   3. POST to Replicate `hyper3d/rodin` with all cleaned angle images.
 *   4. Poll until done, download GLB, re-host in our `concept-renders` bucket.
 *
 * Body: { concept_id: string }
 * Returns: { status: "generating", concept_id } (202) — job runs in background.
 *
 * Auth: caller must own the concept (verified server-side).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RODIN_MODEL = "hyper3d/rodin";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 10 * 60 * 1000; // 10 minutes — Rodin Gen-2 can take a while

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!REPLICATE_API_TOKEN) return json({ error: "REPLICATE_API_TOKEN is not configured" }, 500);

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as any;

    // Load concept (verify ownership) — pull all 4 angle URLs
    const { data: concept, error: cErr } = await admin
      .from("concepts")
      .select("id, user_id, project_id, render_front_url, render_side_url, render_rear34_url, render_rear_url")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (cErr || !concept) return json({ error: "Concept not found" }, 404);

    // Build the ordered angle list. Front is required; others are best-effort.
    // Meshy's multi-image endpoint accepts up to ~4 images.
    const angleUrls = [
      concept.render_front_url,
      concept.render_side_url,
      concept.render_rear34_url,
      concept.render_rear_url,
    ].filter((u): u is string => !!u);

    if (angleUrls.length === 0 || !concept.render_front_url) {
      return json({ error: "Concept has no front render" }, 400);
    }

    // Mark generating
    await admin
      .from("concepts")
      .update({ preview_mesh_status: "generating", preview_mesh_error: null })
      .eq("id", concept_id);

    console.log("generate-concept-mesh: starting Rodin Gen-2 job for concept", concept_id, "with", angleUrls.length, "angles");

    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    EdgeRuntime.waitUntil(runRodinJob({
      admin,
      concept_id,
      userId,
      projectId: concept.project_id,
      angleUrls,
    }));

    return json({ status: "generating", concept_id }, 202);
  } catch (e) {
    console.error("generate-concept-mesh error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

/**
 * Background-remove a single image via Replicate's 851-labs/background-remover.
 * Returns a public URL (Replicate-hosted) of the cleaned PNG, or null on failure.
 *
 * We deliberately don't re-upload to our own bucket here because Meshy fetches
 * the URL directly within seconds and Replicate URLs are valid for 24h.
 */
async function removeBackground(imageUrl: string): Promise<string | null> {
  try {
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait", // synchronous response when fast enough
      },
      body: JSON.stringify({
        // 851-labs/background-remover — fast, reliable, ~$0.001/image
        version: "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
        input: { image: imageUrl, format: "png" },
      }),
    });

    if (!createResp.ok) {
      const t = await createResp.text();
      console.warn("Replicate bg-remove create failed:", createResp.status, t.slice(0, 200));
      return null;
    }

    let pred = await createResp.json();
    // Poll until done if Prefer:wait didn't finish it.
    const start = Date.now();
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
      if (Date.now() - start > 60_000) {
        console.warn("bg-remove timed out");
        return null;
      }
      await new Promise((r) => setTimeout(r, 1500));
      const pollResp = await fetch(pred.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      pred = await pollResp.json();
    }

    if (pred.status !== "succeeded") {
      console.warn("bg-remove failed:", pred.error);
      return null;
    }

    const out = typeof pred.output === "string" ? pred.output : pred.output?.[0];
    return typeof out === "string" ? out : null;
  } catch (e) {
    console.warn("removeBackground error:", e);
    return null;
  }
}

async function runRodinJob({
  admin, concept_id, userId, projectId, angleUrls,
}: {
  admin: any;
  concept_id: string;
  userId: string;
  projectId: string;
  angleUrls: string[];
}) {
  try {
    // 1) Background-remove all angles in parallel so Rodin gets clean silhouettes.
    console.log("Background-removing", angleUrls.length, "angles...");
    const cleaned = await Promise.all(angleUrls.map((u) => removeBackground(u)));
    const inputImages = cleaned
      .map((c, i) => c ?? angleUrls[i]) // fall back to original if bg-remove failed
      .filter(Boolean) as string[];
    console.log("Cleaned images ready:", inputImages.length, "of", angleUrls.length, "succeeded");

    // 2) Create the Rodin Gen-2 prediction on Replicate.
    // Model: hyper3d/rodin — takes `images: string[]` + optional `prompt`.
    const createResp = await fetch(`https://api.replicate.com/v1/models/${RODIN_MODEL}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          images: inputImages,
          prompt: "A high-detail automotive concept with custom aero body kit, clean studio reference, photoreal proportions",
        },
      }),
    });

    if (!createResp.ok) {
      const t = await createResp.text();
      console.error("Rodin create failed:", createResp.status, t.slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: `Rodin ${createResp.status}: ${t.slice(0, 300)}`,
      }).eq("id", concept_id);
      return;
    }

    let pred = await createResp.json();
    const predictionId: string = pred.id;
    console.log("Rodin prediction created:", predictionId);

    // 3) Poll until succeeded / failed / timeout.
    const start = Date.now();
    while (pred.status !== "succeeded" && pred.status !== "failed" && pred.status !== "canceled") {
      if (Date.now() - start > MAX_POLL_MS) {
        await admin.from("concepts").update({
          preview_mesh_status: "failed",
          preview_mesh_error: "Generation timed out after 10 minutes",
        }).eq("id", concept_id);
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(pred.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      if (!pollResp.ok) {
        console.warn("Rodin poll failed:", pollResp.status);
        continue;
      }
      pred = await pollResp.json();
      console.log("Rodin poll status:", pred.status);
    }

    if (pred.status !== "succeeded") {
      const errMsg = pred.error || `Rodin status: ${pred.status}`;
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: String(errMsg).slice(0, 500),
      }).eq("id", concept_id);
      return;
    }

    // Output is a single GLB URL (string) or an array — handle both shapes.
    const out = pred.output;
    const glbUrl: string | undefined =
      typeof out === "string" ? out :
      Array.isArray(out) ? (out.find((u: string) => typeof u === "string" && u.endsWith(".glb")) ?? out[0]) :
      undefined;

    if (!glbUrl) {
      console.error("Rodin succeeded but no GLB url:", JSON.stringify(out).slice(0, 500));
      await admin.from("concepts").update({
        preview_mesh_status: "failed",
        preview_mesh_error: "Rodin returned no GLB URL",
      }).eq("id", concept_id);
      return;
    }
    console.log("Rodin output GLB:", glbUrl);

    // 4) Download and re-host in our public bucket so we control caching/expiry.
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
    console.error("runRodinJob error:", e);
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
