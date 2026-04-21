/**
 * render-prototype-views
 *
 * Prototyper edge function. Takes 1-5 user-uploaded reference photos of a
 * physical part (on or off a car) and an optional car description, then asks
 * Gemini to redraw it as a clean clay-style aero part on a white background.
 *
 * We render TWO orientations:
 *   - hero  : front 3/4 view, hero product shot
 *   - back  : rear 3/4 view, showing the reverse / inner side
 *
 * The renders are uploaded to the public concept-renders bucket and saved
 * back onto the prototype row.
 *
 * Body: { prototype_id: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SURFACE =
  "Render the part as a smooth uniform matte light-grey clay model. " +
  "ABSOLUTELY NO carbon-fibre weave, NO glossy paint, NO chrome, NO reflections, NO decals, NO logos, NO surface texture. " +
  "Just clean smooth geometry with soft even shading so the SHAPE reads clearly.";

const SHELL =
  "MATERIAL CONSTRUCTION: render this as a moulded composite/fibreglass aero part — the SHELL/WALL itself is thin (~2mm) like a real bonded-on bodykit panel, but the part still has its FULL real-world three-dimensional shape, height, depth, curvature and flare. " +
  "Do NOT flatten the part into a thin ribbon or strip. Only the visible EDGES (the open-backed inner side) should read as thin sheet material. " +
  "FIXING METHOD IS NOT YOUR PROBLEM: do NOT add bolt holes, screw holes, fastener heads, rivets, mounting tabs, mounting flanges, brackets or clips. The part will be bonded or bolted on AFTER printing.";

const ANGLES = [
  { key: "hero", label: "front 3/4 view, slightly above, hero product shot" },
  { key: "back", label: "rear 3/4 view, clearly showing the reverse / back / inner mounting side" },
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prototype_id } = (await req.json()) as { prototype_id?: string };
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
      .select("id, user_id, title, car_context, notes, replicate_exact, source_image_urls")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    const sourceUrls = (proto.source_image_urls as string[] | null) ?? [];
    if (!sourceUrls.length) return json({ error: "No source images uploaded" }, 400);

    await admin
      .from("prototypes")
      .update({ render_status: "rendering", render_error: null })
      .eq("id", prototype_id);

    // Inline the source images as data URLs so Gemini definitely receives them.
    const refDataUrls: string[] = [];
    for (const url of sourceUrls) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        const mime = r.headers.get("content-type") ?? "image/png";
        refDataUrls.push(`data:${mime};base64,${bytesToBase64(buf)}`);
      } catch (e) {
        console.warn("source fetch failed:", url, e);
      }
    }
    if (!refDataUrls.length) {
      await admin.from("prototypes").update({ render_status: "failed", render_error: "Could not load source images" }).eq("id", prototype_id);
      return json({ error: "Could not load source images" }, 500);
    }

    const carContext = (proto.car_context ?? "").trim();
    const renders: Array<{ angle: string; url: string }> = [];
    let heroDataUrl: string | null = null;

    for (const angle of ANGLES) {
      const isHero = angle.key === "hero";
      const promptLines = isHero
        ? [
            `You are looking at ${refDataUrls.length} photo(s) of a physical aftermarket car part.`,
            carContext ? `Car context (for proportions only): ${carContext}.` : ``,
            ``,
            `STEP 1 — STUDY the reference photos. Identify the part and learn its exact silhouette, depth, curvature, vents, returns, and proportions.`,
            `IGNORE the surrounding car (if visible), material, colour, finish, paint, decals, dirt, reflections — only the SHAPE matters.`,
            ``,
            `STEP 2 — RE-DRAW that exact part as a STANDALONE AFTERMARKET COMPONENT, completely detached, photographed alone for a parts catalogue.`,
            `Match the reference proportions exactly. Preserve real section thickness and the reverse / inner face wherever visible from this angle.`,
            `IMPORTANT: this part will be BONDED OR BOLTED ON AFTER PRINTING. Do NOT add bolt holes, fasteners, mounting tabs, flanges, brackets or hardware.`,
            ``,
            `SURFACE: ${SURFACE}`,
            `SHELL: ${SHELL}`,
            ``,
            `STRICT ISOLATION:`,
            `- The part is FULLY DETACHED. White seamless cyclorama background.`,
            `- ABSOLUTELY NO car body in the frame. No fender, door, bumper, panel, wheel, glass, trim or reflection.`,
            `- ONLY ONE PART in the output.`,
            ``,
            `Output requirements:`,
            `- Pure white seamless background, edge to edge.`,
            `- Soft even studio lighting, gentle ground contact shadow.`,
            `- Part centred, fills 40-55% of frame.`,
            `- Camera angle: ${angle.label}.`,
            `- Clean clay render. No text, no watermarks, no logos.`,
          ]
        : [
            `The FIRST attached image is the hero clay render of a part we already approved.`,
            `Subsequent images are the original photos for context only.`,
            ``,
            `TASK: Re-draw the EXACT SAME PART from a different camera angle.`,
            `Camera angle: ${angle.label}.`,
            ``,
            `MUST match the hero image identically: same shape, vents, surface curvature, edge treatment, proportions, thickness.`,
            `Reveal the reverse / inner side and edge thickness so the object reads as a manufacturable thin-shell part.`,
            `Do NOT invent fasteners, bolt holes, flanges or brackets — fixing happens after printing.`,
            ``,
            `SURFACE: ${SURFACE}`,
            `SHELL: ${SHELL}`,
            ``,
            `Output requirements:`,
            `- Pure white seamless background.`,
            `- Soft even studio lighting, gentle ground shadow.`,
            `- Part centred, fills ~60% of frame.`,
            `- Clean clay render. No car, no text, no watermarks.`,
          ];

      const promptText = promptLines.filter(Boolean).join("\n");
      const refsForAngle = isHero
        ? refDataUrls
        : (heroDataUrl ? [heroDataUrl, ...refDataUrls] : refDataUrls);
      const userContent = [
        { type: "text", text: promptText },
        ...refsForAngle.map((url) => ({ type: "image_url", image_url: { url } })),
      ];

      let imgUrl: string | undefined;
      let lastErr = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3.1-flash-image-preview",
            messages: [{ role: "user", content: userContent }],
            modalities: ["image", "text"],
          }),
        });
        if (!aiResp.ok) {
          if (aiResp.status === 429) { await admin.from("prototypes").update({ render_status: "failed", render_error: "Rate limit" }).eq("id", prototype_id); return json({ error: "Rate limit reached" }, 429); }
          if (aiResp.status === 402) { await admin.from("prototypes").update({ render_status: "failed", render_error: "AI credits exhausted" }).eq("id", prototype_id); return json({ error: "AI credits exhausted" }, 402); }
          lastErr = `gateway ${aiResp.status}: ${(await aiResp.text()).slice(0, 200)}`;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
          continue;
        }
        const text = await aiResp.text();
        if (!text) { lastErr = "empty body"; await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        let aiJson: any;
        try { aiJson = JSON.parse(text); } catch { lastErr = "bad json"; await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        imgUrl = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (imgUrl) break;
        lastErr = "no image in response";
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
      if (!imgUrl) {
        await admin.from("prototypes").update({ render_status: "failed", render_error: lastErr }).eq("id", prototype_id);
        return json({ error: `Image gen failed: ${lastErr}` }, 502);
      }

      const m = imgUrl.match(/^data:(.+?);base64,(.+)$/);
      if (!m) { await admin.from("prototypes").update({ render_status: "failed", render_error: "bad image format" }).eq("id", prototype_id); return json({ error: "bad image" }, 500); }
      const mime = m[1];
      const bytes = base64ToBytes(m[2]);
      const ext = mime.includes("png") ? "png" : "jpg";
      const path = `${userId}/prototypes/${prototype_id}/${angle.key}-${Date.now()}.${ext}`;
      const { error: upErr } = await admin.storage.from("concept-renders").upload(path, bytes, { contentType: mime, upsert: true });
      if (upErr) { await admin.from("prototypes").update({ render_status: "failed", render_error: upErr.message }).eq("id", prototype_id); return json({ error: `Upload failed: ${upErr.message}` }, 500); }
      const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
      renders.push({ angle: angle.key, url: publicUrl });
      if (isHero) heroDataUrl = imgUrl;
    }

    await admin
      .from("prototypes")
      .update({
        render_status: "ready",
        render_urls: renders,
        render_error: null,
        glb_url: null,
        mesh_status: "idle",
      })
      .eq("id", prototype_id);

    return json({ renders });
  } catch (e) {
    console.error("render-prototype-views error:", e);
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
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}