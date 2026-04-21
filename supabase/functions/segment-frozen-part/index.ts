// Click-to-segment a part from a generated concept image using Replicate SAM.
// Returns mask + silhouette URLs in the public `frozen-parts` bucket plus bbox
// and suggested anchor points. Does NOT write to the frozen_parts table —
// the client does that on Save so the user can refine first.
//
// Hard rule (project-wide): this function does NOT call any image-generation
// model. SAM is segmentation only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  source_image_url: string;
  prototype_id: string;
  click_point: { x: number; y: number }; // normalized 0..1
  bbox_hint?: { x: number; y: number; w: number; h: number } | null;
}

const REPLICATE_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// SAM 2 hosted on Replicate (point-prompt mask).
// meta/sam-2 takes click coordinates in absolute image pixels.
const SAM_MODEL =
  "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";

async function fetchAsBuffer(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function getImageSize(
  bytes: Uint8Array,
): Promise<{ w: number; h: number }> {
  // Decode just enough to know dimensions. We use createImageBitmap-equivalent
  // via the Web `Image` API isn't available in Deno; instead use imagescript.
  const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const img = await Image.decode(bytes);
  return { w: img.width, h: img.height };
}

async function pollReplicate(predictionUrl: string): Promise<any> {
  for (let i = 0; i < 90; i++) {
    const r = await fetch(predictionUrl, {
      headers: { Authorization: `Bearer ${REPLICATE_TOKEN}` },
    });
    const j = await r.json();
    if (j.status === "succeeded") return j;
    if (j.status === "failed" || j.status === "canceled") {
      throw new Error(`Replicate ${j.status}: ${j.error ?? "unknown"}`);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error("Replicate prediction timed out");
}

async function runSAM(
  imageUrl: string,
  clickPx: { x: number; y: number },
): Promise<string> {
  const create = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REPLICATE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: SAM_MODEL.split(":")[1],
      input: {
        image: imageUrl,
        clicks: `[${clickPx.x},${clickPx.y},1]`,
        mask_only: true,
      },
    }),
  });
  if (!create.ok) {
    throw new Error(`Replicate create failed: ${await create.text()}`);
  }
  const prediction = await create.json();
  const finished = await pollReplicate(prediction.urls.get);
  // Output is a URL (or array of URLs) to the mask PNG (white = part).
  const out = finished.output;
  return Array.isArray(out) ? out[0] : out;
}

async function buildSilhouetteAndBbox(
  sourceBytes: Uint8Array,
  maskBytes: Uint8Array,
): Promise<{
  silhouette: Uint8Array;
  maskClean: Uint8Array;
  bbox: { x: number; y: number; w: number; h: number };
  anchors: Record<string, { x: number; y: number }>;
}> {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const src = await Image.decode(sourceBytes);
  let mask = await Image.decode(maskBytes);

  if (mask.width !== src.width || mask.height !== src.height) {
    mask = mask.resize(src.width, src.height);
  }

  const W = src.width;
  const H = src.height;
  const silhouette = new Image(W, H);
  const maskClean = new Image(W, H);

  let minX = W, minY = H, maxX = 0, maxY = 0, hasPixel = false;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const m = mask.getRGBAAt(x + 1, y + 1); // imagescript is 1-indexed
      const r = (m >> 24) & 0xff;
      const inside = r > 127;
      if (inside) {
        const px = src.getRGBAAt(x + 1, y + 1);
        silhouette.setPixelAt(x + 1, y + 1, px);
        maskClean.setPixelAt(x + 1, y + 1, 0xffffffff);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        hasPixel = true;
      } else {
        silhouette.setPixelAt(x + 1, y + 1, 0x00000000);
        maskClean.setPixelAt(x + 1, y + 1, 0x00000000);
      }
    }
  }

  if (!hasPixel) {
    minX = 0; minY = 0; maxX = W - 1; maxY = H - 1;
  }

  const bbox = {
    x: minX / W,
    y: minY / H,
    w: (maxX - minX + 1) / W,
    h: (maxY - minY + 1) / H,
  };

  const anchors = {
    top:           { x: (minX + maxX) / 2 / W, y: minY / H },
    bottom:        { x: (minX + maxX) / 2 / W, y: maxY / H },
    leading_edge:  { x: minX / W,              y: (minY + maxY) / 2 / H },
    trailing_edge: { x: maxX / W,              y: (minY + maxY) / 2 / H },
    attach_edge:   { x: (minX + maxX) / 2 / W, y: maxY / H },
  };

  const silhouetteBytes = await silhouette.encode();
  const maskBytesClean = await maskClean.encode();
  return {
    silhouette: silhouetteBytes,
    maskClean: maskBytesClean,
    bbox,
    anchors,
  };
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
    if (!body.source_image_url || !body.click_point || !body.prototype_id) {
      return new Response(
        JSON.stringify({ error: "Missing source_image_url, click_point or prototype_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Get source image bytes + size to convert normalized click → px.
    const sourceBytes = await fetchAsBuffer(body.source_image_url);
    const { w, h } = await getImageSize(sourceBytes);
    const clickPx = {
      x: Math.round(body.click_point.x * w),
      y: Math.round(body.click_point.y * h),
    };

    // 2. Run SAM via Replicate.
    const maskUrl = await runSAM(body.source_image_url, clickPx);

    // 3. Build clean mask, silhouette PNG, bbox, anchor points.
    const maskBytes = await fetchAsBuffer(maskUrl);
    const { silhouette, maskClean, bbox, anchors } =
      await buildSilhouetteAndBbox(sourceBytes, maskBytes);

    // 4. Upload to frozen-parts bucket. Use a temp/<draftId> path so the
    //    client can swap files in on save without spamming the table.
    const draftId = crypto.randomUUID();
    const basePath = `${user.id}/${body.prototype_id}/draft-${draftId}`;
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);

    const upload = async (suffix: string, bytes: Uint8Array) => {
      const path = `${basePath}/${suffix}.png`;
      const { error } = await adminClient.storage
        .from("frozen-parts")
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = adminClient.storage
        .from("frozen-parts").getPublicUrl(path);
      return publicUrl;
    };

    const [maskPublic, silhouettePublic] = await Promise.all([
      upload("mask", maskClean),
      upload("silhouette", silhouette),
    ]);

    return new Response(
      JSON.stringify({
        mask_url: maskPublic,
        silhouette_url: silhouettePublic,
        bbox,
        anchor_points: anchors,
        source_size: { w, h },
        draft_id: draftId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[segment-frozen-part] error", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
