/**
 * render-prototype-on-car
 *
 * Takes the prototype's hero clay render + the user's garage car reference photo
 * and asks gpt-image-1 to composite the part onto the car as a carbon-fibre
 * panel — purely as a visual fit-check so the user can see "does this part
 * make sense on this car?".
 *
 * Body: { prototype_id: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { openaiGenerateImage } from "../_shared/openai-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
      .select("id, user_id, title, car_context, garage_car_id, render_urls, source_image_urls")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    if (!proto.garage_car_id) {
      return json({ error: "This prototype isn't linked to a garage car" }, 400);
    }

    // Prefer the clay hero (cleaner subject) if present; otherwise fall back to
    // the user's source photos so we can still produce a fit preview before
    // clay views exist.
    const renders = (proto.render_urls as Array<{ angle: string; url: string }> | null) ?? [];
    const heroUrl = renders.find((r) => r.angle === "hero")?.url ?? renders[0]?.url ?? null;
    const sourceUrls = (proto.source_image_urls as string[] | null) ?? [];
    const partRefUrls: string[] = heroUrl ? [heroUrl] : sourceUrls.slice(0, 3);
    if (!partRefUrls.length) return json({ error: "Upload reference photos first" }, 400);

    const { data: car, error: carErr } = await admin
      .from("garage_cars")
      .select("id, make, model, year, trim, color, ref_side_url, ref_front34_url, ref_rear34_url, ref_front_url, ref_rear_url")
      .eq("id", proto.garage_car_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (carErr || !car) return json({ error: "Garage car not found" }, 404);

    const carRefUrl =
      car.ref_side_url ||
      car.ref_front34_url ||
      car.ref_rear34_url ||
      car.ref_front_url ||
      car.ref_rear_url;
    if (!carRefUrl) return json({ error: "Garage car has no reference image yet" }, 400);

    await admin
      .from("prototypes")
      .update({ fit_preview_status: "rendering", fit_preview_error: null })
      .eq("id", prototype_id);

    // Inline part refs FIRST then car ref last — gpt-image-1 weights earlier refs more heavily
    // for shape, so putting the part first makes it copy the part more faithfully.
    const refDataUrls: string[] = [];
    for (const url of [...partRefUrls, carRefUrl]) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        const mime = r.headers.get("content-type") ?? "image/png";
        refDataUrls.push(`data:${mime};base64,${bytesToBase64(buf)}`);
      } catch (e) {
        console.warn("ref fetch failed:", url, e);
      }
    }
    if (refDataUrls.length < 2) {
      await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "Could not load reference images" }).eq("id", prototype_id);
      return json({ error: "Could not load reference images" }, 500);
    }

    const carLabel = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
    const partRefDescription = heroUrl
      ? `THE FIRST IMAGE is a clay render of the aftermarket aero part the user is prototyping.`
      : `THE FIRST ${partRefUrls.length} IMAGE(S) are reference photos of the aftermarket aero part the user wants fitted.`;

    const prompt = [
      `You are given reference photos in two groups:`,
      `  • ${partRefDescription} STUDY THESE FIRST. Memorise the exact silhouette, opening, vents, slats, depth, curvature, edge treatment and proportions. The part you draw MUST match these as closely as possible — do NOT invent a generic shape, do NOT idealise it, do NOT swap it for a similar-looking part.`,
      `  • THE LAST IMAGE is the user's car: ${carLabel}${car.color ? ` (${car.color})` : ""}.`,
      ``,
      `TASK: Produce ONE photoreal image of that exact car with that exact part bonded onto it in real CARBON FIBRE.`,
      ``,
      `Rules for the CAR (last image):`,
      `- Keep the car identical to the reference: same angle, same body colour, same lighting, same background, same wheels, same proportions, same reflections.`,
      `- Do NOT crop the car — the whole car visible in the reference must remain visible in the output, with comfortable margin around it.`,
      ``,
      `Rules for the PART (first images):`,
      `- COPY THE PART AS DRAWN. Match its silhouette, opening shape, internal slats/vents, return depth and proportions exactly. Do not improvise.`,
      `- Place it in its anatomically correct location on the car (side scoop in the side intake area, front splitter on the front bumper, rear wing on the bootlid, etc).`,
      `- Render it in real glossy 2x2 twill carbon fibre with a clear-coat. Match the scene's lighting/reflections so it looks bonded on, not pasted.`,
      `- Match scale and perspective to the car — it must look like it actually fits.`,
      `- Do NOT add bolts, rivets, mounting tabs or fasteners — assume it's bonded on.`,
      `- STRIP all logos, badges, embossed text, brand marks, model names and decals from the part.`,
      ``,
      `Output: a clean photoreal image of the whole car with the part fitted, no labels, no annotations, no split-screen, no text, no watermarks.`,
    ].join("\n");

    let imgUrl: string | undefined;
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await openaiGenerateImage({
        apiKey: OPENAI_API_KEY,
        prompt,
        referenceImages: refDataUrls,
        size: "1536x1024",
        quality: "high",
      });
      if (result.ok && result.dataUrl) { imgUrl = result.dataUrl; break; }
      if (result.status === 429) {
        await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "Rate limit" }).eq("id", prototype_id);
        return json({ error: "Rate limit reached" }, 429);
      }
      if (result.status === 402 || result.status === 403) {
        await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "OpenAI billing/access issue" }).eq("id", prototype_id);
        return json({ error: result.error ?? "OpenAI billing/access issue" }, 402);
      }
      lastErr = `openai ${result.status ?? "?"}: ${result.error ?? "unknown"}`;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    if (!imgUrl) {
      await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: lastErr }).eq("id", prototype_id);
      return json({ error: `Image gen failed: ${lastErr}` }, 502);
    }

    const m = imgUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!m) {
      await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "bad image format" }).eq("id", prototype_id);
      return json({ error: "bad image" }, 500);
    }
    const mime = m[1];
    const bytes = base64ToBytes(m[2]);
    const ext = mime.includes("png") ? "png" : "jpg";
    const path = `${userId}/prototypes/${prototype_id}/on-car-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("concept-renders").upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) {
      await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: upErr.message }).eq("id", prototype_id);
      return json({ error: `Upload failed: ${upErr.message}` }, 500);
    }
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    await admin
      .from("prototypes")
      .update({ fit_preview_status: "ready", fit_preview_url: publicUrl, fit_preview_error: null })
      .eq("id", prototype_id);

    return json({ url: publicUrl });
  } catch (e) {
    console.error("render-prototype-on-car error:", e);
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
