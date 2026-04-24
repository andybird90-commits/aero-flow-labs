/**
 * isolate-white-bodywork
 *
 * Same idea as `isolate-carbon-bodywork` but renders the kit in MATTE WHITE
 * on a plain backdrop. Carbon weave + clearcoat reflections confuse Rodin's
 * shape-from-shading solver (it tries to mesh the reflections as geometry).
 * A flat white "clay" render gives Rodin clean silhouettes and shading
 * gradients, which is what it actually needs to reconstruct the mesh.
 *
 * These white renders are NEVER shown in the UI — they exist purely as
 * input for the meshing step.
 *
 * Body: { concept_id: string }
 * Returns 202; UI does not need to poll — `meshify-carbon-kit` calls this
 * synchronously when it starts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decode as decodeImg, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const WHITE_CANVAS_PX = 1024;
const WHITE_BG_GREY = 0xb4b4b4ff;

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

type AngleKey = "side" | "rear";

const WHITE_PROMPT =
  `Re-render this image as a clean clay-style product photo. Keep ONLY the ` +
  `aftermarket bodywork parts (splitter, canards, side skirts, flared arches, ` +
  `diffuser, rear wing, vents, quarter panels). Erase the painted base car, ` +
  `wheels, tyres, glass, lights, mirrors, ground and background. Render every ` +
  `kept part in MATTE PLAIN WHITE (no carbon weave, no reflections, no clearcoat, ` +
  `no logos, no text). Use soft even studio lighting and a plain medium-grey ` +
  `backdrop. CRITICAL: do NOT move, rotate, rescale or recompose the parts — ` +
  `each part stays at the EXACT same pixel position, size and perspective as the ` +
  `input. Preserve exact silhouette and proportions of every part. Output one ` +
  `clean white-clay product photograph of the kit only.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { concept_id?: string; sync?: boolean };
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

    // Source from the original concept renders (NOT the carbon ones) — the
    // carbon renders have already had bodywork erased so they're sparser; the
    // originals carry the full scene context the model needs to extract clean
    // white silhouettes from.
    const todo: Array<{ key: AngleKey; url: string }> = [];
    if (concept.render_side_url)  todo.push({ key: "side", url: concept.render_side_url });
    if (concept.render_rear_url)  todo.push({ key: "rear", url: concept.render_rear_url });
    if (todo.length === 0) {
      return json({ error: "Concept has no side/rear renders to isolate." }, 400);
    }

    // Always run synchronously — meshify-carbon-kit waits for the URLs.
    const results = await Promise.all(todo.map(async (a) => {
      const isolated = await isolateOne(a.url);
      if (!isolated) return { key: a.key, url: null as string | null };
      const path = `${userRes.user!.id}/${concept.id}/white_${a.key}_${crypto.randomUUID().slice(0, 8)}.png`;
      const { error: upErr } = await admin.storage
        .from("concept-renders")
        .upload(path, isolated.bytes, { contentType: "image/png", upsert: false });
      if (upErr) {
        console.error(`white upload failed (${a.key}):`, upErr);
        return { key: a.key, url: null };
      }
      const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
      return { key: a.key, url: publicUrl };
    }));

    const out: Record<AngleKey, string | null> = { side: null, rear: null };
    for (const r of results) out[r.key] = r.url;

    if (!out.side && !out.rear) {
      return json({ error: "All white isolations failed." }, 500);
    }

    return json({ side_url: out.side, rear_url: out.rear });
  } catch (e) {
    console.error("isolate-white-bodywork error:", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

async function isolateOne(sourceUrl: string): Promise<{ bytes: Uint8Array } | null> {
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
          { type: "text", text: WHITE_PROMPT },
          { type: "image_url", image_url: { url: sourceUrl } },
        ],
      }],
    }),
  });

  if (!aiResp.ok) {
    const t = await aiResp.text();
    console.error("white-isolate AI failed:", aiResp.status, t.slice(0, 200));
    return null;
  }
  const aiJson = await aiResp.json().catch(() => null);
  const imgUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUrl?.startsWith("data:image/")) {
    console.error("white-isolate produced no data URL");
    return null;
  }
  const m = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));

  try {
    const padded = await padToSquareCanvas(bytes, WHITE_CANVAS_PX);
    return { bytes: padded };
  } catch (e) {
    console.warn("white canvas padding failed, using raw:", e);
    return { bytes };
  }
}

async function padToSquareCanvas(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const decoded = await decodeImg(bytes);
  const src = decoded as unknown as Image;
  const scale = Math.min(size / src.width, size / src.height);
  const tw = Math.max(1, Math.round(src.width * scale));
  const th = Math.max(1, Math.round(src.height * scale));
  const resized = src.clone().resize(tw, th);
  const canvas = new Image(size, size);
  canvas.fill(WHITE_BG_GREY);
  canvas.composite(resized, Math.floor((size - tw) / 2), Math.floor((size - th) / 2));
  return await canvas.encode();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
