/**
 * isolate-carbon-bodywork
 *
 * Takes the existing concept renders (front 3/4, side, rear 3/4, rear) and
 * uses the Lovable AI image model to strip the base car and background away,
 * leaving ONLY the aftermarket carbon-fibre bodywork on a clean studio
 * backdrop. The result is uploaded back to the `concept-renders` bucket and
 * persisted alongside the originals on the same `concepts` row.
 *
 * Body: { concept_id: string }
 * Returns 202 immediately; the actual generation runs in the background and
 * the UI polls `concepts.carbon_status`.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decode as decodeImg, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

/**
 * Target canvas size for every isolated carbon view. All four views are
 * padded onto an identical NxN canvas so the inter-view scale ratio is
 * preserved when fed into the multi-view mesh reconstructor (Rodin Gen-2).
 */
const CARBON_CANVAS_PX = 1536;
const CARBON_BG_GREY = 0xb4b4b4ff; // medium grey, matches isolation prompt

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type AngleKey = "front" | "side" | "rear34" | "rear";

const ISOLATION_PROMPT =
  `This is a photo of a custom car. Your task is a SURGICAL ERASE — keep the ` +
  `aftermarket carbon-fibre bodywork visible at the EXACT same pixel coordinates, ` +
  `same scale, same camera angle and same perspective; remove everything else. ` +
  `\n\nKEEP (do not move, do not redraw, do not restyle):\n` +
  `• Front splitter, lip, canards, dive planes\n` +
  `• Front bumper carbon panels, hood vents/scoops if carbon\n` +
  `• Carbon fender flares / arch extensions\n` +
  `• Side skirts, side strakes\n` +
  `• Rear diffuser, rear bumper carbon panels\n` +
  `• Rear wing, swan-neck stays, end-plates, gurney\n` +
  `• Ducktail, rear deck carbon panels\n` +
  `• Any other carbon-fibre bolt-on parts\n\n` +
  `ERASE (replace with clean medium-grey studio backdrop):\n` +
  `• The painted base car body, doors, roof, A/B/C-pillars\n` +
  `• Wheels, tyres, brake calipers\n` +
  `• Glass, headlights, tail lights, mirrors, badges\n` +
  `• Ground, road, shadow on ground, environment, background\n\n` +
  `CRITICAL POSITIONING RULES:\n` +
  `• Each carbon part MUST stay at the EXACT same pixel position and pixel size as ` +
  `  in the input. The kit must look like it is still floating in the air at the ` +
  `  spot where it was bolted to the car.\n` +
  `• Do NOT centre, recompose, re-frame, zoom, crop, or rescale.\n` +
  `• Do NOT collapse the parts toward the middle of the canvas.\n` +
  `• Camera angle, perspective foreshortening, and lens look stay identical.\n` +
  `• Preserve the carbon weave direction, twill pattern, and clearcoat reflections ` +
  `  exactly as they appear in the input.\n\n` +
  `OUTPUT: a single product photograph of the carbon kit only, parts in their ` +
  `original on-car positions, on a clean medium-grey studio backdrop with soft ` +
  `even product lighting and a subtle ground shadow under each part. ` +
  `No car body, no wheels, no glass, no background, no text, no watermark.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { concept_id?: string };
    if (!body.concept_id) return json({ error: "concept_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: concept } = await admin
      .from("concepts").select("*").eq("id", body.concept_id).maybeSingle();
    if (!concept) return json({ error: "concept not found" }, 404);
    if (concept.user_id !== userRes.user.id) return json({ error: "Forbidden" }, 403);

    const angleSources: Array<{ key: AngleKey; url: string | null; col: string }> = [
      { key: "front",  url: concept.render_front_url,   col: "render_front_carbon_url" },
      { key: "side",   url: concept.render_side_url,    col: "render_side_carbon_url" },
      { key: "rear34", url: concept.render_rear34_url,  col: "render_rear34_carbon_url" },
      { key: "rear",   url: concept.render_rear_url,    col: "render_rear_carbon_url" },
    ];
    const todo = angleSources.filter((a) => !!a.url);
    if (todo.length === 0) {
      return json({ error: "Concept has no renders to isolate." }, 400);
    }

    await admin.from("concepts").update({
      carbon_status: "generating",
      carbon_error: null,
    }).eq("id", concept.id);

    EdgeRuntime.waitUntil(runIsolation({
      conceptId: concept.id,
      userId: userRes.user.id,
      todo,
    }));

    return json({ started: true, concept_id: concept.id, status: "generating" }, 202);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

async function runIsolation(args: {
  conceptId: string;
  userId: string;
  todo: Array<{ key: AngleKey; url: string | null; col: string }>;
}) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    // Fan out all angles in parallel — same pattern that fixed
    // WORKER_RESOURCE_LIMIT in generate-concepts.
    const results = await Promise.all(args.todo.map(async (a) => {
      const isolated = await isolateOne(a.url!);
      if (!isolated) return { col: a.col, url: null as string | null };

      const path = `${args.userId}/${args.conceptId}/carbon_${a.key}_${crypto.randomUUID().slice(0, 8)}.${isolated.ext}`;
      const { error: upErr } = await admin.storage
        .from("concept-renders")
        .upload(path, isolated.bytes, { contentType: isolated.mime, upsert: false });
      if (upErr) {
        console.error(`carbon upload failed (${a.key}):`, upErr);
        return { col: a.col, url: null };
      }
      const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
      return { col: a.col, url: publicUrl };
    }));

    const update: Record<string, string | null> = {};
    let any = false;
    for (const r of results) {
      if (r.url) {
        update[r.col] = r.url;
        any = true;
      }
    }

    if (!any) {
      await admin.from("concepts").update({
        carbon_status: "failed",
        carbon_error: "All angles failed to isolate.",
      }).eq("id", args.conceptId);
      return;
    }

    update.carbon_status = "ready";
    update.carbon_error = null;
    await admin.from("concepts").update(update).eq("id", args.conceptId);
  } catch (e) {
    console.error("isolate-carbon-bodywork background error:", e);
    await admin.from("concepts").update({
      carbon_status: "failed",
      carbon_error: String((e as Error).message ?? e),
    }).eq("id", args.conceptId);
  }
}

async function isolateOne(sourceUrl: string): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image-preview",
      modalities: ["image", "text"],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: ISOLATION_PROMPT },
          { type: "image_url", image_url: { url: sourceUrl } },
        ],
      }],
    }),
  });

  if (!aiResp.ok) {
    const t = await aiResp.text();
    console.error("isolate AI failed:", aiResp.status, t.slice(0, 200));
    return null;
  }
  const aiJson = await aiResp.json().catch(() => null);
  const imgUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUrl?.startsWith("data:image/")) {
    console.error("isolate produced no data URL");
    return null;
  }
  const m = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ext = mime.includes("jpeg") ? "jpg" : "png";

  // Pad/letterbox onto a uniform NxN grey canvas so all four carbon views
  // share the exact same pixel scale before they hit Rodin. This is what
  // keeps the kit's inter-view proportions truthful when reconstructed.
  try {
    const padded = await padToSquareCanvas(bytes, CARBON_CANVAS_PX);
    return { bytes: padded, mime: "image/png", ext: "png" };
  } catch (e) {
    console.warn("carbon canvas padding failed, using raw output:", e);
    return { bytes, mime, ext };
  }
}

/** Letterbox a PNG/JPG onto a square `size` canvas with neutral grey backdrop. */
async function padToSquareCanvas(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const decoded = await decodeImg(bytes);
  // imagescript returns Image | GIF — for our purposes we coerce to Image.
  const src = decoded as unknown as Image;
  const sw = src.width;
  const sh = src.height;
  const scale = Math.min(size / sw, size / sh);
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  const resized = src.clone().resize(tw, th);
  const canvas = new Image(size, size);
  canvas.fill(CARBON_BG_GREY);
  const dx = Math.floor((size - tw) / 2);
  const dy = Math.floor((size - th) / 2);
  canvas.composite(resized, dx, dy);
  return await canvas.encode();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
