/**
 * isolate-picked-part
 *
 * Given a hotspot bbox on a concept render, produces a clean reference image
 * of just that part on a neutral backdrop — used downstream by
 * `render-isolated-part` and `meshify-part`.
 *
 * Two-stage pipeline:
 *   1. Server-side pixel crop around the bbox (fast, lossless).
 *   2. For BODY-INTEGRATED parts (arches, skirts, lips, splitter, canards,
 *      vents) — also run a Gemini Image pass that *redraws* the crop with
 *      the surrounding car body removed. Standalone parts (diffuser, wing,
 *      ducktail) skip stage 2 because the raw crop already shows the part
 *      against a clean background.
 *
 * The body-erasure step is what made the diffuser flow work so well — the
 * meshing model only ever saw the diffuser silhouette, never the bumper
 * around it. We now apply the same trick to the parts that previously
 * failed because their bbox always included a chunk of bodywork.
 *
 * Body: { concept_id, part_kind, part_label?, source_image_url, bbox: {x,y,w,h} }
 * Returns: { isolated_url, erased: boolean }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { lovableGenerateImageWithFallback } from "../_shared/lovable-image.ts";

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

/**
 * Parts that are visually fused into the bodywork — their hotspot crop
 * always contains a lot of car body, which contaminates downstream meshing.
 * We run an AI body-erasure pass on these.
 *
 * Standalone parts (diffuser, wing, ducktail) are NOT in this list because
 * the cropped pixels already isolate them well enough.
 */
const BODY_INTEGRATED_PARTS = new Set<string>([
  "splitter",
  "lip",
  "canard",
  "side_skirt",
  "wide_arch",
  "front_arch",
  "rear_arch",
  "bonnet_vent",
  "wing_vent",
]);

/**
 * Per-kind erasure prompts.
 *
 * IMPORTANT — what the model must NOT do:
 *   1. Do NOT invent a back surface, interior, or any geometry that wasn't
 *      visible in the source. The output is a flat cutout from one viewing
 *      angle, like a sticker. Downstream Rodin handles the 3D inference.
 *   2. Do NOT delete pieces of the target part that are partially OVERLAPPED
 *      by other parts (e.g. canards covering an arch). Treat the overlapped
 *      region as part of the target — fill in the implied curve/edge so the
 *      target's silhouette stays continuous.
 *   3. Do NOT rotate, mirror, restyle, smooth or "clean up" the part. Pixels
 *      stay where they were; only the surrounding bodywork changes.
 *
 * Backdrop matches our concept renders (neutral light grey) so downstream
 * stages see a familiar input distribution.
 */
const ERASE_RULES =
  "STRICT RULES:\n" +
  "• Output a FLAT 2D CUTOUT from the SAME viewing angle as the source. Do NOT add a back side, interior, underside, or any new angle of the part.\n" +
  "• If another part (e.g. a canard, mirror, badge) overlaps the target, RECONSTRUCT the missing edge of the target so its silhouette is unbroken — do NOT punch a hole where the overlap was.\n" +
  "• Pixels of the target part stay in their original position, scale and orientation. No rotation, no mirroring, no perspective change.\n" +
  "• Do NOT smooth, simplify, symmetrise, restyle or re-light the part. Keep its exact surface detail, shadows and material.\n" +
  "• Replace ONLY the surrounding car body, wheels, tyres, ground and background with a clean neutral light-grey studio backdrop (#E5E5E5, smooth, faint contact shadow under the part only).\n" +
  "• No logos, watermarks, text, additional lights or reflections.";

const ERASURE_PROMPT: Record<string, string> = {
  splitter:
    "Target part: FRONT SPLITTER — the flat horizontal aero blade under the bumper.",
  lip:
    "Target part: FRONT LIP — the thin curved lip protruding under the front bumper.",
  canard:
    "Target part: CANARDS — small angled aero fins on the front bumper corner.",
  side_skirt:
    "Target part: SIDE SKIRT — the aero panel running along the bottom of the doors.",
  wide_arch:
    "Target part: FENDER FLARE / WIDE ARCH — the bulged arch lip that surrounds the wheel. " +
    "Keep the FULL arch, including any section that other parts (e.g. canards, side skirts, mirrors) sit in front of.",
  front_arch:
    "Target part: FRONT FENDER FLARE — the bulged arch lip around the front wheel. " +
    "Keep the FULL arch even if canards, side skirts or mirrors overlap it — reconstruct the implied edge.",
  rear_arch:
    "Target part: REAR FENDER FLARE — the bulged arch lip around the rear wheel. " +
    "Keep the FULL arch even if side skirts, ducktails or exhaust tips overlap it — reconstruct the implied edge.",
  bonnet_vent:
    "Target part: BONNET VENT — the louvred opening or scoop cut into the hood.",
  wing_vent:
    "Target part: WING VENT — the louvred vent on the front fender behind the wheel.",
};

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
      /** Skip the AI body-erasure step even for body-integrated parts. Useful
       *  if the user wants the pure crop (e.g. for debugging). */
      skip_erase?: boolean;
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
    const cropBytes = await cropped.encode();

    // Default: the cropped pixels become the isolated image.
    let finalBytes = cropBytes;
    let erased = false;

    // ── Stage 2: AI body erasure (body-integrated parts only) ──────────
    const wantsErase =
      !body.skip_erase &&
      BODY_INTEGRATED_PARTS.has(body.part_kind) &&
      ERASURE_PROMPT[body.part_kind];

    if (wantsErase) {
      // Encode crop as data URL so Gemini Image can use it as a reference.
      const cropDataUrl = `data:image/png;base64,${bytesToBase64(cropBytes)}`;
      const partLabel = body.part_label || body.part_kind.replace(/[_-]+/g, " ");

      const prompt =
        `Edit this image to ISOLATE one car body part on a clean backdrop. ` +
        `The output is a SINGLE-VIEW reference image — downstream 3D software handles depth and back-side inference, ` +
        `so you MUST NOT invent a back surface, interior, underside, or any new angle of the part. ` +
        `Treat your output like a flat sticker cut from the source photo.\n\n` +
        `${ERASURE_PROMPT[body.part_kind]}\n\n` +
        `${ERASE_RULES}\n\n` +
        `(Target part name for reference: ${partLabel}.)`;

      const erase = await lovableGenerateImageWithFallback({
        apiKey: LOVABLE_API_KEY,
        prompt,
        referenceImages: [cropDataUrl],
      });

      if (erase.ok && erase.dataUrl) {
        // Decode the data URL back to bytes for storage upload.
        const m = erase.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (m) {
          finalBytes = base64ToBytes(m[1]);
          erased = true;
        }
      } else if (erase.status === 429 || erase.status === 402) {
        // Rate-limit / credits exhausted — fall through with raw crop and
        // surface a soft warning so the UI can show a toast.
        console.warn("isolate-picked-part erase skipped:", erase.status, erase.error);
      } else {
        console.warn("isolate-picked-part erase failed, using raw crop:", erase.status, erase.error);
      }
    }

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
    // bbox_in_crop is no longer meaningful when we erased the body (the
    // part now fills the frame), so we report (0,0,1,1) in that case.
    const isolated_meta = {
      part_kind: body.part_kind,
      label: body.part_label ?? null,
      source_bbox: { x, y, w, h },
      crop_bbox: { x: cx, y: cy, w: cw, h: ch },
      bbox_in_crop: erased
        ? { x: 0, y: 0, w: 1, h: 1 }
        : (cw > 0 && ch > 0 ? {
            x: Math.max(0, (x - cx) / cw),
            y: Math.max(0, (y - cy) / ch),
            w: Math.min(1, w / cw),
            h: Math.min(1, h / ch),
          } : { x: 0, y: 0, w: 1, h: 1 }),
      body_erased: erased,
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

    return json({ isolated_url, cached: false, erased });
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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
