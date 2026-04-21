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

    // ── Deterministic server-side crop, no AI restyling ─────────────────
    // We deliberately do NOT run an AI cleanup pass — the model will
    // "tidy up" the part (smooth edges, redraw arches as symmetric arcs,
    // drop the skirt extension) and the on-car geometry no longer matches.
    // The downstream `render-isolated-part` already redraws the part on a
    // clean backdrop using this crop as reference, so a faithful pixel crop
    // is what gives the best fidelity.
    const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
    const srcResp = await fetch(body.source_image_url);
    if (!srcResp.ok) return json({ error: `source fetch ${srcResp.status}` }, 500);
    const srcBuf = new Uint8Array(await srcResp.arrayBuffer());
    const srcImg = await Image.decode(srcBuf);
    const W = srcImg.width;
    const H = srcImg.height;

    // Pad generously (30%) so we keep mounting tabs, vents, skirt extensions
    // and any fairing that blends the part into adjacent bodywork. The
    // downstream renderer needs that context to draw the part correctly.
    const padX = Math.max(0.06, w * 0.30);
    const padY = Math.max(0.06, h * 0.30);
    const cx = Math.max(0, x - padX);
    const cy = Math.max(0, y - padY);
    const cw = Math.min(1 - cx, w + padX * 2);
    const ch = Math.min(1 - cy, h + padY * 2);

    const px = Math.max(0, Math.round(cx * W));
    const py = Math.max(0, Math.round(cy * H));
    const pw = Math.max(8, Math.round(cw * W));
    const ph = Math.max(8, Math.round(ch * H));
    const cropped = srcImg.clone().crop(px, py, Math.min(pw, W - px), Math.min(ph, H - py));
    const bytes = await cropped.encode();
    const mime = "image/png";
    const ext = "png";

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
