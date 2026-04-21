/**
 * meshify-carbon-kit
 *
 * Reconstructs the entire isolated carbon-fibre body kit (front 3/4, side,
 * rear 3/4, rear carbon-only renders) as a SINGLE combined GLB using
 * Hyper3D Rodin Gen-2 (Ultra) on Replicate.
 *
 * Why one mesh: the AI is bad at deciding "this pixel is the arch, this is
 * the bumper". By exporting the kit as one cohesive mesh and letting the user
 * split it in Fusion / Blender, we sidestep the entire labelling problem.
 *
 * Pixel sizing is preserved by:
 *   1. Sending all 4 carbon renders with the exact same square canvas size
 *      (already enforced by isolate-carbon-bodywork).
 *   2. Optionally snapping the recovered scale to the project's hero STL
 *      bounding box (car length).
 *
 * Two actions:
 *   action: "start"  → kicks off Rodin prediction, persists task id.
 *   action: "status" → polls Replicate. On success, downloads GLB,
 *                      re-hosts it in `concept-renders`, persists URL,
 *                      and updates `carbon_kit_*` columns on the concept.
 *
 * Body: { action, concept_id }
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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RODIN_MODEL = "hyper3d/rodin";

const KIT_PROMPT =
  `Floating disconnected aftermarket aero parts (splitter, canards, side ` +
  `skirts, flared arches, diffuser, rear wing, vents, quarter panels) ` +
  `rendered in matte white clay on a plain grey backdrop. NO car body, ` +
  `NO chassis, NO wheels, NO glass, NO doors, NO roof — parts are NOT ` +
  `attached to a vehicle. Two reference views: SIDE (full silhouette + ` +
  `length) and REAR (wing width + diffuser depth). Reconstruct only the ` +
  `visible white shells in their shown positions. Do NOT invent a car ` +
  `body to bridge gaps. Clean smooth surfaces, sharp edges, flat aero ` +
  `faces, thin-walled shell (~2mm), open-backed where appropriate. No ` +
  `bolts, fasteners or tabs. Parts stay visually distinct for CAD split.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    if (!REPLICATE_API_TOKEN) return json({ error: "REPLICATE_API_TOKEN is not configured" }, 500);

    const body = await req.json().catch(() => ({})) as {
      action?: "start" | "status";
      concept_id?: string;
    };
    const action = body.action ?? "start";
    if (!body.concept_id) return json({ error: "concept_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: concept } = await admin
      .from("concepts")
      .select("*")
      .eq("id", body.concept_id)
      .maybeSingle();
    if (!concept) return json({ error: "Concept not found" }, 404);
    if (concept.user_id !== userId) return json({ error: "Forbidden" }, 403);

    // ─────────── START ───────────
    if (action === "start") {
      // Only send side + rear. Front-3/4 and rear-3/4 each show only PART of the
      // kit (front parts vs rear parts) which confuses Rodin's correspondence
      // solver and made it hallucinate a whole car body to bridge them.
      // Side gives full silhouette + length; rear gives wing width + diffuser depth.
      const carbonUrls = [
        concept.render_side_carbon_url,
        concept.render_rear_carbon_url,
      ].filter((u): u is string => typeof u === "string" && u.length > 0);

      if (carbonUrls.length === 0) {
        return json({
          error: "Side and/or rear carbon renders missing. Toggle 'Carbon only' on this concept first and wait for them to finish.",
        }, 400);
      }

      await admin.from("concepts").update({
        carbon_kit_status: "queued",
        carbon_kit_error: null,
      }).eq("id", concept.id);

      const createResp = await fetch(`https://api.replicate.com/v1/models/${RODIN_MODEL}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: {
            images: carbonUrls,
            prompt: KIT_PROMPT,
          },
        }),
      });
      if (!createResp.ok) {
        const t = await createResp.text();
        await admin.from("concepts").update({
          carbon_kit_status: "failed",
          carbon_kit_error: `Rodin ${createResp.status}: ${t.slice(0, 300)}`,
        }).eq("id", concept.id);
        return json({ error: `Rodin ${createResp.status}: ${t.slice(0, 300)}` }, 500);
      }
      const pred = await createResp.json();
      const taskId: string | undefined = pred.id;
      if (!taskId) return json({ error: "Rodin returned no prediction id" }, 500);

      await admin.from("concepts").update({
        carbon_kit_status: "generating",
        carbon_kit_task_id: taskId,
      }).eq("id", concept.id);

      console.log("meshify-carbon-kit Rodin task created:", taskId);
      return json({ task_id: taskId, status: "generating", progress: 0 });
    }

    // ─────────── STATUS ───────────
    const taskId = (concept as any).carbon_kit_task_id as string | null;
    if (!taskId) return json({ status: concept.carbon_kit_status ?? "idle" });

    const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${taskId}`, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    if (!pollResp.ok) {
      const t = await pollResp.text();
      return json({ error: `Rodin poll ${pollResp.status}: ${t.slice(0, 200)}` }, 500);
    }
    const pred = await pollResp.json();
    const status: string = pred.status;

    if (status === "failed" || status === "canceled") {
      const msg = pred.error || `Rodin status: ${status}`;
      await admin.from("concepts").update({
        carbon_kit_status: "failed",
        carbon_kit_error: String(msg).slice(0, 500),
      }).eq("id", concept.id);
      return json({ status: "failed", error: String(msg).slice(0, 500) });
    }

    if (status !== "succeeded") {
      const fakeProgress = status === "processing" ? 60 : status === "starting" ? 15 : 30;
      return json({ status: "generating", progress: fakeProgress });
    }

    // SUCCEEDED — Rodin output is a GLB url (or array containing one).
    const out = pred.output;
    const glbUrl: string | undefined =
      typeof out === "string" ? out :
      Array.isArray(out) ? (out.find((u: string) => typeof u === "string" && u.endsWith(".glb")) ?? out[0]) :
      undefined;

    if (!glbUrl) {
      await admin.from("concepts").update({
        carbon_kit_status: "failed",
        carbon_kit_error: "Rodin returned no GLB",
      }).eq("id", concept.id);
      return json({ error: "Rodin returned no GLB" }, 500);
    }

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());

    const path = `${userId}/${concept.project_id}/carbon_kit/${concept.id}-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    // Try to recover real-world scale from the project's hero STL bbox
    // (car length in mm). Rodin returns mesh in arbitrary units; this lets us
    // emit a scale_m so the user can rescale on import.
    let scaleM: number | null = null;
    try {
      const { data: project } = await admin
        .from("projects")
        .select("car_id")
        .eq("id", concept.project_id)
        .maybeSingle();
      if (project?.car_id) {
        const { data: car } = await admin
          .from("cars")
          .select("template_id")
          .eq("id", project.car_id)
          .maybeSingle();
        if (car?.template_id) {
          const { data: stl } = await admin
            .from("car_stls")
            .select("bbox_min_mm, bbox_max_mm")
            .eq("car_template_id", car.template_id)
            .maybeSingle();
          const minB = stl?.bbox_min_mm as number[] | null | undefined;
          const maxB = stl?.bbox_max_mm as number[] | null | undefined;
          if (minB && maxB && minB.length === 3 && maxB.length === 3) {
            const lenMm = Math.max(
              maxB[0] - minB[0],
              maxB[1] - minB[1],
              maxB[2] - minB[2],
            );
            if (lenMm > 0) scaleM = lenMm / 1000;
          }
        }
      }
    } catch (e) {
      console.warn("scale recovery failed:", e);
    }

    await admin.from("concepts").update({
      carbon_kit_status: "ready",
      carbon_kit_glb_url: bustedUrl,
      carbon_kit_stl_url: bustedUrl, // GLB doubles as download; STL conversion happens client-side via existing glb-to-stl helper.
      carbon_kit_scale_m: scaleM,
      carbon_kit_error: null,
    }).eq("id", concept.id);

    return json({
      status: "ready",
      progress: 100,
      glb_url: bustedUrl,
      stl_url: bustedUrl,
      scale_m: scaleM,
    });
  } catch (e) {
    console.error("meshify-carbon-kit error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
