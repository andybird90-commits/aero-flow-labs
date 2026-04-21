/**
 * build-prototype-reference-from-mask
 *
 * Replaces the AI "guess what's the part" isolation with a deterministic step
 * driven by the user's painted mask:
 *
 *   1. Fetch source photo + mask PNG
 *   2. Crop both to the mask's bounding box (with padding)
 *   3. Composite the cropped source onto a clean white background using the
 *      mask as alpha (so non-part pixels become white)
 *   4. Optional: a single Lovable AI cleanup pass that is *only* allowed to
 *      adjust pixels INSIDE the masked region (dirt/dust/decals), and is
 *      forbidden from extending the silhouette. The mask is passed as a
 *      reference image so the model can see the boundary.
 *   5. Upload to concept-renders, set prototypes.isolated_ref_urls
 *
 * Body: { prototype_id: string, cleanup?: boolean }
 *
 * The result becomes the source of truth for downstream fit + clay + mesh —
 * because it actually came from the user's real pixels, not a hallucination.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { decode as decodePng, encode as encodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";
import { lovableGenerateImageWithFallback } from "../_shared/lovable-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PADDING_RATIO = 0.06; // 6% padding around the bbox
const TARGET_LONG_EDGE = 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prototype_id, cleanup } = (await req.json()) as { prototype_id?: string; cleanup?: boolean };
    if (!prototype_id) return json({ error: "prototype_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: proto, error: protoErr } = await admin
      .from("prototypes")
      .select("id, user_id, title, notes, placement_hint, source_image_urls, source_mask_urls, primary_source_index")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    const sources = ((proto as any).source_image_urls as string[] | null) ?? [];
    const masks = ((proto as any).source_mask_urls as Array<{ source_index: number; url: string }> | null) ?? [];
    const idx = (proto as any).primary_source_index ?? 0;
    const sourceUrl = sources[idx];
    const maskEntry = masks.find((m) => m?.source_index === idx);
    if (!sourceUrl || !maskEntry?.url) {
      return json({ error: "No mask saved for this prototype yet — paint one first." }, 400);
    }

    await admin.from("prototypes").update({
      reference_status: "processing",
      reference_error: null,
    }).eq("id", prototype_id);

    // Fetch + decode source + mask
    const [srcBytes, maskBytes] = await Promise.all([fetchBytes(sourceUrl), fetchBytes(maskEntry.url)]);
    if (!srcBytes || !maskBytes) {
      await fail(admin, prototype_id, "Could not load source or mask image");
      return json({ error: "Could not load source or mask image" }, 500);
    }

    let sourceImg: DecodedImage;
    let maskImg: DecodedImage;
    try {
      sourceImg = await decodeAnyImage(srcBytes);
      maskImg = decodePngBytes(maskBytes);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await fail(admin, prototype_id, `Decode failed: ${msg}`);
      return json({ error: `Decode failed: ${msg}` }, 500);
    }

    // Resize mask to source dims (in case the canvas saved at a slightly different size).
    if (maskImg.width !== sourceImg.width || maskImg.height !== sourceImg.height) {
      maskImg = nearestResize(maskImg, sourceImg.width, sourceImg.height);
    }

    // Compute bounding box of painted mask
    const bbox = maskBoundingBox(maskImg);
    if (!bbox) {
      await fail(admin, prototype_id, "Mask is empty — paint the part first.");
      return json({ error: "Mask is empty — paint the part first." }, 400);
    }
    const padX = Math.round((bbox.x1 - bbox.x0) * PADDING_RATIO + 8);
    const padY = Math.round((bbox.y1 - bbox.y0) * PADDING_RATIO + 8);
    const x0 = Math.max(0, bbox.x0 - padX);
    const y0 = Math.max(0, bbox.y0 - padY);
    const x1 = Math.min(sourceImg.width, bbox.x1 + padX);
    const y1 = Math.min(sourceImg.height, bbox.y1 + padY);
    const cropW = x1 - x0;
    const cropH = y1 - y0;

    // Composite: mask source onto white inside the crop window
    const composite = compositeOnWhite(sourceImg, maskImg, x0, y0, cropW, cropH);

    // Resize so long edge ~ TARGET_LONG_EDGE for a cleaner output
    const longEdge = Math.max(composite.width, composite.height);
    const scale = longEdge > TARGET_LONG_EDGE ? TARGET_LONG_EDGE / longEdge : 1;
    const finalImg = scale === 1 ? composite : bilinearResize(composite, Math.round(composite.width * scale), Math.round(composite.height * scale));

    const compositePng = encodePng(finalImg.data, finalImg.width, finalImg.height);
    const compositeDataUrl = `data:image/png;base64,${bytesToBase64(compositePng)}`;

    let finalDataUrl = compositeDataUrl;

    // Optional AI cleanup pass — strictly inside the mask boundary.
    if (cleanup !== false) {
      const description = [((proto as any).title ?? "").toString().trim(), ((proto as any).notes ?? "").toString().trim()]
        .filter(Boolean).join(" — ") || "an aftermarket aero part";
      const placement = ((proto as any).placement_hint ?? "").toString().trim();

      const prompt = [
        `The FIRST attached image is the EXACT part silhouette — pre-cropped from the user's photo using a hand-painted mask. The white background pixels are NOT part of the object.`,
        `Part description: ${description}.`,
        placement ? `Placement on car: ${placement}.` : ``,
        ``,
        `TASK: Output a clean photoreal product photograph of EXACTLY THE SAME silhouette and shape as image 1.`,
        ``,
        `HARD RULES:`,
        `- DO NOT change the outline, silhouette, proportions, or boundary in any way. The exact shape from image 1 is the ground truth.`,
        `- DO NOT extend, grow, shrink, or smooth the silhouette. Trace it exactly.`,
        `- DO NOT add anything outside the original masked area: no host-car bodywork, no bumper, no grille, no hands, no other objects.`,
        `- ONLY clean up artefacts INSIDE the silhouette: remove dirt, dust, glare, decals, badges, embossed text, brand marks, stickers, scratches, mounting bolts, screws, fasteners, brackets and hardware.`,
        `- Keep the real material if obvious (carbon fibre weave, painted, fibreglass, plastic).`,
        `- Background must remain pure white seamless studio. Soft even lighting. Subtle ground contact shadow.`,
        `- No labels, annotations, text, watermarks or split-screen.`,
        ``,
        `Output: ONE clean isolated photoreal product shot — same silhouette as image 1, just cleaned up inside.`,
      ].filter(Boolean).join("\n");

      const result = await lovableGenerateImageWithFallback({
        apiKey: LOVABLE_API_KEY,
        prompt,
        referenceImages: [compositeDataUrl],
      });
      if (result.ok && result.dataUrl) {
        finalDataUrl = result.dataUrl;
      } else {
        console.warn("cleanup pass failed, using raw composite:", result.error);
      }
    }

    const m = finalDataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!m) {
      await fail(admin, prototype_id, "bad image format");
      return json({ error: "bad image" }, 500);
    }
    const outMime = m[1];
    const outBytes = base64ToBytes(m[2]);
    const ext = outMime.includes("png") ? "png" : "jpg";
    const outPath = `${userId}/prototypes/${prototype_id}/isolated-mask-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("concept-renders").upload(outPath, outBytes, {
      contentType: outMime, upsert: true,
    });
    if (upErr) {
      await fail(admin, prototype_id, `Upload failed: ${upErr.message}`);
      return json({ error: `Upload failed: ${upErr.message}` }, 500);
    }
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(outPath).data.publicUrl;

    await admin.from("prototypes").update({
      reference_status: "ready",
      reference_error: null,
      isolated_ref_urls: [publicUrl],
    }).eq("id", prototype_id);

    return json({ url: publicUrl, bbox });
  } catch (e) {
    console.error("build-prototype-reference-from-mask error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

/* ───────── helpers ───────── */

interface DecodedImage { width: number; height: number; data: Uint8Array }

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    console.warn("fetchBytes failed", url, e);
    return null;
  }
}

function decodePngBytes(bytes: Uint8Array): DecodedImage {
  const img = decodePng(bytes);
  // Library returns a 4-channel RGBA buffer.
  return { width: img.width, height: img.height, data: img.image };
}

/**
 * Try PNG first; if that fails, fall back to JPEG decode via a tiny inline
 * decoder (we don't have ImageBitmap in Deno). We avoid pulling in a heavy
 * JPEG dep by going through createImageBitmap when available; otherwise we
 * use a minimal JPEG decoder.
 */
async function decodeAnyImage(bytes: Uint8Array): Promise<DecodedImage> {
  // Detect PNG signature
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return decodePngBytes(bytes);
  }
  // Try jpeg-js via esm
  const { default: jpeg } = await import("https://esm.sh/jpeg-js@0.4.4");
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

function maskBoundingBox(mask: DecodedImage): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = mask.width, y0 = mask.height, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const i = (y * mask.width + x) * 4;
      const a = mask.data[i + 3];
      if (a > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function compositeOnWhite(src: DecodedImage, mask: DecodedImage, x0: number, y0: number, w: number, h: number): DecodedImage {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + x0, sy = y + y0;
      const si = (sy * src.width + sx) * 4;
      const mi = (sy * mask.width + sx) * 4;
      const oi = (y * w + x) * 4;
      const a = mask.data[mi + 3]; // 0 or ~255
      if (a > 8) {
        out[oi] = src.data[si];
        out[oi + 1] = src.data[si + 1];
        out[oi + 2] = src.data[si + 2];
        out[oi + 3] = 255;
      } else {
        out[oi] = 255;
        out[oi + 1] = 255;
        out[oi + 2] = 255;
        out[oi + 3] = 255;
      }
    }
  }
  return { width: w, height: h, data: out };
}

function nearestResize(img: DecodedImage, w: number, h: number): DecodedImage {
  const out = new Uint8Array(w * h * 4);
  const xRatio = img.width / w;
  const yRatio = img.height / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x * xRatio));
      const si = (sy * img.width + sx) * 4;
      const oi = (y * w + x) * 4;
      out[oi] = img.data[si];
      out[oi + 1] = img.data[si + 1];
      out[oi + 2] = img.data[si + 2];
      out[oi + 3] = img.data[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

function bilinearResize(img: DecodedImage, w: number, h: number): DecodedImage {
  const out = new Uint8Array(w * h * 4);
  const xRatio = (img.width - 1) / Math.max(1, w - 1);
  const yRatio = (img.height - 1) / Math.max(1, h - 1);
  for (let y = 0; y < h; y++) {
    const fy = y * yRatio;
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * xRatio;
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const wx = fx - x0;
      const i00 = (y0 * img.width + x0) * 4;
      const i01 = (y0 * img.width + x1) * 4;
      const i10 = (y1 * img.width + x0) * 4;
      const i11 = (y1 * img.width + x1) * 4;
      const oi = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = img.data[i00 + c] * (1 - wx) + img.data[i01 + c] * wx;
        const bot = img.data[i10 + c] * (1 - wx) + img.data[i11 + c] * wx;
        out[oi + c] = Math.round(top * (1 - wy) + bot * wy);
      }
    }
  }
  return { width: w, height: h, data: out };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function fail(admin: ReturnType<typeof createClient>, id: string, msg: string) {
  await admin.from("prototypes").update({ reference_status: "failed", reference_error: msg }).eq("id", id);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
