/**
 * generate-concepts
 *
 * Given a project + design brief (and optionally a viewer screenshot of the
 * uploaded car), generate 3 styling concept variations using Lovable AI's
 * image model. Each generated image is uploaded to the `concept-renders`
 * bucket and inserted as a `concepts` row tied to the project.
 *
 * Body shape:
 *   { project_id: string; brief_id: string; snapshot_data_url?: string }
 *
 * Returns: { count: number, concept_ids: string[] }
 *
 * Notes
 * - We deliberately do NOT promise photorealistic concept-to-mesh fidelity.
 *   These renders are creative direction; geometry comes from the parametric
 *   parts pipeline downstream.
 * - Auth: caller must be the owner of `project_id` (RLS enforces this on the
 *   final concept insert via service role check).
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

type AngleKey = "front_three_quarter" | "side" | "rear_three_quarter" | "rear";

interface Body {
  project_id: string;
  brief_id: string;
  /** Legacy single snapshot (front 3/4). Kept for backward compatibility. */
  snapshot_data_url?: string | null;
  /** Map of camera preset -> data URL. Preferred input. */
  snapshots?: Partial<Record<AngleKey, string | null>>;
}

/**
 * Three deliberately divergent design directions. The brief always wins on
 * specifics (colour, era, vibe, constraints) — these only set the *intensity*
 * and *purpose* axis so the user gets meaningfully different options instead
 * of three near-identical renders.
 */
const VARIATIONS: Array<{ title: string; direction: string; modifier: string; emphasis: string }> = [
  {
    title: "OEM+ refined",
    direction: "Subtle, road-friendly enhancements that keep the factory identity. Clean splitter, modest skirts, restrained ducktail. No giant wing, no flared arches.",
    modifier: "OEM+ subtle styling, factory-respectful body kit, clean lines, premium street look, minimal aero",
    emphasis: "Restraint. The car must still read as a tasteful factory-plus build. Absolutely NO oversized rear wing, NO widebody arches, NO exposed canards.",
  },
  {
    title: "Track-focused aggression",
    direction: "Aggressive aero kit with deep front splitter, multiple canards, prominent freestanding rear wing on swan-neck mounts, full rear diffuser. Function over form.",
    modifier: "aggressive track build, deep front splitter, large freestanding swan-neck rear wing, multiple exposed canards, dive planes, full diffuser, race-inspired bodywork, hood vents",
    emphasis: "Maximum motorsport aero. The rear wing MUST be large and freestanding (not a ducktail). Visible canards and dive planes on the front bumper are required.",
  },
  {
    title: "Widebody GT",
    direction: "Widebody flared arches front and rear, GT-style splitter, integrated side skirts, motorsport-grade rear wing, aggressive fitment with the wheels filling the new arches.",
    modifier: "widebody GT aero kit, heavily flared front and rear arches, motorsport rear wing, GT3-inspired bodywork, fitment-focused stance, wide track, lowered ride height",
    emphasis: "Width. The arches MUST be visibly flared/bolted-on, the track MUST be wider than stock, the wheels MUST fill the new arches. This is a wide car.",
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.project_id || !body?.brief_id) {
      return json({ error: "project_id and brief_id are required" }, 400);
    }

    // Auth user
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load brief
    const { data: brief, error: bErr } = await admin
      .from("design_briefs")
      .select("*")
      .eq("id", body.brief_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (bErr || !brief) return json({ error: "Brief not found" }, 404);

    // Optional style preset — RLS allows owner OR public, so service role read is fine.
    let preset: any = null;
    if ((brief as any).style_preset_id) {
      const { data: p } = await admin
        .from("style_presets")
        .select("*")
        .eq("id", (brief as any).style_preset_id)
        .maybeSingle();
      preset = p;
    }

    // Resolve concept_set
    const { data: cs } = await admin
      .from("concept_sets")
      .select("id")
      .eq("project_id", body.project_id)
      .eq("user_id", userId)
      .order("created_at")
      .limit(1)
      .maybeSingle();

    // Load the subject vehicle so the prompt can anchor the AI to the right
    // make/model. Without this, text-only generation drifts to whatever the
    // model feels like (we've seen a "Boxster" project come back as a BRZ).
    let vehicleLabel = "";
    {
      const { data: proj } = await admin
        .from("projects")
        .select("name, car:cars(name, template:car_templates(make, model, trim, year_range))")
        .eq("id", body.project_id)
        .maybeSingle();
      const tmpl: any = (proj as any)?.car?.template;
      if (tmpl?.make && tmpl?.model) {
        vehicleLabel = `${tmpl.make} ${tmpl.model}${tmpl.trim ? " " + tmpl.trim : ""}${tmpl.year_range ? ` (${tmpl.year_range})` : ""}`;
      } else if ((proj as any)?.car?.name) {
        vehicleLabel = (proj as any).car.name;
      } else if ((proj as any)?.name) {
        vehicleLabel = (proj as any).name;
      }
    }

    // When a style preset is used, IT IS AUTHORITATIVE. We deliberately
    // ignore the per-project brief's tags / constraints / build type so the
    // same DNA gets applied uniformly to every car the user runs through it
    // (just like a real shop's signature kit — Pandem, RWB, Liberty Walk).
    // The brief's free-text prompt is still appended as an optional addendum
    // for car-specific notes (e.g. "keep the factory headlights").
    const presetMode = !!preset;
    const styleTags = presetMode
      ? (Array.isArray(preset?.style_tags) ? preset.style_tags : [])
      : (Array.isArray(brief.style_tags) ? brief.style_tags : []);
    const styleConstraints = presetMode
      ? (Array.isArray(preset?.constraints) ? preset.constraints : [])
      : (Array.isArray(brief.constraints) ? brief.constraints : []);
    const buildType = presetMode
      ? (preset?.build_type || null)
      : (brief.build_type || null);

    const stylePrompt = [
      vehicleLabel
        ? `SUBJECT VEHICLE (highest priority — the result MUST be this exact car, no other model): ${vehicleLabel}.`
        : "",
      preset?.prompt ? `Style DNA — ${preset.name} (this is the signature kit, apply it to the subject vehicle above): ${preset.prompt}` : "",
      brief.prompt ? (presetMode ? `Car-specific notes (do not override the style DNA): ${brief.prompt}` : `Project brief: ${brief.prompt}`) : "",
      buildType ? `Build type: ${buildType}.` : "",
      styleTags.length ? `Style tags: ${styleTags.join(", ")}.` : "",
      styleConstraints.length ? `Constraints: ${styleConstraints.join("; ")}.` : "",
    ].filter(Boolean).join(" ");

    // Pick the variation set. With a preset, all three variations stay within
    // the preset DNA (only intensity/spec differs) so the user gets three
    // takes of the *same* style instead of three different shops' styles.
    const variations = presetMode ? presetVariations(preset) : VARIATIONS;

    const inserted: string[] = [];



    // Normalise snapshots: prefer per-angle map, fall back to legacy single image.
    const snaps: Record<AngleKey, string | null> = {
      front_three_quarter: body.snapshots?.front_three_quarter ?? body.snapshot_data_url ?? null,
      side: body.snapshots?.side ?? null,
      rear_three_quarter: body.snapshots?.rear_three_quarter ?? null,
      rear: body.snapshots?.rear ?? body.snapshots?.rear_three_quarter ?? null,
    };

    const ANGLES: Array<{ key: AngleKey; label: string; framing: string }> = [
      { key: "front_three_quarter", label: "front three-quarter",
        framing: "three-quarter front view, slight low angle, full car in frame" },
      { key: "side", label: "side profile",
        framing: "pure side profile view, perpendicular to the car, full body in frame" },
      { key: "rear_three_quarter", label: "rear three-quarter",
        framing: "three-quarter rear view from the opposite side, full car in frame" },
      { key: "rear", label: "rear",
        framing: "direct rear view showing the full back of the car, taillights visible" },
    ];

    console.log("generate-concepts: snapshots present =",
      Object.fromEntries(Object.entries(snaps).map(([k, v]) => [k, !!v])));

    /**
     * Render one angle for a variation.
     *
     * `referenceImages` is an ordered list of reference data URLs / public URLs
     * to send alongside the prompt. The first reference is treated as the
     * primary identity anchor (the user's car for the front pass, or the
     * just-generated front concept for the side/rear passes).
     *
     * Returns both the public URL (for DB) and a data URL (for chaining as
     * a reference into subsequent angle calls).
     */
    async function renderAngle(
      v: typeof VARIATIONS[number],
      angle: typeof ANGLES[number],
      referenceImages: string[],
      mode: "from_user_car" | "from_concept_front",
    ): Promise<{ publicUrl: string; dataUrl: string } | null> {
      const hasRef = referenceImages.length > 0;

      const fromUserPrompt =
        `Re-render THE EXACT CAR shown in the reference image with an added ${v.modifier} body kit, ` +
        `framed as a ${angle.framing}. ` +
        `CRITICAL: Preserve the original car's identity — same make and model, same body shape, ` +
        `same silhouette, same greenhouse, same headlight and taillight design, same wheelbase, ` +
        `same door and window lines, same overall proportions. Do NOT replace the car with a ` +
        `different model. ` +
        `Only add or modify bolt-on aero/styling parts (front splitter, side skirts, arches, rear ` +
        `diffuser, wing, canards) consistent with the styling brief. ` +
        `\n\nDESIGN DIRECTION (this variation): ${v.direction} ` +
        `\nKEY EMPHASIS: ${v.emphasis} ` +
        `\n\nUSER BRIEF (highest priority — must be reflected in the result): ${stylePrompt} ` +
        `\n\nStudio lighting, dark dramatic backdrop, photorealistic, sharp focus, clean reflections, ` +
        `no text, no watermark, no UI overlays.`;

      const fromConceptPrompt =
        `The reference image shows a custom car concept (front three-quarter view) with a specific ` +
        `body kit, paint colour, and wheels. Render THE SAME EXACT CAR — same make, model, ` +
        `silhouette, paint colour, wheels, and body kit details (splitter, skirts, arches, wing, ` +
        `diffuser, canards) — but viewed from a different camera angle: ${angle.framing}. ` +
        `CRITICAL: This must look like the same physical car as the reference, just photographed ` +
        `from another side. Do NOT change the colour, do NOT change the wheels, do NOT change the ` +
        `aero kit shapes. Match the reference's lighting style, backdrop, and overall mood. ` +
        `Studio lighting, dark dramatic backdrop, photorealistic, sharp focus, clean reflections, ` +
        `no text, no watermark, no UI overlays.`;

      const textPrompt =
        `Premium automotive concept render of a custom car body kit, ${angle.framing}. ` +
        `${v.modifier}. ` +
        `\n\nDESIGN DIRECTION: ${v.direction} ` +
        `\nKEY EMPHASIS: ${v.emphasis} ` +
        `\n\nUSER BRIEF (highest priority — must be reflected in the result): ${stylePrompt} ` +
        `\n\nStudio lighting, dark dramatic backdrop, photorealistic, concept design quality, ` +
        `sharp focus, clean reflections, no text, no watermark.`;

      const promptText = !hasRef
        ? textPrompt
        : mode === "from_concept_front"
          ? fromConceptPrompt
          : fromUserPrompt;

      const messages: any[] = [{
        role: "user",
        content: [{ type: "text", text: promptText }],
      }];
      for (const ref of referenceImages) {
        messages[0].content.push({ type: "image_url", image_url: { url: ref } });
      }

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-image-preview",
          messages,
          modalities: ["image", "text"],
        }),
      });

      if (!aiResp.ok) {
        const t = await aiResp.text();
        console.error(`AI gen failed (${v.title} / ${angle.key}):`, aiResp.status, t.slice(0, 200));
        if (aiResp.status === 429) throw new Error("__RATE_LIMIT__");
        if (aiResp.status === 402) throw new Error("__NO_CREDITS__");
        return null;
      }

      const rawText = await aiResp.text();
      if (!rawText) {
        console.error(`AI gen empty body (${v.title} / ${angle.key})`);
        return null;
      }
      let aiJson: any;
      try {
        aiJson = JSON.parse(rawText);
      } catch (parseErr) {
        console.error(`AI gen JSON parse failed (${v.title} / ${angle.key}):`, rawText.slice(0, 200));
        return null;
      }
      const imgUrl: string | undefined =
        aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!imgUrl?.startsWith("data:image/")) {
        console.error(`AI gen no image (${v.title} / ${angle.key}):`, JSON.stringify(aiJson).slice(0, 200));
        return null;
      }

      const [, mime, b64] = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i) ?? [];
      if (!b64) return null;

      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ext = mime?.includes("jpeg") ? "jpg" : "png";
      const path = `${userId}/${body.project_id}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await admin.storage
        .from("concept-renders")
        .upload(path, bytes, { contentType: mime, upsert: false });
      if (upErr) {
        console.error("upload failed:", upErr);
        return null;
      }
      const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
      return { publicUrl, dataUrl: imgUrl };
    }

    try {
      for (const v of variations) {
        const frontAngle = ANGLES[0];
        const otherAngles = ANGLES.slice(1);

        // 1) Generate the FRONT concept first using the user's car snapshot(s)
        //    as identity reference. This becomes the source of truth for paint,
        //    wheels, and body kit details.
        const userFrontRef = snaps.front_three_quarter;
        const frontRefs = userFrontRef && userFrontRef.startsWith("data:image/")
          ? [userFrontRef]
          : [];
        const frontResult = await renderAngle(v, frontAngle, frontRefs, "from_user_car");

        if (!frontResult) {
          console.warn("Front render failed for variation:", v.title);
          continue;
        }

        // 2) Generate the OTHER 3 angles in parallel, using the just-generated
        //    front concept as the primary reference. Optionally include the
        //    user's snapshot for that angle as a secondary geometry hint.
        const otherResults = await Promise.all(otherAngles.map((a) => {
          const userAngleRef = snaps[a.key];
          const refs: string[] = [frontResult.dataUrl];
          if (userAngleRef && userAngleRef.startsWith("data:image/")) {
            refs.push(userAngleRef);
          }
          return renderAngle(v, a, refs, "from_concept_front");
        }));

        const front = frontResult.publicUrl;
        const side = otherResults[0]?.publicUrl ?? null;
        const rear34 = otherResults[1]?.publicUrl ?? null;
        const rear = otherResults[2]?.publicUrl ?? null;

        if (!front && !side && !rear34 && !rear) {
          console.warn("All angles failed for variation:", v.title);
          continue;
        }

        const { data: concept, error: cErr } = await admin
          .from("concepts")
          .insert({
            user_id: userId,
            project_id: body.project_id,
            concept_set_id: cs?.id ?? null,
            title: v.title,
            direction: v.direction,
            status: "pending",
            render_front_url: front,
            render_side_url: side,
            render_rear34_url: rear34,
            render_rear_url: rear,
            ai_notes: stylePrompt.slice(0, 500),
          })
          .select("id")
          .single();
        if (cErr) {
          console.error("concept insert failed:", cErr);
          continue;
        }
        inserted.push(concept.id);
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg === "__RATE_LIMIT__") return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (msg === "__NO_CREDITS__") return json({ error: "AI credits exhausted." }, 402);
      throw err;
    }

    if (inserted.length === 0) {
      return json({ error: "No concepts could be generated. Please try again." }, 500);
    }

    // Bump project status
    await admin
      .from("projects")
      .update({ status: "concepts" })
      .eq("id", body.project_id)
      .eq("user_id", userId);

    return json({ count: inserted.length, concept_ids: inserted });
  } catch (e) {
    console.error("generate-concepts error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * When a style preset is active, all three variations stay inside its DNA.
 * Only the *intensity* and *spec* changes — never the design language. This
 * means the user gets three takes of (e.g.) Pandem applied to their car,
 * not OEM+ vs Pandem vs Widebody-GT.
 */
function presetVariations(preset: any): Array<{ title: string; direction: string; modifier: string; emphasis: string }> {
  const name = preset?.name ?? "preset";
  const dna = preset?.prompt ?? "";
  return [
    {
      title: `${name} — street spec`,
      direction: `${name} signature kit applied at a road-friendly intensity. Same design language as the preset, slightly toned down for street use. ${dna}`,
      modifier: `${name} style body kit, signature design language, road-friendly proportions`,
      emphasis: `Stay 100% inside the ${name} design language. Do NOT introduce shapes or details from outside the preset DNA.`,
    },
    {
      title: `${name} — full kit`,
      direction: `${name} signature kit at its full, definitive intensity — exactly as the preset describes. ${dna}`,
      modifier: `${name} style body kit, full signature kit, definitive proportions, signature wing/arches/splitter as per the preset`,
      emphasis: `This is the canonical ${name} look on this car. Hit every signature element of the preset.`,
    },
    {
      title: `${name} — track spec`,
      direction: `${name} signature kit pushed to its most aggressive track-ready spec, while staying recognisably ${name}. Larger wing, deeper splitter, more vents — but using the preset's design vocabulary, not a different one. ${dna}`,
      modifier: `${name} style body kit, track-spec, larger rear wing, deeper splitter, additional vents and canards in the preset's design language`,
      emphasis: `Maximum aggression but the silhouette must still read as ${name}. Do NOT swap to a generic GT3 or generic time-attack look.`,
    },
  ];
}
