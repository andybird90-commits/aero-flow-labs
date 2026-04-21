// Deterministic placement of a frozen part onto a target image.
//
// HARD RULE: This function does NOT call any AI / image-generation model.
// It loads the frozen part's silhouette PNG, applies pure 2D pixel transforms
// (translate, scale, rotate, mirror, optional 4-pt perspective skew for
// opposite-side snapping on 3/4 views) and composites the result onto the
// target image. Pixel-perfect shape preservation is the whole point.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Transform {
  x: number;          // normalized 0..1 (centre of part)
  y: number;          // normalized 0..1 (centre of part)
  scale: number;      // multiplier on original part size relative to source frame
  rotation: number;   // radians
  mirror: boolean;    // horizontal flip
  // Optional 4-point perspective skew for opposite-side snapping on 3/4 views.
  // Each point is normalized 0..1 relative to the part's own bbox after scaling.
  perspective?: {
    tl: { x: number; y: number };
    tr: { x: number; y: number };
    br: { x: number; y: number };
    bl: { x: number; y: number };
  } | null;
}

interface Placement {
  frozen_part_id: string;
  transform: Transform;
}

interface ReqBody {
  target_image_url: string;
  placements: Placement[]; // composited in order
  prototype_id?: string;
  persist?: boolean; // upload composite + return URL
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status} for ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Bilinear sample with alpha
function sample(
  src: any,
  x: number,
  y: number,
): [number, number, number, number] {
  const W = src.width, H = src.height;
  if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const dx = x - x0, dy = y - y0;
  const get = (xx: number, yy: number) => {
    const c = src.getRGBAAt(xx + 1, yy + 1);
    return [(c >> 24) & 0xff, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
  };
  const a = get(x0, y0);
  const b = get(x0 + 1, y0);
  const c = get(x0, y0 + 1);
  const d = get(x0 + 1, y0 + 1);
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const top = a[i] * (1 - dx) + b[i] * dx;
    const bot = c[i] * (1 - dx) + d[i] * dx;
    out.push(top * (1 - dy) + bot * dy);
  }
  return out as [number, number, number, number];
}

function packRGBA(r: number, g: number, b: number, a: number): number {
  return (
    ((r & 0xff) << 24) |
    ((g & 0xff) << 16) |
    ((b & 0xff) << 8) |
    (a & 0xff)
  ) >>> 0;
}

// Solve 8-param projective transform mapping unit square corners
// (0,0)(1,0)(1,1)(0,1) -> dst quad. Standard linear solve.
function projectiveFromUnitSquare(dst: {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}): number[] {
  const [x0, y0] = dst.tl;
  const [x1, y1] = dst.tr;
  const [x2, y2] = dst.br;
  const [x3, y3] = dst.bl;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;
  return [a, b, c, d, e, f, g, h];
}

// Invert projective: solve dst -> src so we can backwards-sample
// We actually want forward map src(unit) -> dst pixels for a target dst rect.
// To paint, we iterate over dst pixels and inverse-map back to src(unit) coords.
// For simplicity here we use the unit-square -> dst matrix above and walk the
// dst bounding box, computing the inverse via the analytic formula.
function applyForward(M: number[], u: number, v: number): [number, number] {
  const [a, b, c, d, e, f, g, h] = M;
  const w = g * u + h * v + 1;
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
}

async function compositePart(
  base: any,
  silhouette: any,
  t: Transform,
) {
  const baseW = base.width, baseH = base.height;
  let part = silhouette;

  // 1. Mirror — pixel-perfect horizontal flip
  if (t.mirror) {
    part = part.clone().flip(true, false);
  }

  // Part native size in src image is its full PNG dims (silhouette PNG was
  // saved at source-image resolution with transparent background).
  const partW = part.width;
  const partH = part.height;

  // Scaled size on canvas
  const targetW = Math.max(1, Math.round(partW * t.scale));
  const targetH = Math.max(1, Math.round(partH * t.scale));

  // Centre on canvas
  const cx = t.x * baseW;
  const cy = t.y * baseH;

  // Optional perspective skew defines the dst quad relative to the scaled rect.
  // Without perspective, dst quad is just the rotated axis-aligned rect.
  const cosR = Math.cos(t.rotation);
  const sinR = Math.sin(t.rotation);
  const halfW = targetW / 2;
  const halfH = targetH / 2;

  const cornersUnit: Array<[number, number]> = t.perspective
    ? [
        [t.perspective.tl.x, t.perspective.tl.y],
        [t.perspective.tr.x, t.perspective.tr.y],
        [t.perspective.br.x, t.perspective.br.y],
        [t.perspective.bl.x, t.perspective.bl.y],
      ]
    : [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];

  // Place corners around centre with rotation
  const placeCorner = (u: number, v: number): [number, number] => {
    const lx = (u - 0.5) * targetW;
    const ly = (v - 0.5) * targetH;
    const rx = lx * cosR - ly * sinR;
    const ry = lx * sinR + ly * cosR;
    return [cx + rx, cy + ry];
  };

  const dstCorners = cornersUnit.map((c) => placeCorner(c[0], c[1])) as [
    [number, number], [number, number], [number, number], [number, number],
  ];

  const M = projectiveFromUnitSquare({
    tl: dstCorners[0],
    tr: dstCorners[1],
    br: dstCorners[2],
    bl: dstCorners[3],
  });

  // Bounding box on dst
  const xs = dstCorners.map((c) => c[0]);
  const ys = dstCorners.map((c) => c[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(baseW - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(baseH - 1, Math.ceil(Math.max(...ys)));

  // Numerically invert M by sampling: for each dst pixel, solve for (u,v).
  // Use Newton's iteration seeded by affine approximation. For our use
  // (small/no perspective), 4 iterations is plenty.
  const [a, b, c, d, e, f, g, h] = M;

  const invertPoint = (X: number, Y: number): [number, number] | null => {
    let u = 0.5, v = 0.5;
    for (let it = 0; it < 6; it++) {
      const w = g * u + h * v + 1;
      const fx = (a * u + b * v + c) / w - X;
      const fy = (d * u + e * v + f) / w - Y;
      // Jacobian
      const dwu = g, dwv = h;
      const num_x = a * u + b * v + c;
      const num_y = d * u + e * v + f;
      const dfx_du = (a * w - num_x * dwu) / (w * w);
      const dfx_dv = (b * w - num_x * dwv) / (w * w);
      const dfy_du = (d * w - num_y * dwu) / (w * w);
      const dfy_dv = (e * w - num_y * dwv) / (w * w);
      const det = dfx_du * dfy_dv - dfx_dv * dfy_du;
      if (Math.abs(det) < 1e-12) return null;
      const du = (dfy_dv * fx - dfx_dv * fy) / det;
      const dv = (-dfy_du * fx + dfx_du * fy) / det;
      u -= du;
      v -= dv;
      if (Math.abs(du) + Math.abs(dv) < 1e-4) break;
    }
    if (u < -0.001 || v < -0.001 || u > 1.001 || v > 1.001) return null;
    return [u, v];
  };

  for (let Y = y0; Y <= y1; Y++) {
    for (let X = x0; X <= x1; X++) {
      const uv = invertPoint(X, Y);
      if (!uv) continue;
      const [u, v] = uv;
      const sx = u * partW;
      const sy = v * partH;
      const [r, g2, b2, alpha] = sample(part, sx, sy);
      if (alpha < 4) continue;
      const baseC = base.getRGBAAt(X + 1, Y + 1);
      const br = (baseC >> 24) & 0xff;
      const bg = (baseC >> 16) & 0xff;
      const bb = (baseC >> 8) & 0xff;
      const ba = baseC & 0xff;
      const aN = alpha / 255;
      const outR = Math.round(r * aN + br * (1 - aN));
      const outG = Math.round(g2 * aN + bg * (1 - aN));
      const outB = Math.round(b2 * aN + bb * (1 - aN));
      const outA = Math.max(ba, alpha);
      base.setPixelAt(X + 1, Y + 1, packRGBA(outR, outG, outB, outA));
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ReqBody;
    if (!body.target_image_url || !Array.isArray(body.placements)) {
      return new Response(
        JSON.stringify({ error: "Missing target_image_url or placements" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load frozen parts referenced
    const ids = Array.from(new Set(body.placements.map((p) => p.frozen_part_id)));
    const { data: parts, error: partsErr } = await supabase
      .from("frozen_parts")
      .select("id, silhouette_url, user_id")
      .in("id", ids);
    if (partsErr) throw partsErr;
    if (!parts || parts.length !== ids.length) {
      return new Response(
        JSON.stringify({ error: "One or more frozen parts not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const partMap = new Map(parts.map((p) => [p.id, p]));

    const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
    const baseBytes = await fetchBytes(body.target_image_url);
    const base = await Image.decode(baseBytes);

    // Pre-load all silhouettes (deduped)
    const silMap = new Map<string, any>();
    await Promise.all(
      parts.map(async (p) => {
        if (!p.silhouette_url) throw new Error(`Part ${p.id} has no silhouette`);
        const bytes = await fetchBytes(p.silhouette_url);
        const img = await Image.decode(bytes);
        silMap.set(p.id, img);
      }),
    );

    for (const placement of body.placements) {
      const sil = silMap.get(placement.frozen_part_id);
      if (!sil) continue;
      await compositePart(base, sil, placement.transform);
    }

    const out = await base.encode();

    if (body.persist && body.prototype_id) {
      const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
      const path = `${user.id}/${body.prototype_id}/composite-${Date.now()}.png`;
      const { error: upErr } = await adminClient.storage
        .from("frozen-parts")
        .upload(path, out, { contentType: "image/png", upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = adminClient.storage
        .from("frozen-parts").getPublicUrl(path);

      // Persist composite + manifest to prototype
      await supabase.from("prototypes")
        .update({
          fit_preview_url: publicUrl,
          fit_preview_status: "ready",
          placement_manifest: body.placements,
        })
        .eq("id", body.prototype_id);

      return new Response(
        JSON.stringify({ composite_url: publicUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Otherwise return base64 for instant preview
    const b64 = btoa(String.fromCharCode(...out));
    return new Response(
      JSON.stringify({ composite_data_url: `data:image/png;base64,${b64}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[place-frozen-part] error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
