/**
 * render-isolated-part
 *
 * Given a concept + a part the user clicked, ask Gemini's image model to
 * draw JUST that part — off the car, isolated on a clean white background,
 * from 4 angles (front-3/4, side, rear-3/4, top). The four images are
 * stored in the public `concept-renders` bucket and their URLs returned.
 *
 * The user reviews these renders in the UI, and on approval they're sent to
 * Meshy multi-image-to-3D (see `meshify-part`).
 *
 * Body: { concept_id: string; part_kind: string; label?: string }
 * Returns: { renders: { angle: string; url: string }[]; prompt: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_KINDS = [
  "splitter", "lip", "canard", "side_skirt",
  "wide_arch", "diffuser", "ducktail", "wing",
] as const;
type Kind = typeof ALLOWED_KINDS[number];

/**
 * Per-part spec fed to Gemini. We split into:
 *  - what:   exactly what the bolt-on aftermarket part IS
 *  - shape:  the silhouette / topology so it draws the right thing
 *  - not:    explicit negatives so it stops drawing the surrounding car body
 */
const PART_SPEC: Record<Kind, { what: string; shape: string; not: string }> = {
  splitter: {
    what:  "a single bolt-on carbon-fibre front splitter blade",
    shape: "one flat horizontal plate roughly 1500-1900mm wide and 80-150mm deep, with two small vertical side fences at the outer ends. Looks like a thin floating shelf",
    not:   "Do NOT draw any bumper, grille, headlights, fender, hood, or any part of a car body. Just the standalone splitter plate, like a part on a parts-shop catalogue page.",
  },
  lip: {
    what:  "a single thin carbon-fibre front lip extension",
    shape: "a long, narrow, curved sliver about 1500mm wide, 30-60mm tall, banana-shaped in profile. Like a thick smile of carbon",
    not:   "Do NOT draw a bumper, splitter, or any car body. Just the lip strip alone, no fender, no grille.",
  },
  canard: {
    what:  "a single pair of carbon-fibre canards (dive planes)",
    shape: "two small mirrored triangular fins, each about 200x150mm, with a slight curved sweep. Shown side by side, not on a car",
    not:   "Do NOT draw a bumper, fender, headlights, or any car body. Just the two small fins floating alone.",
  },
  side_skirt: {
    what:  "a single bolt-on carbon-fibre side skirt blade",
    shape: "one long, low, blade-like panel about 1800-2200mm long, 150-250mm tall, with a slight outward flare at the bottom. Looks like a long thin surfboard",
    not:   "Do NOT draw a door, rocker panel, wheels, fenders, or any car body. Just the standalone skirt blade, like a parts-catalogue product photo.",
  },
  wide_arch: {
    what:  "a single bolt-on carbon-fibre wheel arch flare (one piece, like an over-fender)",
    shape: "a curved arc-shaped strip that follows roughly half a wheel-well opening, about 800-1000mm long along the curve, 80-150mm wide, 30-50mm thick. Looks like a thick rainbow / horseshoe of carbon with mounting tabs",
    not:   "Do NOT draw a fender, bumper, door, headlights, wheel, tyre, or any car body. Just the standalone arc-shaped flare, like a Liberty Walk or Pandem fender flare on a white shop background. NO wheel, NO tyre, NO door.",
  },
  diffuser: {
    what:  "a single bolt-on carbon-fibre rear diffuser panel",
    shape: "one angled rectangular underbody panel about 1400mm wide, 400-600mm deep, with 3-7 vertical fins/strakes running front-to-back along its underside",
    not:   "Do NOT draw a bumper, exhaust, taillights, or any car body. Just the standalone diffuser panel with its strakes, like a product shot.",
  },
  ducktail: {
    what:  "a single bolt-on carbon-fibre ducktail spoiler lip",
    shape: "one curved trunk-mounted lip spoiler, about 1200-1400mm wide, 40-80mm tall, that gently rises and kicks up at the back. Like a duck's tail seen on its own",
    not:   "Do NOT draw a trunk, rear window, taillights, bumper, or any car body. Just the standalone ducktail piece on a white background.",
  },
  wing: {
    what:  "a single complete bolt-on carbon-fibre rear wing assembly",
    shape: "one straight aerofoil blade about 1500mm wide and 250-350mm chord, mounted on TWO swan-neck stands rising from below, with TWO flat vertical end plates at each tip. Optional small gurney lip on the trailing edge",
    not:   "Do NOT draw a trunk, rear window, taillights, bumper, or any car body. Just the standalone wing + stands + end plates floating, like a GT-wing product photo.",
  },
};

// Single hero render only. Gemini Pro image gen is ~50s per call; multiple
// sequential calls blow past the 150s edge function timeout, and our best
// fidelity results came from a single Pro render. Meshy can still build a
// 3D model from one image.
const ANGLES = [
  { key: "front34", label: "front 3/4 view, slightly above, hero product shot" },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { concept_id, part_kind, label, source_image_url } = await req.json() as {
      concept_id?: string; part_kind?: string; label?: string; source_image_url?: string;
    };
    if (!concept_id || !part_kind) {
      return json({ error: "concept_id and part_kind are required" }, 400);
    }
    if (!ALLOWED_KINDS.includes(part_kind as Kind)) {
      return json({ error: `Unknown part_kind. Allowed: ${ALLOWED_KINDS.join(", ")}` }, 400);
    }
    const kind = part_kind as Kind;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: concept } = await admin
      .from("concepts")
      .select("id, project_id, user_id, title, direction, render_front_url, render_side_url, render_rear34_url, render_rear_url")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!concept) return json({ error: "Concept not found" }, 404);

    const styleHint = [
      `Concept name: "${concept.title}"`,
      concept.direction ? `Concept direction: ${concept.direction}` : "",
    ].filter(Boolean).join(". ");

    const spec = PART_SPEC[kind];

    // Reference images from the concept — Gemini will use these to copy the
    // exact shape, proportions, vents, fasteners, and surface treatment of
    // the user's car. Without these, it invents a generic part.
    // If the caller supplied a `source_image_url` (e.g. a user-trimmed crop
    // showing only the part), prefer it as the SOLE reference so Gemini
    // ignores the surrounding bodywork entirely.
    const referenceUrls = source_image_url
      ? [source_image_url]
      : [
          concept.render_front_url,
          concept.render_side_url,
          concept.render_rear34_url,
          concept.render_rear_url,
        ].filter((u): u is string => !!u);

    // Pre-fetch reference images and inline them as data URLs so Gemini
    // definitely receives them as image content.
    const referenceImages = await Promise.all(
      referenceUrls.map(async (u) => {
        try {
          const r = await fetch(u);
          if (!r.ok) return null;
          const buf = new Uint8Array(await r.arrayBuffer());
          const mime = r.headers.get("content-type") ?? "image/png";
          const b64 = bytesToBase64(buf);
          return `data:${mime};base64,${b64}`;
        } catch (e) {
          console.warn("ref image fetch failed:", u, e);
          return null;
        }
      }),
    );
    const refDataUrls = referenceImages.filter((x): x is string => !!x);
    console.log(`render-isolated-part: loaded ${refDataUrls.length}/${referenceUrls.length} reference images for ${kind}`);

    const renders: Array<{ angle: string; url: string }> = [];
    // After we generate the hero (front34) shot, we use IT as the primary
    // reference for the other 3 angles. This forces consistency — same vents,
    // same fasteners, same proportions, same finish — instead of Gemini
    // inventing a fresh-looking part for each angle.
    let heroDataUrl: string | null = null;

    for (const angle of ANGLES) {
      const isHero = angle.key === "front34";

      const promptLines = isHero ? [
        `You are looking at ${refDataUrls.length} photos of ONE SPECIFIC custom car build.`,
        `Concept context: ${styleHint}.`,
        ``,
        `STEP 1 — STUDY the reference images. Find the ${spec.what} on this specific car.`,
        `Note its exact silhouette, thickness, flare/curve aggression, vent/louvre/cutout sizes, exposed bolts and fasteners, gloss vs matte, visible carbon weave vs paint, contrast trim, body-coloured sections.`,
        ``,
        `STEP 2 — RE-DRAW that exact part as a STANDALONE AFTERMARKET COMPONENT, completely detached from the car, photographed alone for THIS car's parts catalogue.`,
        `Match THIS car's specific styling. Not a generic Pandem / Liberty Walk / Rocket Bunny part. If the reference shows a 20mm flare, draw a 20mm flare — not an 80mm overfender.`,
        ``,
        `Loose shape sanity check (only if reference is unclear): ${spec.shape}.`,
        ``,
        `STRICT ISOLATION — READ TWICE:`,
        `- The part is FULLY DETACHED. It is sitting on a white seamless cyclorama, like an eBay parts listing or a Seibon catalogue page.`,
        `- ABSOLUTELY NO car body present in the frame. No fender, no door, no bumper, no quarter panel, no wheel, no tyre, no headlight, no taillight, no glass, no trim, no body colour panel adjacent to the part.`,
        `- NO ghost / faded / blurred car silhouette behind it. NO partial car visible at the edges of the frame. NO reflection of a car on the floor.`,
        `- If you would normally draw the part attached to a fender for context — DO NOT. Show ONLY the bolt-on piece itself with its mounting tabs/holes visible.`,
        `${spec.not}`,
        ``,
        `Output requirements:`,
        `- Pure white seamless studio background, edge to edge. Background occupies AT LEAST 70% of the frame.`,
        `- Soft even studio lighting, gentle ground contact shadow directly under the part only.`,
        `- Part centred, fills 40-55% of frame (leave generous white margin on all sides — do NOT crop tight).`,
        `- Camera angle: ${angle.label}.`,
        `- Match the material, finish, colour, and surface treatment from the reference EXACTLY. Do not default to black carbon if the reference shows painted body colour.`,
        `- Photorealistic 4k product photo. No text, no watermarks, no logos, no part numbers.`,
      ] : [
        `The FIRST attached image is the hero product photo of a ${spec.what} that we already approved.`,
        `Subsequent attached images are the original car concept references for context.`,
        ``,
        `TASK: Draw the EXACT SAME PART shown in the first attached image, but from a different camera angle.`,
        `Camera angle for this render: ${angle.label}.`,
        ``,
        `MUST match the hero image identically:`,
        `- Same overall shape and silhouette`,
        `- Same vents, louvres, mounting tabs, fasteners and bolt locations`,
        `- Same surface curvature and edge treatment`,
        `- Same material finish, colour, and gloss level`,
        `- Same proportions and thickness`,
        `Treat the hero image as the ground truth — this is just a turntable rotation of the same physical object.`,
        ``,
        `${spec.not}`,
        ``,
        `Output requirements:`,
        `- Pure white seamless background, identical lighting to the hero.`,
        `- Soft even studio lighting, gentle ground shadow.`,
        `- The part is centred and fills ~60% of the frame.`,
        `- Photorealistic 4k product photo. No car, no wheels, no fenders. No text, no watermarks.`,
      ];

      const promptText = promptLines.join("\n");

      const imageUrlsForThisAngle = isHero
        ? refDataUrls
        : (heroDataUrl ? [heroDataUrl, ...refDataUrls] : refDataUrls);

      const userContent: Array<any> = [
        { type: "text", text: promptText },
        ...imageUrlsForThisAngle.map((url) => ({ type: "image_url", image_url: { url } })),
      ];

      // Retry up to 3 times — Gemini Pro image often returns transient
      // 502 "Network connection lost" or empty image responses mid-batch.
      let imgUrl: string | undefined;
      let lastErr = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-pro-image-preview",
            messages: [{ role: "user", content: userContent }],
            modalities: ["image", "text"],
          }),
        });

        if (!aiResp.ok) {
          if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
          if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
          const t = await aiResp.text();
          lastErr = `gateway ${aiResp.status}: ${t.slice(0, 200)}`;
          console.error(`Image gen failed (attempt ${attempt}/3):`, lastErr);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }

        const rawText = await aiResp.text();
        if (!rawText) {
          lastErr = "empty response body from gateway";
          console.error(`Image gen empty body (attempt ${attempt}/3)`);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        let aiJson: any;
        try {
          aiJson = JSON.parse(rawText);
        } catch {
          lastErr = `invalid JSON: ${rawText.slice(0, 200)}`;
          console.error(`Image gen JSON parse failed (attempt ${attempt}/3):`, lastErr);
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        const providerErr = aiJson?.choices?.[0]?.error;
        imgUrl = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (imgUrl) break;

        lastErr = providerErr
          ? `provider ${providerErr.code}: ${providerErr.message}`
          : `no image in response: ${JSON.stringify(aiJson).slice(0, 200)}`;
        console.error(`No image returned (attempt ${attempt}/3):`, lastErr);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }

      if (!imgUrl) {
        return json({
          error: `Image generation failed for ${angle.key} after 3 attempts. ${lastErr}. Please try again.`,
        }, 502);
      }

      // imgUrl is a data: URL. Decode → upload to bucket → public URL.
      const m = imgUrl.match(/^data:(.+?);base64,(.+)$/);
      if (!m) {
        console.error("Unexpected image url format");
        return json({ error: "Bad image format" }, 500);
      }
      const mime = m[1];
      const bytes = base64ToBytes(m[2]);
      const ext = mime.includes("png") ? "png" : "jpg";
      const path = `${userId}/${concept.project_id}/parts/${concept_id}/${kind}-${angle.key}-${Date.now()}.${ext}`;
      const { error: upErr } = await admin.storage
        .from("concept-renders")
        .upload(path, bytes, { contentType: mime, upsert: true });
      if (upErr) {
        console.error("upload failed:", upErr);
        return json({ error: `Upload failed: ${upErr.message}` }, 500);
      }
      const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
      renders.push({ angle: angle.key, url: publicUrl });

      // Stash the hero data URL so subsequent angles can lock onto it.
      if (isHero) heroDataUrl = imgUrl;
    }

    // Cache the renders against the concept so we don't regenerate next time.
    // Clears any previously cached glb_url since renders changed.
    const { error: cacheErr } = await admin
      .from("concept_parts")
      .upsert({
        user_id: userId,
        project_id: concept.project_id,
        concept_id,
        kind,
        label: label ?? kind,
        render_urls: renders,
        glb_url: null,
      }, { onConflict: "concept_id,kind" });
    if (cacheErr) console.warn("concept_parts upsert failed:", cacheErr.message);

    return json({ renders, label: label ?? kind });
  } catch (e) {
    console.error("render-isolated-part error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack overflow on large images.
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
