/**
 * render-prototype-views
 *
 * Prototyper edge function. Branches by `prototypes.generation_mode`:
 *
 *   - exact_photo    → use isolated_ref_urls if present, else source_image_urls,
 *                      copy the part faithfully.
 *   - inspired_photo → use source photos as inspiration (idealised).
 *   - text_design    → no photos, design from title + notes.
 *
 * Always produces (when a garage car is linked):
 *   1) ON-CAR carbon composite → fit_preview_url
 *   2) Clay HERO render        → render_urls[0]
 *   3) Clay BACK render        → render_urls[1]
 *
 * Body: { prototype_id: string, revision_note?: string }
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

const SURFACE =
  "Render the part as a smooth uniform matte light-grey clay model. " +
  "ABSOLUTELY NO carbon-fibre weave, NO glossy paint, NO chrome, NO reflections, NO surface texture. " +
  "STRIP ALL LOGOS, BADGES, EMBOSSED TEXT, MODEL NAMES, BRAND MARKS, DECALS AND STICKERS. " +
  "Just clean smooth geometry with soft even shading so the SHAPE reads clearly.";

const SHELL =
  "MATERIAL CONSTRUCTION — CRITICAL: render this as a HOLLOW thin-shell moulded composite/fibreglass aero part. " +
  "Wall thickness ~2mm. The part is NOT a solid lump. It has an OPEN BACK / CONCAVE INNER CAVITY. " +
  "Outer surface follows the reference shape, inner surface is a hollow concave cavity ~2mm inward. " +
  "Keep its full real-world 3D shape, height, depth, curvature and flare — do NOT flatten it. " +
  "Do NOT add bolt holes, screws, rivets, mounting tabs, flanges, brackets or clips.";

const ANGLES = [
  { key: "hero", label: "front 3/4 view, slightly above, hero product shot" },
  { key: "back", label: "rear 3/4 view from behind, looking INTO the open hollow inner cavity / underside / mounting face" },
] as const;

type GenMode = "exact_photo" | "inspired_photo" | "text_design";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { prototype_id, revision_note } = (await req.json()) as { prototype_id?: string; revision_note?: string };
    if (!prototype_id) return json({ error: "prototype_id required" }, 400);
    const revisionNote = (revision_note ?? "").toString().trim().slice(0, 1000);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as any;

    await admin.from("prototypes").update({ render_status: "rendering", render_error: null }).eq("id", prototype_id);

    // @ts-ignore - EdgeRuntime is provided by Supabase edge runtime
    EdgeRuntime.waitUntil(runRender(admin, prototype_id, userId, revisionNote).catch(async (e) => {
      console.error("background render failed:", e);
      await admin.from("prototypes").update({
        render_status: "failed",
        render_error: e instanceof Error ? e.message : String(e),
      }).eq("id", prototype_id);
    }));

    return json({ ok: true, status: "rendering" }, 202);
  } catch (e) {
    console.error("render-prototype-views error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function runRender(
  admin: any,
  prototype_id: string,
  userId: string,
  revisionNote: string,
): Promise<void> {
  const { data: proto, error: protoErr } = await admin
    .from("prototypes")
    .select("id, user_id, title, car_context, notes, replicate_exact, source_image_urls, garage_car_id, generation_mode, placement_hint, isolated_ref_urls")
    .eq("id", prototype_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (protoErr || !proto) throw new Error("Prototype not found");

  const mode: GenMode = (((proto as any).generation_mode as GenMode) ?? "exact_photo");
  const sourceUrls = ((proto as any).source_image_urls as string[] | null) ?? [];
  const isolatedUrls = ((proto as any).isolated_ref_urls as string[] | null) ?? [];
  const userNotesRaw = ((proto as any).notes ?? "").toString().trim();
  const titleRaw = ((proto as any).title ?? "").toString().trim();
  const placement = ((proto as any).placement_hint ?? "").toString().trim();

  if (mode !== "text_design" && !sourceUrls.length && !isolatedUrls.length) {
    throw new Error("Photo modes require uploaded reference photos");
  }
  if (mode === "text_design" && !userNotesRaw && !titleRaw) {
    throw new Error("Description mode requires a title or notes");
  }

  // Pick reference set: isolated wins for exact_photo, raw photos for inspired_photo.
  // text_design uses no part references.
  const refUrls: string[] = mode === "text_design"
    ? []
    : (mode === "exact_photo" && isolatedUrls.length ? isolatedUrls : sourceUrls);

  // Garage car ref (optional).
  let carRefDataUrl: string | null = null;
  let carLabel = "";
  let carColor = "";
  if ((proto as any).garage_car_id) {
      const { data: carRow } = await admin
      .from("garage_cars")
      .select("make, model, year, trim, color, ref_side_url, ref_front34_url, ref_rear34_url, ref_front_url, ref_rear_url")
      .eq("id", (proto as any).garage_car_id)
      .eq("user_id", userId)
      .maybeSingle();
      const car = carRow as Record<string, any> | null;
    if (car) {
      carLabel = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
      carColor = car.color ?? "";
      const carRefUrl = car.ref_side_url || car.ref_front34_url || car.ref_rear34_url || car.ref_front_url || car.ref_rear_url;
      if (carRefUrl) carRefDataUrl = await fetchAsDataUrl(carRefUrl);
    }
  }

  const initialUpdate: Record<string, unknown> = { render_status: "rendering", render_error: null };
  if (carRefDataUrl) {
    initialUpdate.fit_preview_status = "rendering";
    initialUpdate.fit_preview_error = null;
  }
  await admin.from("prototypes").update(initialUpdate).eq("id", prototype_id);

  // Inline part refs as data URLs.
  const refDataUrls: string[] = [];
  for (const url of refUrls) {
    const d = await fetchAsDataUrl(url);
    if (d) refDataUrls.push(d);
  }
  if (refUrls.length && !refDataUrls.length) {
    await admin.from("prototypes").update({ render_status: "failed", render_error: "Could not load reference images" }).eq("id", prototype_id);
    throw new Error("Could not load reference images");
  }

  const partDescription = [titleRaw, userNotesRaw].filter(Boolean).join(" — ") || "an aftermarket aero part";
  const carContext = ((proto as any).car_context ?? "").toString().trim();
  const combinedNotes = [userNotesRaw, revisionNote].filter(Boolean).join("\n\nREVISION:\n");
  const NOTES_BLOCK = combinedNotes
    ? `\nUSER NOTES (HIGHEST PRIORITY — follow literally):\n${combinedNotes}\n`
    : ``;
  const PLACEMENT_LINE = placement
    ? `PLACEMENT ON CAR: ${placement}. The part belongs in this anatomical zone — do not place it elsewhere.`
    : `Place the part in its anatomically correct location based on its shape (e.g. side scoop on side intake, splitter on front bumper).`;

  /* ─── STEP 1: On-car carbon composite ─── */
  let fitUrlPublic: string | null = null;
  if (carRefDataUrl) {
    const onCarPrompt = buildOnCarPrompt({
      mode, carLabel, carColor, partDescription,
      hasRefs: refDataUrls.length > 0, refCount: refDataUrls.length,
      placementLine: PLACEMENT_LINE, notesBlock: NOTES_BLOCK,
    });

    const onCarRefs = [carRefDataUrl, ...refDataUrls];
    const result = await runWithRetry(onCarPrompt, onCarRefs);
    if (!result.ok) {
      await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: result.error ?? "on-car render failed" }).eq("id", prototype_id);
    } else {
      const uploaded = await uploadDataUrl(admin, result.dataUrl!, userId, prototype_id, "on-car");
      if (uploaded.ok) {
        fitUrlPublic = uploaded.url!;
        await admin.from("prototypes").update({
          fit_preview_status: "ready",
          fit_preview_url: fitUrlPublic,
          fit_preview_error: null,
        }).eq("id", prototype_id);
      } else {
        await admin.from("prototypes").update({ fit_preview_status: "failed", fit_preview_error: uploaded.error ?? "upload failed" }).eq("id", prototype_id);
      }
    }
  }

  /* ─── STEP 2 + 3: Clay hero + clay back ─── */
  const FIDELITY_HERO = mode === "text_design"
    ? `FIDELITY: Design the part cleanly from the description. Aim for a believable, well-resolved aftermarket aero piece.`
    : mode === "exact_photo"
    ? `FIDELITY: REPLICA MODE — copy the part in the reference image as faithfully as possible. Preserve every vent, return, crease, fillet, transition and proportion exactly. Do NOT idealise or "improve" the design.`
    : `FIDELITY: Use the reference photos as INSPIRATION — capture the overall character and key shapes, but produce a cleaner, more refined version.`;

  const renders: Array<{ angle: string; url: string }> = [];
  let heroDataUrl: string | null = null;

  for (const angle of ANGLES) {
    const isHero = angle.key === "hero";
    const promptText = isHero
      ? buildHeroPrompt({
          mode, partDescription, carContext, refCount: refDataUrls.length,
          fidelityLine: FIDELITY_HERO, notesBlock: NOTES_BLOCK, angleLabel: angle.label,
        })
      : buildBackPrompt({
          fidelityLine: FIDELITY_HERO, notesBlock: NOTES_BLOCK, angleLabel: angle.label,
        });

    const refsForAngle = isHero
      ? refDataUrls
      : (heroDataUrl ? [heroDataUrl, ...refDataUrls] : refDataUrls);

    const result = await runWithRetry(promptText, refsForAngle);
    if (!result.ok) {
      await admin.from("prototypes").update({ render_status: "failed", render_error: result.error ?? "render failed" }).eq("id", prototype_id);
      throw new Error(`Image gen failed: ${result.error ?? "unknown"}`);
    }
    const uploaded = await uploadDataUrl(admin, result.dataUrl!, userId, prototype_id, angle.key);
    if (!uploaded.ok) {
      await admin.from("prototypes").update({ render_status: "failed", render_error: uploaded.error ?? "upload failed" }).eq("id", prototype_id);
      throw new Error(uploaded.error ?? "upload failed");
    }
    renders.push({ angle: angle.key, url: uploaded.url! });
    if (isHero) heroDataUrl = result.dataUrl!;
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
}

/* ───────────────────────── Prompt builders ───────────────────────── */

function buildOnCarPrompt(args: {
  mode: GenMode; carLabel: string; carColor: string; partDescription: string;
  hasRefs: boolean; refCount: number; placementLine: string; notesBlock: string;
}): string {
  const carLine = `THE CAR (first image): ${args.carLabel}${args.carColor ? ` (${args.carColor})` : ""}.`;
  const carRules = [
    `- Output MUST be the same car, same angle, same body colour, same lighting, same background, same wheels, same proportions, same reflections.`,
    `- Do NOT crop the car. The whole car must remain visible with comfortable margin.`,
    `- The ONLY change to the car is the addition of the part below.`,
  ].join("\n");

  const partBlock = args.mode === "text_design"
    ? [
        `THE PART (designed from description): ${args.partDescription}.`,
        args.placementLine,
        `- Render in real glossy 2x2 twill CARBON FIBRE with a clear-coat. Match the car's lighting and reflections so it looks bonded on, not pasted.`,
        `- Match scale and perspective.`,
        `- Do NOT add bolts, rivets, mounting tabs, fasteners. No logos, badges or decals.`,
      ].join("\n")
    : args.mode === "exact_photo"
    ? [
        `THE PART (remaining ${args.refCount} reference image(s)) — NON-NEGOTIABLE EXACT REPLICA:`,
        `- You MUST replicate the part shown in the reference image. Trace its outline. Copy its opening shape, every vent, every slat, every fin, every return, every crease. Match proportions exactly.`,
        `- DO NOT invent a generic part. DO NOT substitute a similar-looking part. DO NOT idealise.`,
        args.placementLine,
        `- Render in real glossy 2x2 twill CARBON FIBRE with a clear-coat. Match the car's lighting and reflections so it looks bonded on.`,
        `- Match scale and perspective so it looks like it actually fits.`,
        `- Do NOT add bolts, rivets, mounting tabs, fasteners — assume it's bonded on.`,
        `- STRIP all logos, badges, embossed text and decals from the part.`,
      ].join("\n")
    : [
        `THE PART (remaining ${args.refCount} reference image(s)) — INSPIRATION ONLY:`,
        `- Use the reference photos as inspiration for the part's character and key shapes, but produce a clean, refined version.`,
        args.placementLine,
        `- Render in real glossy 2x2 twill CARBON FIBRE with a clear-coat. Match the car's lighting and reflections.`,
        `- Match scale and perspective.`,
        `- No bolts, fasteners, logos, badges or decals.`,
      ].join("\n");

  return [
    `You are editing the FIRST image (the car) by bonding an aftermarket aero part onto it.`,
    ``,
    carLine,
    carRules,
    ``,
    partBlock,
    ``,
    `Output: ONE clean photoreal image of the whole car with the part fitted in carbon fibre. No labels, annotations, split-screen, text, watermarks or inset thumbnails.`,
    args.notesBlock,
  ].filter(Boolean).join("\n");
}

function buildHeroPrompt(args: {
  mode: GenMode; partDescription: string; carContext: string; refCount: number;
  fidelityLine: string; notesBlock: string; angleLabel: string;
}): string {
  const ctx = args.carContext ? `Car context (for proportions only): ${args.carContext}.` : "";
  const sourceLine = args.mode === "text_design"
    ? `Design and render an aftermarket car part from this description: ${args.partDescription}.`
    : args.mode === "exact_photo"
    ? `You are looking at ${args.refCount} reference image(s) of an aftermarket car part. RE-DRAW THE EXACT SAME PART as a standalone clay model. Match the silhouette, depth, curvature, vents, returns, and proportions exactly.`
    : `You are looking at ${args.refCount} reference photo(s) of an aftermarket car part. Use them as inspiration to design a clean, refined version of the part as a standalone clay model.`;

  return [
    sourceLine, ctx, ``,
    `Render as a STANDALONE AFTERMARKET COMPONENT, completely detached, photographed alone for a parts catalogue.`,
    `Give it real section thickness and a believable inner / reverse face wherever visible.`,
    `IMPORTANT: this part will be BONDED OR BOLTED ON AFTER PRINTING. Do NOT add bolt holes, fasteners, mounting tabs, flanges, brackets or hardware.`,
    ``,
    args.fidelityLine,
    args.notesBlock,
    `SURFACE: ${SURFACE}`,
    `SHELL: ${SHELL}`,
    ``,
    `STRICT ISOLATION:`,
    `- The part is FULLY DETACHED. White seamless cyclorama background.`,
    `- ABSOLUTELY NO car body in the frame.`,
    `- ONLY ONE PART in the output.`,
    ``,
    `Output requirements:`,
    `- Pure white seamless background, edge to edge.`,
    `- Soft even studio lighting, gentle ground contact shadow.`,
    `- Part centred, fills 40-55% of frame.`,
    `- Camera angle: ${args.angleLabel}.`,
    `- Clean clay render. No text, no watermarks, no logos.`,
  ].filter(Boolean).join("\n");
}

function buildBackPrompt(args: { fidelityLine: string; notesBlock: string; angleLabel: string }): string {
  return [
    `The FIRST attached image is the hero clay render of a part we already approved.`,
    `Subsequent images are reference material for context only.`,
    ``,
    `TASK: Re-draw the EXACT SAME PART from BEHIND, looking into its hollow inner side.`,
    `Camera angle: ${args.angleLabel}.`,
    ``,
    `CRITICAL — HOLLOW THIN-SHELL PART:`,
    `- The back is an OPEN CONCAVE CAVITY mirroring the outer shape ~2mm inward.`,
    `- We must clearly see INTO the hollow inside.`,
    `- Visible wall thickness around the rim should read as ~2mm.`,
    `- Do NOT render as a solid wedge or mirrored copy of the hero. The back MUST show the hollow interior.`,
    ``,
    `MUST match the hero exactly in outer silhouette, vents, surface curvature, edge treatment and proportions.`,
    `Do NOT invent fasteners, bolt holes, flanges or brackets.`,
    `STRIP all logos, badges, embossed text and decals.`,
    ``,
    args.fidelityLine,
    args.notesBlock,
    `SURFACE: ${SURFACE}`,
    `SHELL: ${SHELL}`,
    ``,
    `Output requirements:`,
    `- Pure white seamless background.`,
    `- Soft even studio lighting that lights INTO the cavity. Gentle ground shadow.`,
    `- Part centred, fills ~60% of frame.`,
    `- Clean clay render. No car, no text, no watermarks, no logos.`,
  ].filter(Boolean).join("\n");
}

/* ───────────────────────── Helpers ───────────────────────── */

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

async function runWithRetry(prompt: string, refs: string[]): Promise<{ ok: boolean; dataUrl?: string; error?: string; status?: number }> {
  let lastErr = "";
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await lovableGenerateImageWithFallback({
      apiKey: LOVABLE_API_KEY,
      prompt,
      referenceImages: refs,
    });
    if (result.ok && result.dataUrl) return { ok: true, dataUrl: result.dataUrl };
    lastStatus = result.status;
    lastErr = `lovable-ai ${result.status ?? "?"}: ${result.error ?? "unknown"}`;
    if (result.status === 429 || result.status === 402 || result.status === 403) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return { ok: false, error: lastErr, status: lastStatus };
}

async function uploadDataUrl(
  admin: any,
  dataUrl: string,
  userId: string,
  prototypeId: string,
  angleKey: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!m) return { ok: false, error: "bad image format" };
  const mime = m[1];
  const bytes = base64ToBytes(m[2]);
  const ext = mime.includes("png") ? "png" : "jpg";
  const path = `${userId}/prototypes/${prototypeId}/${angleKey}-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage.from("concept-renders").upload(path, bytes, { contentType: mime, upsert: true });
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true, url: admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl };
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
