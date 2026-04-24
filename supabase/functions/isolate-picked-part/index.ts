/**
 * isolate-picked-part
 *
 * Given a hotspot bbox on a concept render, produces a clean reference image
 * of just that part — used downstream by `render-isolated-part` and
 * `meshify-part`.
 *
 * Pipeline: server-side pixel crop around the bbox (fast, lossless).
 *
 * NOTE: We previously had a second-stage AI "body erasure" pass that
 * redrew the crop with the surrounding car body removed. It was disabled
 * because the redraw subtly altered the part's shape/edges and degraded
 * downstream meshing quality. The raw crop preserves pixel fidelity and
 * Rodin handles depth/back-side inference on its own.
 *
 * Body: { concept_id, part_kind, part_label?, source_image_url, bbox: {x,y,w,h} }
 * Returns: { isolated_url }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // ── Stage 1: server-side pixel crop ────────────────────────────────
    const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
    const srcResp = await fetch(body.source_image_url);
    if (!srcResp.ok) return json({ error: `source fetch ${srcResp.status}` }, 500);
    const srcBuf = new Uint8Array(await srcResp.arrayBuffer());
    const srcImg = await Image.decode(srcBuf);
    const W = srcImg.width;
    const H = srcImg.height;

    // Tight crop (8% pad capped at 1.4x area) — same logic as before.
    const PAD_FRAC = 0.08;
    const MAX_AREA_RATIO = 1.4;
    let padX = Math.max(0.015, w * PAD_FRAC);
    let padY = Math.max(0.015, h * PAD_FRAC);
    const baseArea = Math.max(1e-6, w * h);
    const enforce = (sx: number, sy: number) => (w + 2 * sx) * (h + 2 * sy) / baseArea;
    if (enforce(padX, padY) > MAX_AREA_RATIO) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (enforce(padX * mid, padY * mid) <= MAX_AREA_RATIO) lo = mid; else hi = mid;
      }
      padX *= lo;
      padY *= lo;
    }
    const cx = Math.max(0, x - padX);
    const cy = Math.max(0, y - padY);
    const cw = Math.min(1 - cx, w + padX * 2);
    const ch = Math.min(1 - cy, h + padY * 2);

    const px = Math.max(0, Math.round(cx * W));
    const py = Math.max(0, Math.round(cy * H));
    const pw = Math.max(8, Math.round(cw * W));
    const ph = Math.max(8, Math.round(ch * H));
    const cropped = srcImg.clone().crop(px, py, Math.min(pw, W - px), Math.min(ph, H - py));
    const finalBytes = await cropped.encode();

    const path = `${userId}/${body.concept_id}/picked/${body.part_kind}-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, finalBytes, { contentType: "image/png", upsert: false });
    if (upErr) {
      console.error("isolate-picked-part upload failed:", upErr);
      return json({ error: "Upload failed" }, 500);
    }
    const isolated_url = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    // Sidecar metadata so render-isolated-part knows what was picked.
    const isolated_meta = {
      part_kind: body.part_kind,
      label: body.part_label ?? null,
      source_bbox: { x, y, w, h },
      crop_bbox: { x: cx, y: cy, w: cw, h: ch },
      bbox_in_crop: cw > 0 && ch > 0 ? {
        x: Math.max(0, (x - cx) / cw),
        y: Math.max(0, (y - cy) / ch),
        w: Math.min(1, w / cw),
        h: Math.min(1, h / ch),
      } : { x: 0, y: 0, w: 1, h: 1 },
      body_erased: false,
    };

    const { data: existingRow } = await admin
      .from("concept_parts")
      .select("id")
      .eq("concept_id", body.concept_id)
      .eq("kind", body.part_kind)
      .maybeSingle();

    if (existingRow) {
      await admin.from("concept_parts")
        .update({ isolated_source_url: isolated_url, isolated_meta })
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
        isolated_meta,
      });
    }

    return json({ isolated_url, cached: false, erased: false });
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
