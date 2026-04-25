/**
 * ai-classify-car-materials — AI vision fallback for paint classification.
 *
 * The geometric classifier handles ~80% of cars correctly. This function
 * fills the gap by:
 *   1. Loading the hero STL and producing 4 shaded grayscale renders
 *      (front-3/4, side, rear-3/4, rear) plus a per-pixel triangle-index
 *      buffer for each view.
 *   2. Sending the renders to Gemini 2.5 Pro and asking it to return
 *      pixel-region polygons for body / glass / wheel / tyre.
 *   3. Back-projecting the AI's polygons onto the per-pixel triangle index
 *      buffer to derive a per-triangle vote.
 *   4. Final tag = majority vote across all 4 views (with a confidence
 *      threshold; ambiguous tris keep their geometric tag).
 *
 * The result is **returned to the caller** but NOT saved automatically —
 * the admin reviews it in the Paint Map editor and clicks "Accept" or
 * "Merge" before persisting via save-car-material-map.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { parseStl } from "../_shared/stl-io.ts";
import {
  renderAngle,
  reorientMesh,
  ANGLE_KEYS,
  type AngleKey,
  type ForwardAxis,
} from "../_shared/stl-render-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TAG_BODY = 0;
const TAG_GLASS = 1;
const TAG_WHEEL = 2;
const TAG_TYRE = 3;
const TAG_NAMES = ["body", "glass", "wheel", "tyre"] as const;

const RENDER_SIZE = 384; // big enough for AI to see detail; small enough to send

interface AiBody {
  car_stl_id: string;
  /** Optional starting tags (base64). If provided, AI votes are MERGED on top. */
  base_tags_b64?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    // Auth: must be admin
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ error: "Admin role required" }, 403);

    const body = (await req.json()) as AiBody;
    if (!body.car_stl_id) return json({ error: "car_stl_id required" }, 400);

    // Load STL
    const { data: stlRow, error: stlErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("id", body.car_stl_id)
      .maybeSingle();
    if (stlErr) throw stlErr;
    if (!stlRow) return json({ error: "car_stl not found" }, 404);

    const path = stlRow.repaired_stl_path ?? stlRow.stl_path;
    const { data: download, error: dlErr } = await admin.storage
      .from("car-stls")
      .download(path);
    if (dlErr) throw dlErr;

    const bytes = new Uint8Array(await download.arrayBuffer());
    const rawMesh = parseStl(bytes);
    const triCount = rawMesh.indices.length / 3;
    if (triCount === 0) return json({ error: "Empty STL" }, 400);

    // Reorient to canonical (-z forward, +y up) for the renderer.
    const fwd = (stlRow.forward_axis ?? "+x") as ForwardAxis;
    const mesh = reorientMesh(rawMesh, fwd);

    console.log(`[ai-classify] ${triCount} tris, axis=${fwd}, rendering ${ANGLE_KEYS.length} views @ ${RENDER_SIZE}px`);

    // Vote tally per triangle: votes[t * 4 + tag] = count
    const votes = new Uint32Array(triCount * 4);
    const seen = new Uint32Array(triCount);

    for (const angle of ANGLE_KEYS) {
      const view = renderAngle(mesh, angle, RENDER_SIZE, 28, { shaded: true, triIndex: true });
      if (!view.shade || !view.triIndex) continue;

      const png = encodeGrayscalePng(view.shade, view.size, view.size);
      const dataUrl = "data:image/png;base64," + base64FromBytes(png);

      const masks = await askGeminiForMasks(dataUrl, angle, lovableKey);
      console.log(`[ai-classify] ${angle}: got ${Object.keys(masks).join(",")} masks`);

      // For each labelled pixel region, increment votes for the triangle hit
      // by that pixel.
      for (const [name, polys] of Object.entries(masks)) {
        const tag = nameToTag(name);
        if (tag == null || !Array.isArray(polys)) continue;
        for (const poly of polys as unknown as number[][][]) {
          if (!Array.isArray(poly) || poly.length < 3) continue;
          stampPolygon(poly, view.size, view.triIndex, votes, seen, tag);
        }
      }
    }

    // Build merged tag map: AI vote winner > body baseline (from incoming
    // base_tags_b64 if present). Confidence = winner / totalSeen >= 0.4.
    const finalTags = new Uint8Array(triCount);
    if (body.base_tags_b64) {
      const baseBin = atob(body.base_tags_b64);
      for (let i = 0; i < Math.min(triCount, baseBin.length); i++) {
        finalTags[i] = baseBin.charCodeAt(i);
      }
    }
    let aiAssigned = 0;
    for (let t = 0; t < triCount; t++) {
      if (seen[t] === 0) continue;
      let winTag = -1, winCount = 0;
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const c = votes[t * 4 + k];
        sum += c;
        if (c > winCount) { winCount = c; winTag = k; }
      }
      if (winTag < 0 || sum === 0) continue;
      const confidence = winCount / sum;
      if (confidence >= 0.45) {
        finalTags[t] = winTag;
        aiAssigned++;
      }
    }

    const stats = {
      body: 0, glass: 0, wheel: 0, tyre: 0, total: triCount, ai_assigned: aiAssigned,
    };
    for (let i = 0; i < triCount; i++) {
      stats[TAG_NAMES[finalTags[i]] as "body" | "glass" | "wheel" | "tyre"]++;
    }

    return json({
      ok: true,
      tags_b64: base64FromBytes(finalTags),
      triangle_count: triCount,
      stats,
      method: "ai-gemini-2.5-pro",
    });
  } catch (e) {
    console.error("[ai-classify] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

/* ─── Gemini mask request ─────────────────────────────────── */

interface MaskBatch { body: number[][]; glass: number[][]; wheel: number[][]; tyre: number[][]; }

async function askGeminiForMasks(
  imageDataUrl: string,
  angle: AngleKey,
  apiKey: string,
): Promise<Partial<MaskBatch>> {
  const sys =
    "You are a vision assistant that segments car renders. " +
    "You will receive a single shaded greyscale render of a 3D car model from a fixed camera. " +
    "Identify these regions and return polygon outlines (each polygon is an array of [x,y] points in IMAGE PIXEL COORDINATES, with origin at top-left): " +
    "glass (windscreens, side windows, rear screens), wheel (alloy rims and spokes — the metal disc inside a tyre), tyre (the rubber sidewall+tread surrounding each wheel). " +
    "Body is the default — do NOT return body polygons unless something is unusually mis-shaped. " +
    "Coordinates are integers from 0 to image size-1. Return TIGHT polygons hugging each region's boundary. " +
    "If a region is not visible from this angle, return an empty array for it. " +
    "Use 8–24 points per polygon — enough to follow curves, not so many that you waste tokens.";

  const userText =
    `View angle: ${angle}. Image size: ${RENDER_SIZE}x${RENDER_SIZE} px. ` +
    "Return masks via the report_masks function.";

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: sys },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      tools: [{
        type: "function",
        function: {
          name: "report_masks",
          description: "Return polygon outlines per material region.",
          parameters: {
            type: "object",
            properties: {
              glass:  polyArraySchema("Glass region polygons (windows, windscreen)."),
              wheel:  polyArraySchema("Wheel/rim polygons (the metal disc)."),
              tyre:   polyArraySchema("Tyre polygons (rubber ring around each wheel)."),
            },
            required: ["glass", "wheel", "tyre"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "report_masks" } },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("[ai-classify] gemini error", resp.status, t);
    throw new Error(`Gemini error ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    console.warn("[ai-classify] no tool call in response");
    return {};
  }
  try {
    const parsed = JSON.parse(args) as Partial<MaskBatch>;
    return parsed;
  } catch (e) {
    console.error("[ai-classify] failed to parse tool args:", args.slice(0, 300));
    return {};
  }
}

function polyArraySchema(desc: string) {
  return {
    type: "array",
    description: desc,
    items: {
      type: "array",
      description: "Polygon as flat list of point pairs.",
      items: {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
      },
    },
  };
}

function nameToTag(name: string): number | null {
  switch (name) {
    case "body":  return TAG_BODY;
    case "glass": return TAG_GLASS;
    case "wheel": return TAG_WHEEL;
    case "tyre":  return TAG_TYRE;
    default: return null;
  }
}

/* ─── Polygon → triangle vote stamping ────────────────────── */

function stampPolygon(
  poly: number[][],          // [[x,y], ...] in pixel coords (top-left origin)
  size: number,
  triIndex: Int32Array,
  votes: Uint32Array,
  seen: Uint32Array,
  tag: number,
): void {
  // Bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  minX = Math.max(0, Math.floor(minX));
  maxX = Math.min(size - 1, Math.ceil(maxX));
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(size - 1, Math.ceil(maxY));
  if (maxX < minX || maxY < minY) return;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      if (!pointInPolygon(px + 0.5, py + 0.5, poly)) continue;
      const t = triIndex[py * size + px];
      if (t < 0) continue;
      votes[t * 4 + tag]++;
      seen[t]++;
    }
  }
}

function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ─── Tiny dependency-free PNG encoder (grayscale 8-bit) ──── */

function encodeGrayscalePng(gray: Uint8Array, w: number, h: number): Uint8Array {
  // 1) Image data with filter byte (0) per scanline.
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter type "None"
    raw.set(gray.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  }
  const idat = zlibDeflate(raw);

  // 2) Build PNG chunks.
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // color type: grayscale
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const chunks = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const out = new Uint8Array(8 + len + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcBuf = new Uint8Array(4 + len);
  for (let i = 0; i < 4; i++) crcBuf[i] = type.charCodeAt(i);
  crcBuf.set(data, 4);
  dv.setUint32(8 + len, crc32(crcBuf));
  return out;
}

// (CompressionStream-based async deflate path removed — we use the sync
// stored-block deflate below which is plenty fast for 384x384 grayscale.)

// Synchronous-ish wrapper using a top-level await is not allowed inside
// the encoder caller chain, so we provide a sync fallback (uncompressed
// deflate blocks). For 384x384 grayscale this is ~150 KB raw, well within
// any practical limit.
function zlibDeflate(data: Uint8Array): Uint8Array {
  // zlib header: 0x78 0x01 (no compression preset)
  const header = new Uint8Array([0x78, 0x01]);

  // Split into uncompressed deflate blocks of max 65535 bytes.
  const MAX = 65535;
  const chunks: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += MAX) {
    const end = Math.min(off + MAX, data.length);
    const len = end - off;
    const isLast = end === data.length ? 1 : 0;
    const block = new Uint8Array(5 + len);
    block[0] = isLast; // BFINAL=last, BTYPE=00 (stored)
    block[1] = len & 0xff;
    block[2] = (len >> 8) & 0xff;
    block[3] = (~len) & 0xff;
    block[4] = ((~len) >> 8) & 0xff;
    block.set(data.subarray(off, end), 5);
    chunks.push(block);
  }

  // Adler-32 of uncompressed data
  const adler = adler32(data);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler);

  let total = header.length + tail.length;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(header, off); off += header.length;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  out.set(tail, off);
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ─── Misc helpers ────────────────────────────────────────── */

function base64FromBytes(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(s);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
