/**
 * render-prototype-on-car
 *
 * Re-runs ONLY the on-car carbon composite (keeps clay views intact). Prefers
 * isolated_ref_urls when present, falling back to source photos / clay hero.
 *
 * Body: { prototype_id: string }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { lovableGenerateImageWithFallback } from "../_shared/lovable-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
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
      .select("id, user_id, title, notes, car_context, garage_car_id, render_urls, source_image_urls, isolated_ref_urls, generation_mode, placement_hint")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    if (!(proto as any).garage_car_id) {
      return json({ error: "This prototype isn't linked to a garage car" }, 400);
    }

    const mode = (((proto as any).generation_mode as string) ?? "exact_photo");
    const isolated = ((proto as any).isolated_ref_urls as string[] | null) ?? [];
    const sourceUrls = ((proto as any).source_image_urls as string[] | null) ?? [];
    const renders = ((proto as any).render_urls as Array<{ angle: string; url: string }> | null) ?? [];
    const heroUrl = renders.find((r) => r.angle === "hero")?.url ?? null;

    // Reference priority for the on-car composite:
    //   exact_photo → isolated → source → clay hero
    //   inspired_photo → source → clay hero
    //   text_design → none
    let partRefUrls: string[] = [];
    if (mode === "text_design") {
      partRefUrls = [];
    } else if (mode === "exact_photo") {
      partRefUrls = isolated.length ? isolated : (sourceUrls.length ? sourceUrls.slice(0, 3) : (heroUrl ? [heroUrl] : []));
    } else {
      partRefUrls = sourceUrls.length ? sourceUrls.slice(0, 3) : (heroUrl ? [heroUrl] : []);
    }

    const titleRaw = ((proto as any).title ?? "").toString().trim();
    const userNotes = ((proto as any).notes ?? "").toString().trim();
    const partDescription = [titleRaw, userNotes].filter(Boolean).join(" — ") || "";
    const placement = ((proto as any).placement_hint ?? "").toString().trim();
    if (mode === "text_design" && !partDescription) {
      return json({ error: "Add a description first" }, 400);
    }

    const { data: car, error: carErr } = await admin
      .from("garage_cars")
      .select("id, make, model, year, trim, color, ref_side_url, ref_front34_url, ref_rear34_url, ref_front_url, ref_rear_url")
      .eq("id", (proto as any).garage_car_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (carErr || !car) return json({ error: "Garage car not found" }, 404);

    const carRefUrl = car.ref_side_url || car.ref_front34_url || car.ref_rear34_url || car.ref_front_url || car.ref_rear_url;
    if (!carRefUrl) return json({ error: "Garage car has no reference image yet" }, 400);

    await admin.from("prototypes").update({ fit_preview_status: "rendering", fit_preview_error: null }).eq("id", prototype_id);

    const refDataUrls: string[] = [];
    for (const url of [carRefUrl, ...partRefUrls]) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buf = new Uint8Array(await r.arrayBuffer());
        const mime = r.headers.get("content-type") ?? "image/png";
        refDataUrls.push(`data:${mime};base64,${bytesToBase64(buf)}`);
      } catch (e) { console.warn("ref fetch failed:", url, e); }
    }
    if (refDataUrls.length < 1 || (mode !== "text_design" && refDataUrls.length < 2)) {
      await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "Could not load reference images" }).eq("id", prototype_id);
      return json({ error: "Could not load reference images" }, 500);
    }

    const carLabel = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
    const placementLine = placement
      ? `PLACEMENT ON CAR: ${placement}. The part belongs in this anatomical zone — do not place it elsewhere.`
      : `Place the part in its anatomically correct location based on its shape.`;

    const partBlock = mode === "text_design"
      ? [
          `THE PART (designed from description): ${partDescription}.`,
          placementLine,
          `- Render in real glossy 2x2 twill CARBON FIBRE with a clear-coat. Match the car's lighting and reflections.`,
          `- Match scale and perspective.`,
          `- No bolts, rivets, mounting tabs, fasteners, logos, badges or decals.`,
        ].join("\n")
      : mode === "exact_photo"
      ? [
          `THE PART (remaining ${partRefUrls.length} reference image(s)) — NON-NEGOTIABLE EXACT REPLICA:`,
          `- You MUST replicate the part shown. Trace the outline. Copy every opening, vent, slat, fin, return and crease. Match proportions exactly.`,
          `- DO NOT invent a generic part. DO NOT substitute a similar-looking part.`,
          placementLine,
          `- Render in real glossy 2x2 twill CARBON FIBRE with a clear-coat. Match the car's lighting and reflections so it looks bonded on.`,
          `- Match scale and perspective.`,
          `- No bolts, rivets, fasteners. STRIP all logos, badges, text and decals from the part.`,
        ].join("\n")
      : [
          `THE PART (remaining ${partRefUrls.length} reference image(s)) — INSPIRATION:`,
          `- Use the photos as inspiration for character and key shapes, produce a clean refined version.`,
          placementLine,
          `- Render in glossy 2x2 twill CARBON FIBRE. Match the car's lighting and reflections.`,
          `- No bolts, fasteners, logos, badges or decals.`,
        ].join("\n");

    const prompt = [
      `You are editing the FIRST image (the car) by bonding an aftermarket aero part onto it.`,
      ``,
      `THE CAR (first image): ${carLabel}${car.color ? ` (${car.color})` : ""}.`,
      `- Output MUST be the same car, same angle, same body colour, same lighting, same background, same wheels, same proportions, same reflections.`,
      `- Do NOT crop the car. The whole car must remain visible with comfortable margin.`,
      `- The ONLY change to the car is the addition of the part below.`,
      ``,
      partBlock,
      ``,
      `Output: ONE clean photoreal image of the whole car with the part fitted in carbon fibre. No labels, annotations, split-screen, text, watermarks or inset thumbnails.`,
    ].join("\n");

    let imgUrl: string | undefined;
    let lastErr = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await lovableGenerateImageWithFallback({
        apiKey: LOVABLE_API_KEY,
        prompt,
        referenceImages: refDataUrls,
      });
      if (result.ok && result.dataUrl) { imgUrl = result.dataUrl; break; }
      if (result.status === 429) {
        await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "Rate limit" }).eq("id", prototype_id);
        return json({ error: "Rate limit reached" }, 429);
      }
      if (result.status === 402 || result.status === 403) {
        await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: "AI billing/access issue" }).eq("id", prototype_id);
        return json({ error: result.error ?? "AI billing/access issue" }, 402);
      }
      lastErr = `lovable-ai ${result.status ?? "?"}: ${result.error ?? "unknown"}`;
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
