/**
 * isolate-picked-part
 *
 * Given a hotspot bbox on a concept render, asks Gemini Flash Image to keep
 * ONLY that one part and replace the rest of the car with a clean studio
 * backdrop. The cleaned crop becomes the sole reference image for downstream
 * `render-isolated-part` and `meshify-part` calls, so those models don't get
 * confused by surrounding bodywork.
 *
 * Body: { concept_id, part_kind, part_label?, source_image_url, bbox: {x,y,w,h} }
 * Returns: { isolated_url } — also cached on concept_parts.isolated_source_url
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

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

interface Bbox { x: number; y: number; w: number; h: number }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      concept_id?: string;
      part_kind?: string;
      part_label?: string;
      source_image_url?: string;
      bbox?: Bbox;
      force?: boolean;
    };
    if (!body.concept_id || !body.part_kind || !body.source_image_url || !body.bbox) {
      return json({ error: "concept_id, part_kind, source_image_url, bbox required" }, 400);
    }
    const { x, y, w, h } = body.bbox;
    if ([x, y, w, h].some((v) => typeof v !== "number" || !isFinite(v))) {
      return json({ error: "bbox must be numeric {x,y,w,h}" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: concept } = await admin
      .from("concepts").select("id, user_id, project_id").eq("id", body.concept_id).maybeSingle();
    if (!concept) return json({ error: "concept not found" }, 404);
    if (concept.user_id !== userId) return json({ error: "Forbidden" }, 403);

    // Cache hit?
    if (!body.force) {
      const { data: existing } = await admin
        .from("concept_parts")
        .select("isolated_source_url")
        .eq("concept_id", body.concept_id)
        .eq("kind", body.part_kind)
        .maybeSingle();
      if (existing?.isolated_source_url) {
        return json({ isolated_url: existing.isolated_source_url, cached: true });
      }
    }

    const label = body.part_label || body.part_kind.replace(/[_-]+/g, " ");
    const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
    const prompt =
      `Keep ONLY the ${label} located in the highlighted region of this image ` +
      `(roughly ${pct(x)}% from the left, ${pct(y)}% from the top, ` +
      `${pct(w)}% wide, ${pct(h)}% tall). ` +
      `Completely ERASE everything else — the rest of the car body, other carbon parts, ` +
      `wheels, tyres, glass, lights, mirrors, ground and the entire background. ` +
      `Replace them with a clean medium-grey studio backdrop with soft, even product lighting ` +
      `and a subtle ground shadow under the part. ` +
      `Preserve the EXACT silhouette, proportions, mounting tabs, vents, weave direction and ` +
      `surface curvature of the kept part — do not redesign, restyle or smooth it. ` +
      `Output a single product-style render of just the ${label}. ` +
      `No car body, no wheels, no background, no text, no watermark.`;

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
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: body.source_image_url } },
          ],
        }],
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      const status = aiResp.status;
      if (status === 429) return json({ error: "Rate limited — try again in a moment." }, 429);
      if (status === 402) return json({ error: "AI credits exhausted — top up to continue." }, 402);
      console.error("isolate-picked-part AI failed:", status, t.slice(0, 200));
      return json({ error: `AI gateway ${status}` }, 500);
    }
    const aiJson = await aiResp.json().catch(() => null);
    const imgUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imgUrl?.startsWith("data:image/")) {
      return json({ error: "Isolation produced no image" }, 500);
    }
    const m = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
    if (!m) return json({ error: "Bad image data URL" }, 500);
    const mime = m[1];
    const b64 = m[2];
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ext = mime.includes("jpeg") ? "jpg" : "png";

    const path = `${userId}/${body.concept_id}/picked/${body.part_kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      console.error("isolate-picked-part upload failed:", upErr);
      return json({ error: "Upload failed" }, 500);
    }
    const isolated_url = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    // Upsert onto concept_parts so it's cached for next time. We don't always
    // have a row yet (created later by render-isolated-part), so insert a stub.
    const { data: existingRow } = await admin
      .from("concept_parts")
      .select("id")
      .eq("concept_id", body.concept_id)
      .eq("kind", body.part_kind)
      .maybeSingle();

    if (existingRow) {
      await admin.from("concept_parts")
        .update({ isolated_source_url: isolated_url })
        .eq("id", existingRow.id);
    } else {
      await admin.from("concept_parts").insert({
        user_id: userId,
        project_id: concept.project_id,
        concept_id: body.concept_id,
        kind: body.part_kind,
        label: body.part_label ?? null,
        source: "extracted",
        render_urls: [],
        isolated_source_url: isolated_url,
      });
    }

    return json({ isolated_url, cached: false });
  } catch (e) {
    console.error("isolate-picked-part fatal:", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
