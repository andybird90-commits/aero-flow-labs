/**
 * refine-prototype-reference
 *
 * Lets the user clean up the already-isolated reference image with a free-text
 * instruction (e.g. "remove the small grille on the left", "remove the body
 * panel showing on the right"). Runs an image-edit pass on the current
 * `isolated_ref_urls[0]` and writes the cleaned result back.
 *
 * Body: { prototype_id: string, instruction: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
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
    const { prototype_id, instruction } = (await req.json()) as { prototype_id?: string; instruction?: string };
    if (!prototype_id) return json({ error: "prototype_id required" }, 400);
    const cleanInstruction = (instruction ?? "").toString().trim().slice(0, 500);
    if (!cleanInstruction) return json({ error: "instruction required" }, 400);

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
      .select("id, user_id, title, notes, placement_hint, isolated_ref_urls, source_image_urls")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) return json({ error: "Prototype not found" }, 404);

    const isolated = ((proto as any).isolated_ref_urls as string[] | null) ?? [];
    if (!isolated.length) return json({ error: "No isolated reference yet — run isolation first." }, 400);

    await admin.from("prototypes").update({
      reference_status: "processing",
      reference_error: null,
    }).eq("id", prototype_id);

    const currentRef = await fetchAsDataUrl(isolated[0]);
    if (!currentRef) {
      await admin.from("prototypes").update({
        reference_status: "failed",
        reference_error: "Could not load current isolated reference",
      }).eq("id", prototype_id);
      return json({ error: "Could not load current isolated reference" }, 500);
    }

    const partDescription = [((proto as any).title ?? "").toString().trim(), ((proto as any).notes ?? "").toString().trim()]
      .filter(Boolean).join(" — ") || "an aftermarket aero part";
    const placement = ((proto as any).placement_hint ?? "").toString().trim();

    // Include original source photos as secondary context so the model knows what
    // the real part looks like versus what belongs to the host car.
    const sourceUrls = ((proto as any).source_image_urls as string[] | null) ?? [];
    const sourceData: string[] = [];
    for (const url of sourceUrls.slice(0, 2)) {
      const d = await fetchAsDataUrl(url);
      if (d) sourceData.push(d);
    }

    const prompt = [
      `The FIRST attached image is the current isolated product photo of an aftermarket aero add-on part on a white background.`,
      `Part description: ${partDescription}.`,
      placement ? `Placement on car: ${placement}.` : ``,
      sourceData.length ? `The remaining ${sourceData.length} image(s) are the ORIGINAL real-world photos — use them to distinguish the aftermarket add-on from the host car body.` : ``,
      ``,
      `USER CLEANUP INSTRUCTION (HIGHEST PRIORITY — follow literally):`,
      cleanInstruction,
      ``,
      `RULES:`,
      `- Apply the cleanup to the FIRST image and output the corrected isolated product photo.`,
      `- Keep the SAME camera angle, SAME lighting, SAME white seamless background, SAME framing.`,
      `- Keep every real feature of the aftermarket add-on identical — only change what the instruction asks for.`,
      `- CRITICAL DISTINCTION: preserve the aftermarket add-on piece; remove anything that belongs to the original car body.`,
      `- "grille", "vent", "bodywork", "panel", "opening behind it", "factory intake", or similar wording should be interpreted as HOST-CAR/OEM features to remove, unless the instruction explicitly says to remove slats or vanes that are enclosed inside the add-on itself.`,
      `- Remove any underlying factory vent/grille, bumper aperture, body-colour panel, wheel-arch edge, door skin, or negative space from the host car if it was mistakenly included in the isolated image.`,
      `- If the removed element was behind the add-on, fill that area with the clean white studio background; if it was fused into the silhouette by mistake, continue the add-on surface naturally.`,
      `- ABSOLUTELY NO car body, no hands, no people, no other objects in the frame.`,
      `- STRIP all logos, badges, embossed text, brand marks and decals.`,
      `- Do NOT add bolts, rivets, mounting tabs, screws, fasteners, brackets or hardware.`,
      `- No labels, annotations, text, watermarks or split-screen.`,
      ``,
      `Output: ONE clean isolated photoreal product shot of the add-on part on white, with all host-car artefacts removed.`,
    ].filter(Boolean).join("\n");

    const refsForCall = [currentRef, ...sourceData];

    const result = await lovableGenerateImageWithFallback({
      apiKey: LOVABLE_API_KEY,
      prompt,
      referenceImages: refsForCall,
    });
    if (!result.ok) {
      const errMsg = result.error ?? "refine failed";
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
    const path = `${userId}/prototypes/${prototype_id}/isolated-refined-${Date.now()}.${ext}`;
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
    console.error("refine-prototype-reference error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    const mime = r.headers.get("content-type") ?? "image/png";
    return `data:${mime};base64,${bytesToBase64(buf)}`;
  } catch (e) {
    console.warn("fetchAsDataUrl failed", url, e);
    return null;
  }
}
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
