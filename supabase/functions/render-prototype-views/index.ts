/**
 * render-prototype-views
 *
 * Prototyper edge function. Takes 1-5 user-uploaded reference photos of a
 * physical part (on or off a car) and an optional car description, then asks
 * gpt-image-1 to redraw it as a clean clay-style aero part on a white
 * background.
 *
 * NEW behaviour (on-car first):
 *   - If the prototype is linked to a garage car, we generate THREE images in
 *     order, writing progress to the row as we go:
 *        1) ON-CAR carbon composite  → fit_preview_url       (PRIMARY)
 *        2) clay HERO (front 3/4)    → render_urls[0]        (for meshing)
 *        3) clay BACK (hollow back)  → render_urls[1]        (back-of-part check)
 *   - If no garage car is linked, we just render the two clay views as before.
 *
 * Body: { prototype_id: string, revision_note?: string }
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

const SURFACE =
  "Render the part as a smooth uniform matte light-grey clay model. " +
  "ABSOLUTELY NO carbon-fibre weave, NO glossy paint, NO chrome, NO reflections, NO surface texture. " +
  "STRIP ALL LOGOS, BADGES, EMBOSSED TEXT, MODEL NAMES, BRAND MARKS, DECALS AND STICKERS — even if clearly visible in the reference photos. The output must be a clean unbranded shape only. " +
  "Just clean smooth geometry with soft even shading so the SHAPE reads clearly.";

const SHELL =
  "MATERIAL CONSTRUCTION — THIS IS CRITICAL: render this as a HOLLOW thin-shell moulded composite/fibreglass aero part, like a real bonded-on bodykit panel. " +
  "The wall thickness is ~2mm. The part is NOT a solid lump or solid wedge. It is a SHELL with an OPEN BACK / CONCAVE INNER CAVITY. " +
  "Think of it like a plastic mask, a fibreglass scoop, or a vacuum-formed panel — outer surface follows the reference shape, inner surface is a hollow concave cavity that mirrors the outer shape ~2mm inward. " +
  "The part still has its FULL real-world three-dimensional outer shape, height, depth, curvature and flare — do NOT flatten it into a thin ribbon. " +
  "FIXING METHOD IS NOT YOUR PROBLEM: do NOT add bolt holes, screw holes, fastener heads, rivets, mounting tabs, mounting flanges, brackets or clips. The part will be bonded or bolted on AFTER printing.";

const ANGLES = [
  { key: "hero", label: "front 3/4 view, slightly above, hero product shot" },
  { key: "back", label: "rear 3/4 view from behind the part, looking INTO the open hollow inner cavity / underside / mounting face" },
] as const;

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Mark as rendering immediately and kick off the work in the background so
    // we don't hit the 150s idle timeout (3 sequential OpenAI image gens).
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
  admin: ReturnType<typeof createClient>,
  prototype_id: string,
  userId: string,
  revisionNote: string,
): Promise<void> {
  {
    const { data: proto, error: protoErr } = await admin
      .from("prototypes")
      .select("id, user_id, title, car_context, notes, replicate_exact, source_image_urls, garage_car_id")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (protoErr || !proto) throw new Error("Prototype not found");

    const sourceUrls = (proto.source_image_urls as string[] | null) ?? [];
    if (!sourceUrls.length) throw new Error("No source images uploaded");

    // Optional: load garage car ref so we can do on-car shot first.
    let carRefDataUrl: string | null = null;
    let carLabel = "";
    let carColor = "";
    if (proto.garage_car_id) {
      const { data: car } = await admin
        .from("garage_cars")
        .select("make, model, year, trim, color, ref_side_url, ref_front34_url, ref_rear34_url, ref_front_url, ref_rear_url")
        .eq("id", proto.garage_car_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (car) {
        carLabel = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
        carColor = car.color ?? "";
        const carRefUrl =
          car.ref_side_url || car.ref_front34_url || car.ref_rear34_url ||
          car.ref_front_url || car.ref_rear_url;
        if (carRefUrl) {
          try {
            const r = await fetch(carRefUrl);
            if (r.ok) {
              const buf = new Uint8Array(await r.arrayBuffer());
              const mime = r.headers.get("content-type") ?? "image/png";
              carRefDataUrl = `data:${mime};base64,${bytesToBase64(buf)}`;
            }
          } catch (e) { console.warn("car ref fetch failed", e); }
        }
      }
    }

    const initialUpdate: Record<string, unknown> = { render_status: "rendering", render_error: null };
    if (carRefDataUrl) {
      initialUpdate.fit_preview_status = "rendering";
      initialUpdate.fit_preview_error = null;
    }
    await admin.from("prototypes").update(initialUpdate).eq("id", prototype_id);

    // Inline source images as data URLs so OpenAI definitely sees them.
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
    const userNotes = ((proto as any).notes ?? "").toString().trim();
    const replicateExact = !!(proto as any).replicate_exact;
    const combinedNotes = [userNotes, revisionNote].filter(Boolean).join("\n\nREVISION REQUEST (apply on top of any earlier notes):\n");
    const NOTES_BLOCK = combinedNotes
      ? `\nUSER NOTES (HIGHEST PRIORITY — follow these literally, override any conflicting default behaviour):\n${combinedNotes}\n`
      : ``;

    /* ─── STEP 1: On-car carbon composite (if car linked) ─── */
    let fitUrlPublic: string | null = null;
    if (carRefDataUrl) {
      const onCarPrompt = [
        `IMAGE 1 is a photo of the user's car: ${carLabel}${carColor ? ` (${carColor})` : ""}.`,
        `The remaining images are reference photos of an aftermarket aero part the user wants fitted to that car.`,
        ``,
        `TASK: Produce a single photoreal image of IMAGE 1's car with the part from the other images fitted in its correct location, rendered in real CARBON FIBRE.`,
        ``,
        `Rules:`,
        `- Keep the car in IMAGE 1 unchanged: same angle, same colour, same lighting, same background, same wheels, same proportions.`,
        `- Place the part in its anatomically correct location on the car (e.g. side scoop in the side intake area, front splitter on the front bumper, rear wing on the bootlid, etc).`,
        `- Render the part in real glossy 2x2 twill carbon fibre with a clear-coat. Match the scene's lighting and reflections so it looks bonded on, not pasted.`,
        `- Match scale and perspective to the car. The part must look like it belongs there.`,
        `- Do NOT add bolts, rivets, mounting tabs or fasteners — assume it's bonded on.`,
        `- Do NOT add text, badges, logos, watermarks.`,
        `- Output a clean photoreal image, no labels, no annotations, no split-screen.`,
        NOTES_BLOCK,
      ].filter(Boolean).join("\n");

      const onCarRefs = [carRefDataUrl, ...refDataUrls];
      const result = await runWithRetry(onCarPrompt, onCarRefs);
      if (!result.ok) {
        // Don't kill the whole job — record the failure on fit_preview and carry on with clay views.
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
    const FIDELITY_HERO = replicateExact
      ? `FIDELITY: REPLICA MODE — copy the part in the photos as faithfully as possible. Preserve every vent, return, crease, fillet, transition and proportion exactly. Do NOT idealise, smooth out, or "improve" the design. If something is asymmetric in the photos, keep it asymmetric.`
      : `FIDELITY: Re-draw a clean, idealised version of the part — the SHAPE and proportions must match, but you may smooth out manufacturing flaws, scratches, dirt, and odd reflections.`;
    const FIDELITY_BACK = replicateExact
      ? `FIDELITY: REPLICA MODE — match the hero render exactly, no creative reinterpretation.`
      : `FIDELITY: Match the hero render exactly.`;

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
            FIDELITY_HERO,
            NOTES_BLOCK,
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
            `TASK: Re-draw the EXACT SAME PART from BEHIND, looking into its hollow inner side.`,
            `Camera angle: ${angle.label}.`,
            ``,
            `CRITICAL — THIS IS A HOLLOW THIN-SHELL PART, NOT A SOLID OBJECT:`,
            `- The back side is an OPEN CONCAVE CAVITY that mirrors the outer shape ~2mm inward.`,
            `- We must clearly see INTO the hollow inside, like looking inside a plastic mask, a fibreglass scoop, or the back of a vacuum-formed body panel.`,
            `- The visible wall thickness around the rim of the opening must read as ~2mm thin sheet material.`,
            `- Do NOT render this as a solid wedge, solid lump, or mirrored copy of the hero view. The back MUST show the hollow interior.`,
            ``,
            `MUST match the hero image identically in outer silhouette, vents, surface curvature, edge treatment and proportions.`,
            `Do NOT invent fasteners, bolt holes, flanges or brackets — fixing happens after printing.`,
            `STRIP all logos, badges, embossed text, model names and decals — even if visible in the reference photos.`,
            ``,
            FIDELITY_BACK,
            NOTES_BLOCK,
            `SURFACE: ${SURFACE}`,
            `SHELL: ${SHELL}`,
            ``,
            `Output requirements:`,
            `- Pure white seamless background.`,
            `- Soft even studio lighting that lights INTO the cavity so we can see the hollow interior clearly. Gentle ground shadow.`,
            `- Part centred, fills ~60% of frame.`,
            `- Clean clay render. No car, no text, no watermarks, no logos.`,
          ];

      const promptText = promptLines.filter(Boolean).join("\n");
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
}

async function runWithRetry(prompt: string, refs: string[]): Promise<{ ok: boolean; dataUrl?: string; error?: string; status?: number }> {
  let lastErr = "";
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await openaiGenerateImage({
      apiKey: OPENAI_API_KEY,
      prompt,
      referenceImages: refs,
      size: "1536x1024",
      quality: "high",
    });
    if (result.ok && result.dataUrl) return { ok: true, dataUrl: result.dataUrl };
    lastStatus = result.status;
    lastErr = `openai ${result.status ?? "?"}: ${result.error ?? "unknown"}`;
    if (result.status === 429 || result.status === 402 || result.status === 403) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return { ok: false, error: lastErr, status: lastStatus };
}

async function uploadDataUrl(
  admin: ReturnType<typeof createClient>,
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
