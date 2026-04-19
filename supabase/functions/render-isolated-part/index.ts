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

const ANGLES = [
...
      const prompt = [
        `Studio product photograph of ${spec.what}.`,
        `Shape: ${spec.shape}.`,
        `${spec.not}`,
        `${styleHint}.`,
        `This is an isolated aftermarket aero part shown alone, like a photo on an aero-parts e-commerce page (think APR, Voltex, Liberty Walk, Pandem catalogue).`,
        `Pure white seamless background. Soft even studio lighting. The part is centred and fills ~60% of the frame, with empty white space around it.`,
        `Camera: ${angle.label}.`,
        `Material: glossy black carbon-fibre weave with subtle highlights and visible weave pattern.`,
        `Photorealistic, sharp focus, 4k product render. No text, no watermarks, no other objects.`,
      ].join(" ");

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
        if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
        const t = await aiResp.text();
        console.error("Image gen failed:", aiResp.status, t.slice(0, 400));
        return json({ error: "AI gateway error" }, 500);
      }

      const aiJson = await aiResp.json();
      const imgUrl: string | undefined =
        aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imgUrl) {
        console.error("No image in response:", JSON.stringify(aiJson).slice(0, 400));
        return json({ error: `Image gen returned no image for ${angle.key}` }, 500);
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
    }

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
