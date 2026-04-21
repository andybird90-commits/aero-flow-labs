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
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const RODIN_MODEL = "hyper3d/rodin";

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

    // Server-side guard: body-conforming kinds must go through the Blender
    // geometry worker, not Rodin. Keep this list in sync with
    // src/lib/part-classification.ts.
    const BODY_CONFORMING = new Set([
      "side_scoop", "scoop",
      "front_arch", "rear_arch", "fender_flare", "arch",
      "side_skirt", "skirt",
      "bonnet_vent",
      "front_lip", "lip",
    ]);
    const k = part_kind.toLowerCase().trim();
    const isBodyConforming = BODY_CONFORMING.has(k) ||
      [...BODY_CONFORMING].some((bc) => k.includes(bc));
    if (action === "start" && isBodyConforming) {
      return json({
        error: `Part kind "${part_kind}" is body-conforming and must be fitted via the geometry worker (dispatch-geometry-job), not image-to-3D.`,
      }, 422);
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

      // Kick off Rodin Gen-2 (Ultra) prediction on Replicate.
      // Rodin handles single OR multi-view input via the same `images` param.
      const partLabel = part_kind.replace(/_/g, " ");
      const isMulti = image_urls.length > 1;
      const createResp = await fetch(`https://api.replicate.com/v1/models/${RODIN_MODEL}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            images: image_urls,
            prompt: `A standalone aftermarket automotive ${partLabel} part, clean smooth surfaces, matte clay render, flat panels, sharp edges, no surface noise, thin-walled composite shell construction, approximately 2mm wall thickness, preserve real part depth and section, preserve reverse / inner side from the reference views, open-backed where appropriate, visible edge thickness, no bolt holes, no fasteners, no mounting tabs, no flanges, no brackets — bonded or bolted on after printing, never a solid block, never a paper-thin ribbon`,
          },
        }),
      });
      if (!createResp.ok) {
        const t = await createResp.text();
        console.error("Rodin create failed:", createResp.status, t.slice(0, 500));
        return json({ error: `Rodin ${createResp.status}: ${t.slice(0, 300)}` }, 500);
      }
      const pred = await createResp.json();
      const taskId: string | undefined = pred.id;
      if (!taskId) return json({ error: "Rodin returned no prediction id" }, 500);
      console.log("meshify-part Rodin task created:", taskId, "for", part_kind);
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
      return json({ error: `Rodin poll ${pollResp.status}: ${t.slice(0, 200)}` }, 500);
    }
    const pred = await pollResp.json();
    const status: string = pred.status;
    console.log("meshify-part Rodin poll:", status);

    // Map Replicate statuses → our existing client contract (IN_PROGRESS / SUCCEEDED / FAILED).
    if (status === "failed" || status === "canceled") {
      const msg = pred.error || `Rodin status: ${status}`;
      return json({ status: "FAILED", error: String(msg).slice(0, 500) });
    }

    if (status !== "succeeded") {
      // Replicate doesn't expose granular % progress for this model; fake a
      // gentle ramp so the UI bar moves.
      const fakeProgress = status === "processing" ? 60 : status === "starting" ? 15 : 30;
      return json({ status: "IN_PROGRESS", progress: fakeProgress });
    }

    // SUCCEEDED — Rodin output is a GLB (or array containing one).
    const out = pred.output;
    const glbUrl: string | undefined =
      typeof out === "string" ? out :
      Array.isArray(out) ? (out.find((u: string) => typeof u === "string" && u.endsWith(".glb")) ?? out[0]) :
      undefined;

    if (!glbUrl) {
      console.error("Rodin succeeded but no GLB url:", JSON.stringify(out).slice(0, 500));
      return json({ error: "Rodin returned no GLB" }, 500);
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
