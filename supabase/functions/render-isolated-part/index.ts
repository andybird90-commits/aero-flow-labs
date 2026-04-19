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

/** Per-part description fed to Gemini so it knows exactly what to draw. */
const PART_DESCRIPTION: Record<Kind, string> = {
  splitter:   "a carbon-fibre front splitter — a flat horizontal aerodynamic blade that mounts under the front bumper, with two short vertical side fences",
  lip:        "a carbon-fibre front lip spoiler — a thin curved extension that mounts to the bottom of a front bumper",
  canard:     "a pair of carbon-fibre canards (dive planes) — small angled aerodynamic fins that mount to the front bumper corners",
  side_skirt: "a carbon-fibre side skirt — a long aerodynamic blade that mounts along the rocker panel between the wheels",
  wide_arch:  "a carbon-fibre wide-body fender flare / wheel arch extension — a curved bolt-on panel that flares out around a wheel opening",
  diffuser:   "a carbon-fibre rear diffuser — an angled underbody panel with multiple vertical strakes/fins, mounts under the rear bumper",
  ducktail:   "a carbon-fibre ducktail spoiler — a small lip that rises off the rear deck/trunk lid",
  wing:       "a carbon-fibre rear wing — a single-element aerofoil with two swan-neck stands and two vertical end plates",
};

const ANGLES = [
  { key: "front34", label: "front 3/4 view, slightly above" },
  { key: "side",    label: "pure side / profile view" },
  { key: "rear34",  label: "rear 3/4 view, slightly above" },
  { key: "top",     label: "top-down plan view" },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { concept_id, part_kind, label } = await req.json() as {
      concept_id?: string; part_kind?: string; label?: string;
    };
    if (!concept_id || !part_kind) {
      return json({ error: "concept_id and part_kind are required" }, 400);
    }
    if (!ALLOWED_KINDS.includes(part_kind as Kind)) {
      return json({ error: `Unknown part_kind. Allowed: ${ALLOWED_KINDS.join(", ")}` }, 400);
    }
    const kind = part_kind as Kind;

    // Auth
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
      .select("id, project_id, user_id, title, direction")
      .eq("id", concept_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!concept) return json({ error: "Concept not found" }, 404);

    const styleHint = [
      `Style match: ${concept.title}`,
      concept.direction ? `Direction: ${concept.direction}` : "",
    ].filter(Boolean).join(". ");

    const partDesc = PART_DESCRIPTION[kind];

    // Render each angle with a tight, focused prompt.
    const renders: Array<{ angle: string; url: string }> = [];

    for (const angle of ANGLES) {
      const prompt = [
        `Studio product photograph of ${partDesc}.`,
        `${styleHint}.`,
        `Show ONLY the part itself — no car, no background, no people, no shadows behind it.`,
        `Pure white seamless background. Soft even studio lighting. The part is centred and fills ~70% of the frame.`,
        `Camera: ${angle.label}.`,
        `Material: glossy black carbon-fibre weave with subtle highlights.`,
        `Photorealistic, sharp focus, 4k product render. No text, no watermarks.`,
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
