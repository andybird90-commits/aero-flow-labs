/**
 * meshify-part
 *
 * Async wrapper around Hyper3D Rodin Gen-2 (Ultra) via Replicate to convert
 * the isolated part renders into a clean 3D STL. We previously used Meshy
 * but its output had heavy high-frequency surface noise on what should be
 * flat panels (visible lumpy fins on diffusers, bumpy splitter edges).
 *
 * Two actions:
 *   action: "start"  → kicks off Rodin prediction, returns { task_id }
 *   action: "status" → polls Replicate. If succeeded, downloads GLB → converts
 *                      to STL → re-hosts in our bucket → returns { status, stl_url }.
 *                      Otherwise returns { status, progress }.
 *
 * Body:
 *   { action: "start",  concept_id, part_kind, image_urls }
 *   { action: "status", concept_id, part_kind, task_id }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MESH_MODEL = "tencent/hunyuan3d-2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    if (!REPLICATE_API_TOKEN) return json({ error: "REPLICATE_API_TOKEN is not configured" }, 500);

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

    // NOTE: Body-conforming parts (arches, skirts, scoops, lips) used to be
    // blocked here and routed straight to the Blender worker. We now mesh them
    // with Rodin first to produce a 3D template, then hand THAT template to
    // Blender for fitting. Order: Isolated → Extracted → 3D modelled → Blendered.

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

      // Hunyuan3D-2 takes a SINGLE image. Use the first render (best view).
      const isMulti = image_urls.length > 1;
      const primaryImage = image_urls[0];

      const createResp = await fetch(`https://api.replicate.com/v1/models/${MESH_MODEL}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            image: primaryImage,
            steps: 50,
            guidance_scale: 5.5,
            octree_resolution: 256,
            remove_background: true,
            seed: 1234,
          },
        }),
      });
      if (!createResp.ok) {
        const t = await createResp.text();
        console.error("Hunyuan3D create failed:", createResp.status, t.slice(0, 500));
        return json({ error: `Hunyuan3D ${createResp.status}: ${t.slice(0, 300)}` }, 500);
      }
      const pred = await createResp.json();
      const taskId: string | undefined = pred.id;
      if (!taskId) return json({ error: "Hunyuan3D returned no prediction id" }, 500);
      console.log("meshify-part Hunyuan3D task created:", taskId, "for", part_kind);
      return json({ task_id: taskId, status: "IN_PROGRESS", progress: 0, is_multi: isMulti });
    }

    // ─────────── STATUS ───────────
    const taskId = body.task_id;
    if (!taskId) return json({ error: "task_id required for status" }, 400);

    const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${taskId}`, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    if (!pollResp.ok) {
      const t = await pollResp.text();
      return json({ error: `Hunyuan3D poll ${pollResp.status}: ${t.slice(0, 200)}` }, 500);
    }
    const pred = await pollResp.json();
    const status: string = pred.status;
    console.log("meshify-part Hunyuan3D poll:", status);

    if (status === "failed" || status === "canceled") {
      const msg = pred.error || `Hunyuan3D status: ${status}`;
      return json({ status: "FAILED", error: String(msg).slice(0, 500) });
    }

    if (status !== "succeeded") {
      const fakeProgress = status === "processing" ? 60 : status === "starting" ? 15 : 30;
      return json({ status: "IN_PROGRESS", progress: fakeProgress });
    }

    // SUCCEEDED — Hunyuan3D-2 output is a GLB url (string, or array containing one).
    const out = pred.output;
    const glbUrl: string | undefined =
      typeof out === "string" ? out :
      Array.isArray(out) ? (out.find((u: string) => typeof u === "string" && (u.endsWith(".glb") || u.endsWith(".obj"))) ?? out[0]) :
      (out?.mesh ?? out?.glb ?? undefined);

    if (!glbUrl) {
      console.error("Hunyuan3D succeeded but no GLB url:", JSON.stringify(out).slice(0, 500));
      return json({ error: "Hunyuan3D returned no mesh" }, 500);
    }

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());

    // Store the GLB directly. The viewer + downstream pipeline already
    // accept GLB via the `glb_url` column. We skip STL conversion server-side
    // because Rodin output is already clean — no Laplacian smoothing needed.
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
