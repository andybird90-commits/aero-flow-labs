/**
 * isolate-prototype-part
 *
 * Pre-processing stage for the Prototyper "exact replica" mode. Takes the
 * raw user-uploaded photos and asks Lovable AI to produce a clean, isolated
 * photoreal render of just the part on a white background — stripped of the
 * surrounding car body, hands, dirt, decals etc.
 *
 * The output URL(s) are written to `prototypes.isolated_ref_urls` so the
 * downstream on-car composite + clay views can use them as a much cleaner
 * source of truth.
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
      .select("id, user_id, title, notes, source_image_urls, placement_hint")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    const sources = ((proto as any).source_image_urls as string[] | null) ?? [];
    if (!sources.length) {
      await admin.from("prototypes").update({
        reference_status: "failed",
        reference_error: "No source photos to isolate",
      }).eq("id", prototype_id);
      return json({ error: "No source photos to isolate" }, 400);
    }

    await admin.from("prototypes").update({
      reference_status: "processing",
      reference_error: null,
    }).eq("id", prototype_id);

    // Inline source images as data URLs.
    const refDataUrls: string[] = [];
    for (const url of sources) {
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
      await admin.from("prototypes").update({
        reference_status: "failed",
        reference_error: "Could not load source images",
      }).eq("id", prototype_id);
      return json({ error: "Could not load source images" }, 500);
    }

    const partDescription = [((proto as any).title ?? "").toString().trim(), ((proto as any).notes ?? "").toString().trim()]
      .filter(Boolean).join(" — ") || "an aftermarket aero part";
    const placement = ((proto as any).placement_hint ?? "").toString().trim();

    const prompt = [
      `You are looking at ${refDataUrls.length} reference photo(s) of a physical aftermarket aero part${placement ? ` for the ${placement} of a car` : ""}.`,
      `Description: ${partDescription}.`,
      ``,
      `TASK: Produce ONE clean photoreal product photograph of THE EXACT AFTERMARKET ADD-ON PART ONLY, completely isolated from the surrounding car / hands / clutter / dirt / decals.`,
      ``,
      `RULES:`,
      `- Match the aftermarket add-on shape EXACTLY as shown in the reference photos. Trace the outline. Copy every vent, slat, fin, opening, return, crease and proportion of the ADD-ON PART only.`,
      `- CRITICAL DISTINCTION: the target object is the aftermarket piece itself, NOT the host car body it is attached to or sitting over.`,
      `- Remove any underlying OEM/factory features that belong to the car: factory vent grilles, bumper apertures, door skin, wheel arch, body-colour panel edges, intake openings, surrounding bodywork and any negative space belonging to the car shell.`,
      `- If the photo shows the add-on installed on top of an existing factory intake or grille, keep only the protruding self-contained add-on and DELETE the factory opening behind it.`,
      `- If unsure, prefer keeping only the standalone protruding object and discard flush surrounding car surfaces.`,
      `- Front 3/4 hero angle, slightly above, so the silhouette and depth are obvious.`,
      `- Background: pure white seamless cyclorama. Soft even studio lighting. Gentle ground contact shadow.`,
      `- Material: keep the part's real material if obvious from the photos (e.g. carbon fibre, plastic, fibreglass, painted), but strip dirt, scratches and reflections that hide the shape.`,
      `- ABSOLUTELY NO car body, no hands, no people, no other objects in the frame. The part is the ONLY subject.`,
      `- STRIP all logos, badges, embossed text, brand marks, model names, decals and stickers — even if visible in the references.`,
      `- Do NOT add bolts, rivets, mounting tabs, screws, fasteners, brackets or hardware. Fixing happens after manufacturing.`,
      `- No labels, annotations, text, watermarks or split-screen.`,
      ``,
      `Output: ONE clean isolated photoreal product shot of the add-on part on white, with no host-car bodywork remaining.`,
    ].join("\n");

    const result = await lovableGenerateImageWithFallback({
      apiKey: LOVABLE_API_KEY,
      prompt,
      referenceImages: refDataUrls,
    });
    if (!result.ok) {
      const errMsg = result.error ?? "isolation failed";
      await admin.from("prototypes").update({
        reference_status: "failed",
        reference_error: errMsg,
      }).eq("id", prototype_id);
      if (result.status === 429) return json({ error: "Rate limit reached" }, 429);
      if (result.status === 402) return json({ error: "AI credits exhausted" }, 402);
      return json({ error: errMsg }, 502);
    }

    const m = result.dataUrl!.match(/^data:(.+?);base64,(.+)$/);
    if (!m) {
      await admin.from("prototypes").update({
        reference_status: "failed",
        reference_error: "bad image format",
      }).eq("id", prototype_id);
      return json({ error: "bad image" }, 500);
    }
    const mime = m[1];
    const bytes = base64ToBytes(m[2]);
    const ext = mime.includes("png") ? "png" : "jpg";
    const path = `${userId}/prototypes/${prototype_id}/isolated-${Date.now()}.${ext}`;
    const { error: upErr } = await admin.storage.from("concept-renders").upload(path, bytes, {
      contentType: mime, upsert: true,
    });
    if (upErr) {
      await admin.from("prototypes").update({
        reference_status: "failed",
        reference_error: upErr.message,
      }).eq("id", prototype_id);
      return json({ error: `Upload failed: ${upErr.message}` }, 500);
    }
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;

    await admin.from("prototypes").update({
      reference_status: "ready",
      reference_error: null,
      isolated_ref_urls: [publicUrl],
    }).eq("id", prototype_id);

    return json({ url: publicUrl });
  } catch (e) {
    console.error("isolate-prototype-part error:", e);
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
