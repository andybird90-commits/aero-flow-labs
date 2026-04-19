/**
 * segment-part
 *
 * Edge-snapping for part renders. The user roughly marks the part on the 2D
 * render (foreground/background click points and/or a freehand lasso polygon)
 * and we return a clean masked PNG with everything outside the part replaced
 * by white — ready to feed straight into Meshy.
 *
 * Strategy:
 *   1. Run lucataco/segment-anything-2 (SAM 2 "everything" mode) on the
 *      original render to get N candidate masks.
 *   2. Score each mask by the user's prompts:
 *        +1 for every foreground point/lasso-sample that falls inside the mask
 *        -big for every background point that falls inside
 *      Keep masks with score > 0.
 *   3. Union the kept masks → this is the final part silhouette.
 *   4. Composite the original render through the mask onto a white background
 *      (with a small feather + erode so the cut isn't pixelated) and upload
 *      the result to the public `concept-renders` bucket.
 *
 * Body:
 *   {
 *     image_url: string;          // existing render URL (must be publicly fetchable)
 *     points?: { x: number; y: number; label: 0 | 1 }[];  // 1 = fg, 0 = bg
 *     lasso?:  { x: number; y: number }[];                 // freehand polygon (treated as fg)
 *     concept_id: string;
 *     part_kind: string;
 *   }
 *
 * Returns:
 *   { masked_url: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
// @ts-ignore - npm specifier resolved at runtime by Deno
import { decode as decodePng, encode as encodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Pinned working version of lucataco/segment-anything-2.
const SAM_VERSION = "be7cbde9fdf0eecdc8b20ffec9dd0d1cfeace0832d4d0b58a071d993182e1be0";

interface Pt { x: number; y: number; label?: 0 | 1 }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (!REPLICATE_API_TOKEN) return json({ error: "REPLICATE_API_TOKEN not configured" }, 500);

    const body = await req.json() as {
      image_url?: string;
      points?: Pt[];
      lasso?: Pt[];
      concept_id?: string;
      part_kind?: string;
    };
    if (!body.image_url || !body.concept_id || !body.part_kind) {
      return json({ error: "image_url, concept_id, part_kind required" }, 400);
    }
    const points = body.points ?? [];
    const lasso  = body.lasso  ?? [];
    if (points.length === 0 && lasso.length < 3) {
      return json({ error: "Provide at least one click point or a 3-point lasso" }, 400);
    }

    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Fetch original render
    const imgResp = await fetch(body.image_url);
    if (!imgResp.ok) return json({ error: `Failed to fetch image: ${imgResp.status}` }, 400);
    const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
    const decoded = decodePng(imgBytes);
    const W = decoded.width, H = decoded.height;
    // Normalize to RGBA — pngs lib returns 3 channels for RGB pngs, 4 for RGBA.
    const srcRGBA = toRGBA(decoded.image, W, H);

    // 2) Call SAM-2 everything-mode via Replicate (sync via Prefer: wait).
    console.log(`[segment-part] running SAM on ${W}x${H} image`);
    const samStart = Date.now();
    const samPrimary = await runSamEverything(body.image_url, {
      mask_limit: 24,
      points_per_side: 32,
      pred_iou_thresh: 0.8,
      min_mask_region_area: 200,
      crop_n_layers: 0,
    });

    let maskUrls: string[] = samPrimary.maskUrls;
    if (maskUrls.length === 0) {
      console.warn("[segment-part] SAM returned no masks on primary settings, retrying with relaxed params");
      const samRetry = await runSamEverything(body.image_url, {
        mask_limit: 32,
        points_per_side: 48,
        pred_iou_thresh: 0.7,
        min_mask_region_area: 64,
        crop_n_layers: 1,
      });
      maskUrls = samRetry.maskUrls;
    }

    console.log(`[segment-part] SAM returned ${maskUrls.length} masks in ${Date.now() - samStart}ms`);
    if (maskUrls.length === 0) {
      return json({
        error: "SAM could not detect a usable part boundary from this selection. Try a tighter lasso or add a few click points on the part.",
        fallback: true,
      });
    }

    // 3) Build the prompt sample set.
    //    - foreground: explicit fg points + dense samples inside the lasso polygon
    //    - background: explicit bg points
    const fgPts: { x: number; y: number }[] = [];
    const bgPts: { x: number; y: number }[] = [];
    for (const p of points) {
      const t = { x: clamp(Math.round(p.x), 0, W - 1), y: clamp(Math.round(p.y), 0, H - 1) };
      if (p.label === 0) bgPts.push(t); else fgPts.push(t);
    }
    if (lasso.length >= 3) {
      // Sample the polygon's bounding box on a coarse grid, keep points inside.
      const xs = lasso.map(p => p.x), ys = lasso.map(p => p.y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
      const step = Math.max(4, Math.round(Math.min(x1 - x0, y1 - y0) / 24));
      for (let y = y0; y <= y1; y += step) {
        for (let x = x0; x <= x1; x += step) {
          if (pointInPolygon(x, y, lasso)) fgPts.push({ x, y });
        }
      }
    }
    if (fgPts.length === 0) return json({ error: "No foreground samples derived from prompts" }, 400);

    // 4) Download all candidate masks and score them.
    const maskBufs = await Promise.all(maskUrls.map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`mask fetch ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const dec = decodePng(bytes);
      if (dec.width !== W || dec.height !== H) {
        throw new Error(`mask size mismatch: ${dec.width}x${dec.height} vs ${W}x${H}`);
      }
      return toRGBA(dec.image, dec.width, dec.height);
    }));

    type Scored = { idx: number; score: number };
    const scored: Scored[] = maskBufs.map((m, idx) => {
      let score = 0;
      for (const p of fgPts) if (alphaAt(m, W, p.x, p.y) > 127) score += 1;
      for (const p of bgPts) if (alphaAt(m, W, p.x, p.y) > 127) score -= 1000;
      return { idx, score };
    });

    const keep = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    if (keep.length === 0) {
      return json({
        error: "No SAM mask matched your selection. Try clicking more clearly on the part, or draw the lasso tighter.",
      }, 422);
    }
    console.log(`[segment-part] kept ${keep.length}/${scored.length} masks`);

    // 5) Union kept masks into a single binary mask.
    const union = new Uint8Array(W * H);
    for (const s of keep) {
      const m = maskBufs[s.idx];
      for (let i = 0, j = 0; i < union.length; i++, j += 4) {
        // Grayscale mask → value in R; RGBA mask → value in A. Take max.
        if (Math.max(m[j], m[j + 3]) > 127) union[i] = 255;
      }
    }

    // 6) Erode 1px to remove anti-aliased outline crud, then feather 2px.
    const eroded = erode(union, W, H, 1);
    const feathered = feather(eroded, W, H, 2);

    // 7) Composite: keep original where mask=255, white where mask=0, blended where partial.
    const out = new Uint8Array(W * H * 4);
    const src = srcRGBA;
    for (let i = 0, j = 0; i < W * H; i++, j += 4) {
      const a = feathered[i] / 255; // 0..1
      out[j]     = Math.round(src[j]     * a + 255 * (1 - a));
      out[j + 1] = Math.round(src[j + 1] * a + 255 * (1 - a));
      out[j + 2] = Math.round(src[j + 2] * a + 255 * (1 - a));
      out[j + 3] = 255;
    }

    const png = encodePng(out, W, H);
    const path = `${userId}/${body.concept_id}/${body.part_kind}-masked-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const { data: pub } = admin.storage.from("concept-renders").getPublicUrl(path);

    return json({ masked_url: pub.publicUrl });
  } catch (e) {
    console.error("[segment-part] fatal", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ─────────────────────── helpers ───────────────────────

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SamRunOptions = {
  mask_limit: number;
  points_per_side: number;
  pred_iou_thresh: number;
  min_mask_region_area: number;
  crop_n_layers: number;
};

async function runSamEverything(imageUrl: string, options: SamRunOptions): Promise<{ maskUrls: string[] }> {
  const samResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      "Prefer": "wait=60",
    },
    body: JSON.stringify({
      version: SAM_VERSION,
      input: {
        image: imageUrl,
        ...options,
      },
    }),
  });

  const samJson = await samResp.json();
  if (!samResp.ok) {
    console.error("[segment-part] SAM error", samJson);
    throw new Error(`SAM call failed: ${samJson?.detail || samResp.statusText}`);
  }
  if (samJson.status === "failed") {
    throw new Error(`SAM failed: ${samJson.error}`);
  }

  return {
    maskUrls: (samJson.output?.individual_masks ?? []) as string[],
  };
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Normalize decoded PNG pixels to RGBA. The `pngs` lib returns 3 bytes per
// pixel for RGB images, 4 for RGBA, 1 for grayscale, 2 for grayscale+alpha.
function toRGBA(pixels: Uint8Array, w: number, h: number): Uint8Array {
  const n = w * h;
  const channels = pixels.length / n;
  if (channels === 4) return pixels;
  const out = new Uint8Array(n * 4);
  if (channels === 3) {
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 3, d += 4) {
      out[d] = pixels[s]; out[d + 1] = pixels[s + 1]; out[d + 2] = pixels[s + 2]; out[d + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      const v = pixels[i]; out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = 255;
    }
  } else if (channels === 2) {
    for (let i = 0, s = 0, d = 0; i < n; i++, s += 2, d += 4) {
      const v = pixels[s]; out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = pixels[s + 1];
    }
  } else {
    throw new Error(`Unsupported channel count: ${channels} (length=${pixels.length}, ${w}x${h})`);
  }
  return out;
}

// SAM masks may be grayscale (value in R) or RGBA (value in A). Take the max
// so either layout works after toRGBA normalisation.
function alphaAt(rgba: Uint8Array, w: number, x: number, y: number): number {
  const i = (y * w + x) * 4;
  return Math.max(rgba[i], rgba[i + 3]);
}

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Box-erode by `r` pixels: a pixel survives only if all neighbours within r are also set.
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) { keep = 0; break; }
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || mask[yy * w + xx] < 128) { keep = 0; break; }
        }
      }
      if (keep) out[y * w + x] = 255;
    }
  }
  return out;
}

// Cheap feather: 2-pass box blur of radius `r` on a binary mask.
function feather(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += mask[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = Math.round(sum / win);
      const xAdd = clamp(x + r + 1, 0, w - 1);
      const xRem = clamp(x - r, 0, w - 1);
      sum += mask[y * w + xAdd] - mask[y * w + xRem];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = Math.round(sum / win);
      const yAdd = clamp(y + r + 1, 0, h - 1);
      const yRem = clamp(y - r, 0, h - 1);
      sum += tmp[yAdd * w + x] - tmp[yRem * w + x];
    }
  }
  return out;
}
