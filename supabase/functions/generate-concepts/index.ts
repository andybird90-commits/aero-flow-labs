/**
 * generate-concepts
 *
 * Brief-first concept generator.
 *
 * Order of authority for the prompt:
 *   1. Discipline (time attack / drift / stance / GT / rally / show / street)
 *   2. Aggression (subtle / moderate / aggressive / extreme)
 *   3. User free-text brief + must_include / must_avoid
 *   4. Variation flavour (only used to differentiate the 4 tiles)
 *   5. Car identity (keep same model + colour)
 *
 * Variation labels are generated dynamically from the brief so an aggressive
 * time-attack brief never gets an "OEM+ refined" tile back.
 *
 * Body shape:
 *   { project_id; brief_id; snapshot_data_url?; snapshots?;
 *     variation_index?; extra_modifier?; variation_seed? }
 *
 * Returns:
 *   { ok: true, queued: true } when batched in the background
 *   { count, concept_ids, variation_index } for an internal single run
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/generate-concepts`;

type AngleKey =
  | "front"
  | "front_three_quarter"
  | "side"
  | "side_opposite"
  | "rear_three_quarter"
  | "rear";

interface Body {
  project_id: string;
  brief_id: string;
  snapshot_data_url?: string | null;
  snapshots?: Partial<Record<AngleKey, string | null>>;
  variation_index?: number | null;
  /** Optional "make this one different" steer for a single regenerated tile. */
  extra_modifier?: string | null;
  /** Optional explicit variation spec when regenerating one tile. */
  variation_seed?: Variation | null;
}

type Variation = {
  title: string;
  direction: string;
  modifier: string;
  emphasis: string;
};

type Discipline =
  | "time_attack" | "drift" | "stance" | "gt" | "rally" | "show" | "street" | "auto";
type Aggression = "subtle" | "moderate" | "aggressive" | "extreme" | "auto";

type GenerationContext = {
  conceptSetId: string | null;
  stylePrompt: string;
  variations: Variation[];
  snaps: Record<AngleKey, string | null>;
  discipline: Discipline;
  aggression: Aggression;
  mustInclude: string[];
  mustAvoid: string[];
  vehicleLabel: string;
  briefText: string;
  presetMode: boolean;
};

/* ─── Discipline & aggression baselines ─────────────────────── */

const DISCIPLINE_AERO: Record<Exclude<Discipline, "auto">, string[]> = {
  time_attack: [
    "large freestanding rear wing on swan-neck mounts",
    "deep front splitter with multiple canards/dive planes",
    "hood vents or louvers",
    "wide overfenders or fender flares",
    "side skirts with strakes",
    "aggressive low stance with the wheels filling the arches",
  ],
  drift: [
    "wide overfenders with rivet detail",
    "front lip splitter and side skirt extensions",
    "ducktail or low-mount wing",
    "low stance with significant negative camber on the rear wheels",
    "exposed tow hooks",
  ],
  stance: [
    "no big wing — clean rear",
    "very low ride height, hellaflush wheel fitment",
    "subtle lip splitter and side skirts",
    "stretched tyres on wide wheels with aggressive camber",
  ],
  gt: [
    "GT3-style widebody arches front and rear",
    "deep splitter with end-plates",
    "tall freestanding rear wing on swan-neck mounts",
    "full rear diffuser with vertical strakes",
    "side skirts with motorsport detailing",
  ],
  rally: [
    "wide plastic-look overfenders",
    "raised ride height with longer-travel suspension",
    "mud flaps and skid plate",
    "roof scoop or vents",
    "auxiliary lights on the front bumper",
  ],
  show: [
    "smoothed body lines, shaved details",
    "custom widebody or subtle widebody",
    "show-finish paint or wrap",
    "deep dished wheels",
  ],
  street: [
    "tasteful lip splitter",
    "subtle side skirts",
    "mild ducktail or no wing",
    "moderate drop on stock-style wheels",
  ],
};

const AGGRESSION_TONE: Record<Exclude<Aggression, "auto">, string> = {
  subtle:
    "Keep the factory identity intact — restrained OEM+ enhancements, road-friendly, no oversized aero, no flared arches.",
  moderate:
    "Noticeably modified but still street-legal — clear lip splitter, mild arches, subtle wing or ducktail.",
  aggressive:
    "Heavily modified track-oriented build. Factory identity is secondary to function. Big aero is expected.",
  extreme:
    "Full silhouette / wide-body / time-attack build. The OEM car is only a starting point — go all-in on aero, arches and stance.",
};

/* ─── Heuristic discipline/aggression sniffing ──────────────── */

function sniffDiscipline(text: string, buildType: string | null): Discipline {
  const t = `${text} ${buildType ?? ""}`.toLowerCase();
  if (/time[-\s]?attack/.test(t)) return "time_attack";
  if (/\bdrift/.test(t)) return "drift";
  if (/\bstance|hellaflush|fitment/.test(t)) return "stance";
  if (/\bgt[-\s]?(race|3|car)?\b/.test(t)) return "gt";
  if (/\brally|gravel|tarmac\b/.test(t)) return "rally";
  if (/\bshow[-\s]?car|sema\b/.test(t)) return "show";
  if (/\b(daily|street|road)\b/.test(t)) return "street";
  return "auto";
}

function sniffAggression(text: string, styleTags: string[]): Aggression {
  const t = `${text} ${styleTags.join(" ")}`.toLowerCase();
  if (/\b(extreme|silhouette|max(imal|imum)?|full[-\s]?send|insane|bonkers)\b/.test(t)) return "extreme";
  if (/\b(aggressive|aggro|wild|hardcore|race|track|time[-\s]?attack|gt[-\s]?3)\b/.test(t)) return "aggressive";
  if (/\b(subtle|oem\+?|restrained|tasteful|minimal|clean)\b/.test(t)) return "subtle";
  if (/\b(moderate|noticeable|mild|street usable)\b/.test(t)) return "moderate";
  return "auto";
}

/* ─── Static fallback variations (used only when AI variation gen fails) ── */

const FALLBACK_VARIATIONS: Variation[] = [
  {
    title: "Hero direction",
    direction: "Strongest interpretation of the brief — every signature feature is present and dialled in.",
    modifier: "primary direction body kit, definitive proportions, signature aero",
    emphasis: "Hit the brief. No restraint unless the brief asks for it.",
  },
  {
    title: "Alternate direction",
    direction: "Same intent as the hero direction but with a different stylistic flavour (e.g. JDM vs Euro vs GT3).",
    modifier: "alternative styling vocabulary, same intensity, different cultural reference",
    emphasis: "Same aggression level as the hero, different visual language.",
  },
  {
    title: "Wider / arch-focused",
    direction: "Lean into width — flared arches front and rear, fitment-focused stance.",
    modifier: "widebody arches, wide track, fitment-focused stance, lowered ride height",
    emphasis: "The car must visibly read as wide. Same brief otherwise.",
  },
  {
    title: "Aero-max direction",
    direction: "Same brief intent with the most functional aero package: wing, splitter, vents, skirts and diffuser all clearly visible.",
    modifier: "maximum functional aero, big wing, deep splitter, canards, vents, skirts, diffuser",
    emphasis: "Do not return a near-stock car. The aero package must be obvious at thumbnail size.",
  },
];

const ANGLES: Array<{ key: AngleKey; label: string; framing: string }> = [
  { key: "front_three_quarter", label: "front three-quarter",
    framing: "three-quarter front view from the driver's side, slight low angle, full car in frame" },
  { key: "front", label: "front",
    framing: "direct front view, perpendicular to the car, headlights and grille fully visible, full width in frame" },
  { key: "side", label: "side profile",
    framing: "pure side profile view from the driver's side, perpendicular to the car, full body in frame" },
  { key: "side_opposite", label: "side profile (opposite)",
    framing: "pure side profile view from the passenger side, perpendicular to the car, full body in frame — show any asymmetric details like the fuel filler cap on this side" },
  { key: "rear_three_quarter", label: "rear three-quarter",
    framing: "three-quarter rear view from the passenger side, full car in frame" },
  { key: "rear", label: "rear",
    framing: "direct rear view showing the full back of the car, taillights visible" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    if (!body?.project_id || !body?.brief_id) {
      return json({ error: "project_id and brief_id are required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const ctx = await loadGenerationContext(admin, body, userId);

    if (body.variation_index == null) {
      if (ctx.conceptSetId) {
        await admin.from("concept_sets").update({ status: "generating" }).eq("id", ctx.conceptSetId);
      }

      // @ts-ignore EdgeRuntime is provided by Deno.
      EdgeRuntime.waitUntil(queueAllVariations({ authHeader, body, variationCount: ctx.variations.length, conceptSetId: ctx.conceptSetId }).catch(async (e) => {
        console.error("generate-concepts queue failed:", e);
        if (ctx.conceptSetId) {
          await admin.from("concept_sets").update({ status: "failed" }).eq("id", ctx.conceptSetId);
        }
      }));

      return json({ ok: true, queued: true });
    }

    if (!Number.isInteger(body.variation_index) || body.variation_index < 0 || body.variation_index >= ctx.variations.length) {
      return json({ error: "variation_index out of range" }, 400);
    }

    const conceptId = await runSingleVariation({
      admin,
      body,
      userId,
      context: ctx,
      variationIndex: body.variation_index,
    });

    if (!conceptId) {
      return json({ error: "Variation generation failed" }, 500);
    }

    return json({ count: 1, concept_ids: [conceptId], variation_index: body.variation_index });
  } catch (e) {
    console.error("generate-concepts error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function loadGenerationContext(admin: any, body: Body, userId: string): Promise<GenerationContext> {
  const { data: brief, error: bErr } = await admin
    .from("design_briefs")
    .select("*")
    .eq("id", body.brief_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (bErr || !brief) throw new Error("Brief not found");

  let preset: any = null;
  if ((brief as any).style_preset_id) {
    const { data: p } = await admin
      .from("style_presets")
      .select("*")
      .eq("id", (brief as any).style_preset_id)
      .maybeSingle();
    preset = p;
  }

  const { data: cs } = await admin
    .from("concept_sets")
    .select("id")
    .eq("project_id", body.project_id)
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

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

  const presetMode = !!preset;
  const styleTags: string[] = presetMode
    ? (Array.isArray(preset?.style_tags) ? preset.style_tags : [])
    : (Array.isArray(brief.style_tags) ? brief.style_tags : []);
  const styleConstraints: string[] = presetMode
    ? (Array.isArray(preset?.constraints) ? preset.constraints : [])
    : (Array.isArray(brief.constraints) ? brief.constraints : []);
  const buildType: string | null = presetMode
    ? (preset?.build_type || null)
    : (brief.build_type || null);

  // New explicit fields (with sniff fallback for old briefs).
  const briefText = String(brief.prompt ?? "");
  let discipline: Discipline = ((brief as any).discipline as Discipline) || "auto";
  let aggression: Aggression = ((brief as any).aggression as Aggression) || "auto";
  if (discipline === "auto") discipline = sniffDiscipline(briefText, buildType);
  if (aggression === "auto") aggression = sniffAggression(briefText, styleTags);

  const mustInclude: string[] = Array.isArray((brief as any).must_include) ? (brief as any).must_include : [];
  const mustAvoid: string[] = Array.isArray((brief as any).must_avoid) ? (brief as any).must_avoid : [];

  // Build the master style prompt with discipline/aggression up front.
  const disciplineLine =
    discipline !== "auto"
      ? `BUILD DISCIPLINE (highest priority): ${disciplineHumanLabel(discipline)}. Baseline aero/styling expected for this discipline: ${DISCIPLINE_AERO[discipline].join("; ")}.`
      : "";
  const aggressionLine =
    aggression !== "auto"
      ? `AGGRESSION LEVEL: ${aggression}. ${AGGRESSION_TONE[aggression]}`
      : "";
  const includeLine = mustInclude.length ? `MUST INCLUDE: ${mustInclude.join(", ")}.` : "";
  const avoidLine = mustAvoid.length ? `MUST AVOID: ${mustAvoid.join(", ")}.` : "";

  const stylePrompt = [
    disciplineLine,
    aggressionLine,
    briefText
      ? (presetMode ? `Car-specific notes: ${briefText}` : `User brief: ${briefText}`)
      : "",
    includeLine,
    avoidLine,
    preset?.prompt ? `Style DNA — ${preset.name}: ${preset.prompt}` : "",
    buildType ? `Build type: ${buildType}.` : "",
    styleTags.length ? `Style tags: ${styleTags.join(", ")}.` : "",
    styleConstraints.length ? `Constraints: ${styleConstraints.join("; ")}.` : "",
    vehicleLabel
      ? `SUBJECT VEHICLE (lowest styling priority; only identity/proportions): ${vehicleLabel}.`
      : "",
  ].filter(Boolean).join(" ");

  // If a per-tile seed was supplied (regenerate flow), use just that single
  // variation. Otherwise build dynamic variations from the brief.
  let variations: Variation[];
  if (body.variation_seed) {
    variations = [body.variation_seed];
  } else if (presetMode) {
    variations = presetVariations(preset);
  } else {
    variations = await generateDynamicVariations({
      vehicleLabel,
      discipline,
      aggression,
      briefText,
      mustInclude,
      mustAvoid,
      styleTags,
    });
  }

  const garageRefs: Partial<Record<AngleKey, string>> = {};
  {
    const { data: proj } = await admin
      .from("projects")
      .select("garage_car_id")
      .eq("id", body.project_id)
      .maybeSingle();
    const gcId = (proj as any)?.garage_car_id;
    if (gcId) {
      const { data: gc } = await admin
        .from("garage_cars")
        .select("ref_front_url, ref_front34_url, ref_side_url, ref_side_opposite_url, ref_rear34_url, ref_rear_url")
        .eq("id", gcId)
        .maybeSingle();
      if (gc) {
        if ((gc as any).ref_front_url) garageRefs.front = (gc as any).ref_front_url;
        if ((gc as any).ref_front34_url) garageRefs.front_three_quarter = (gc as any).ref_front34_url;
        if ((gc as any).ref_side_url) garageRefs.side = (gc as any).ref_side_url;
        if ((gc as any).ref_side_opposite_url) garageRefs.side_opposite = (gc as any).ref_side_opposite_url;
        if ((gc as any).ref_rear34_url) garageRefs.rear_three_quarter = (gc as any).ref_rear34_url;
        if ((gc as any).ref_rear_url) garageRefs.rear = (gc as any).ref_rear_url;
        console.log("generate-concepts: using garage car refs =", Object.keys(garageRefs));
      }
    }
  }

  const snaps: Record<AngleKey, string | null> = {
    front: garageRefs.front ?? body.snapshots?.front ?? null,
    front_three_quarter: garageRefs.front_three_quarter ?? body.snapshots?.front_three_quarter ?? body.snapshot_data_url ?? null,
    side: garageRefs.side ?? body.snapshots?.side ?? null,
    side_opposite: garageRefs.side_opposite ?? body.snapshots?.side_opposite ?? null,
    rear_three_quarter: garageRefs.rear_three_quarter ?? body.snapshots?.rear_three_quarter ?? null,
    rear: garageRefs.rear ?? body.snapshots?.rear ?? body.snapshots?.rear_three_quarter ?? null,
  };

  console.log("generate-concepts: discipline=", discipline, "aggression=", aggression,
    "variations=", variations.map(v => v.title));

  return {
    conceptSetId: cs?.id ?? null,
    stylePrompt,
    variations,
    snaps,
    discipline,
    aggression,
    mustInclude,
    mustAvoid,
    vehicleLabel,
    briefText,
    presetMode,
  };
}

function disciplineHumanLabel(d: Exclude<Discipline, "auto">): string {
  return ({
    time_attack: "Time attack",
    drift: "Drift",
    stance: "Stance / fitment",
    gt: "GT race",
    rally: "Rally",
    show: "Show car",
    street: "Street / daily",
  } as const)[d];
}

/* ─── Dynamic variation generation via text model ──────────── */

async function generateDynamicVariations(args: {
  vehicleLabel: string;
  discipline: Discipline;
  aggression: Aggression;
  briefText: string;
  mustInclude: string[];
  mustAvoid: string[];
  styleTags: string[];
}): Promise<Variation[]> {
  const sys =
    "You are an automotive concept director. Given a build brief, propose 4 distinct " +
    "styling DIRECTIONS for the same car. Each direction must respect the discipline and " +
    "aggression — they must NOT differ in aggression. They differ in cultural/stylistic " +
    "vocabulary (e.g. JDM time attack vs Euro touring vs GT3). Never propose OEM+, subtle, mild, clean street, or restrained directions when aggression is aggressive/extreme. Output strict JSON only.";

  const user =
    `Subject: ${args.vehicleLabel || "(unspecified car)"}\n` +
    `Discipline: ${args.discipline}\n` +
    `Aggression: ${args.aggression}\n` +
    `Brief: ${args.briefText || "(none)"}\n` +
    (args.mustInclude.length ? `Must include: ${args.mustInclude.join(", ")}\n` : "") +
    (args.mustAvoid.length ? `Must avoid: ${args.mustAvoid.join(", ")}\n` : "") +
    (args.styleTags.length ? `Style tags: ${args.styleTags.join(", ")}\n` : "") +
    `\nReturn JSON: { "variations": [ { "title": string (≤4 words), ` +
    `"direction": string (1 sentence describing the visual approach), ` +
    `"modifier": string (concrete aero parts list, comma-separated), ` +
    `"emphasis": string (1 sentence — what MUST be visible) } x4 ] }`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      console.warn("dynamic variations failed:", resp.status, (await resp.text()).slice(0, 200));
      return FALLBACK_VARIATIONS;
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return FALLBACK_VARIATIONS;
    const parsed = JSON.parse(content);
    const out = Array.isArray(parsed?.variations) ? parsed.variations : [];
    const cleaned = out
      .filter((v: any) => v?.title && v?.direction && v?.modifier && v?.emphasis)
      .slice(0, 4)
      .map((v: any) => ({
        title: String(v.title).slice(0, 60),
        direction: String(v.direction).slice(0, 400),
        modifier: String(v.modifier).slice(0, 400),
        emphasis: String(v.emphasis).slice(0, 400),
      })) as Variation[];
    if (cleaned.length === 0) return FALLBACK_VARIATIONS;
    return cleaned;
  } catch (e) {
    console.warn("dynamic variations exception:", e);
    return FALLBACK_VARIATIONS;
  }
}

async function runSingleVariation({
  admin,
  body,
  userId,
  context,
  variationIndex,
}: {
  admin: any;
  body: Body;
  userId: string;
  context: GenerationContext;
  variationIndex: number;
}) {
  const v = context.variations[variationIndex];
  const heroAngle = ANGLES.find((a) => a.key === "front_three_quarter")!;
  const otherAngles = ANGLES.filter((a) => a.key !== "front_three_quarter");

  const userFrontRef = context.snaps.front_three_quarter;
  const frontRefs = isImageRef(userFrontRef) ? [userFrontRef] : [];
  const frontResult = await renderAngle({
    admin,
    userId,
    projectId: body.project_id,
    variation: v,
    angle: heroAngle,
    referenceImages: frontRefs,
    mode: "from_user_car",
    stylePrompt: context.stylePrompt,
    aggression: context.aggression,
    discipline: context.discipline,
    extraModifier: body.extra_modifier ?? null,
  });
  if (!frontResult) {
    console.warn("Front 3/4 render failed for variation:", v.title);
    return null;
  }

  const otherResults = await Promise.all(otherAngles.map(async (a) => {
    const userAngleRef = context.snaps[a.key];
    const refs: string[] = [frontResult.publicUrl];
    if (isImageRef(userAngleRef)) refs.push(userAngleRef);
    const result = await renderAngle({
      admin,
      userId,
      projectId: body.project_id,
      variation: v,
      angle: a,
      referenceImages: refs,
      mode: "from_concept_front",
      stylePrompt: context.stylePrompt,
      aggression: context.aggression,
      discipline: context.discipline,
      extraModifier: body.extra_modifier ?? null,
    });
    return { key: a.key, result };
  }));

  const byKey: Partial<Record<AngleKey, string>> = {
    front_three_quarter: frontResult.publicUrl,
  };
  for (const { key, result } of otherResults) {
    if (result?.publicUrl) byKey[key] = result.publicUrl;
  }
  if (Object.keys(byKey).length === 0) {
    console.warn("All angles failed for variation:", v.title);
    return null;
  }

  const { data: concept, error: cErr } = await admin
    .from("concepts")
    .insert({
      user_id: userId,
      project_id: body.project_id,
      concept_set_id: context.conceptSetId,
      title: v.title,
      direction: v.direction,
      status: "pending",
      render_front_url: byKey.front_three_quarter ?? null,
      render_front_direct_url: byKey.front ?? null,
      render_side_url: byKey.side ?? null,
      render_side_opposite_url: byKey.side_opposite ?? null,
      render_rear34_url: byKey.rear_three_quarter ?? null,
      render_rear_url: byKey.rear ?? null,
      ai_notes: context.stylePrompt.slice(0, 500),
      prompt_used: frontResult.promptUsed,
      variation_label: v.title,
      variation_seed: v as any,
    })
    .select("id")
    .single();
  if (cErr) {
    console.error("concept insert failed:", cErr);
    return null;
  }

  return concept.id as string;
}

async function renderAngle({
  admin,
  userId,
  projectId,
  variation,
  angle,
  referenceImages,
  mode,
  stylePrompt,
  aggression,
  discipline,
  extraModifier,
}: {
  admin: any;
  userId: string;
  projectId: string;
  variation: Variation;
  angle: (typeof ANGLES)[number];
  referenceImages: string[];
  mode: "from_user_car" | "from_concept_front";
  stylePrompt: string;
  aggression: Aggression;
  discipline: Discipline;
  extraModifier: string | null;
}): Promise<{ publicUrl: string; dataUrl: string; promptUsed: string } | null> {
  const hasRef = referenceImages.length > 0;

  const carbonFinish =
    `MATERIAL FINISH: every added/modified aero or styling part — splitter, ` +
    `lip, canards, side skirts, arch flares, diffuser, ducktail, wing, hood/wing vents — ` +
    `MUST be finished in glossy 2x2 twill carbon fibre with a clearly visible black weave. ` +
    `OEM body panels (doors, roof, fenders above the splitter) MUST stay in their original ` +
    `factory paint colour. The carbon parts should visually pop against the painted body.`;

  // For aggressive/extreme builds we explicitly relax the "preserve identity" rule.
  const identityRule = aggression === "aggressive" || aggression === "extreme"
    ? `IDENTITY: keep the same make/model/silhouette so it is still recognisable as the ` +
      `subject car, but factory identity is SECONDARY to the brief. You ARE allowed to ` +
      `flare the arches, add a large rear wing, deepen the splitter, vent the hood, and ` +
      `aggressively lower the stance.`
    : `IDENTITY: preserve the original car's identity — same make and model, same body shape, ` +
      `same silhouette, same greenhouse, same headlight/taillight design, same wheelbase, ` +
      `same overall proportions. Do NOT replace the car with a different model.`;

  const disciplineMusts = discipline !== "auto" ? DISCIPLINE_AERO[discipline] : [];
  const intensityRule = aggression === "aggressive" || aggression === "extreme"
    ? `\nNON-NEGOTIABLE INTENSITY: this must NOT look OEM, OEM+, stock, mild, clean street, or subtly modified. ` +
      `It must read as a heavily modified motorsport build at thumbnail size. Required visible features: ${disciplineMusts.join(", ") || variation.modifier}. ` +
      `If the reference image is stock, transform it aggressively rather than preserving stock bumpers, arches or ride height.`
    : "";
  const steerLine = extraModifier ? `\nADDITIONAL STEER (apply on top): ${extraModifier}` : "";

  const fromUserPrompt =
    `Re-render THE EXACT CAR shown in the reference image with an added ${variation.modifier} body kit, ` +
    `framed as a ${angle.framing}. ` +
    `${identityRule} ` +
    `\n\nDESIGN DIRECTION (this variation): ${variation.direction} ` +
    `\nKEY EMPHASIS: ${variation.emphasis}` +
    intensityRule +
    steerLine +
    `\n\n${carbonFinish}` +
    `\n\nBRIEF (highest priority — every render must reflect this): ${stylePrompt} ` +
    `\n\nStudio lighting, dark dramatic backdrop, photorealistic, sharp focus, clean reflections, ` +
    `no text, no watermark, no UI overlays.`;

  const fromConceptPrompt =
    `The reference image shows a custom car concept (front three-quarter view) with a specific ` +
    `body kit, paint colour, and wheels. Render THE SAME EXACT CAR — same make, model, ` +
    `silhouette, paint colour, wheels, and body kit details (splitter, skirts, arches, wing, ` +
    `diffuser, canards) — but viewed from a different camera angle: ${angle.framing}. ` +
    `CRITICAL: This must look like the same physical car as the reference, just photographed ` +
    `from another side. Do NOT change colour, wheels, or aero kit shapes. ` +
    `${intensityRule} ` +
    `${carbonFinish} ` +
    `Studio lighting, dark dramatic backdrop, photorealistic, sharp focus, clean reflections, ` +
    `no text, no watermark, no UI overlays.`;

  const textPrompt =
    `Premium automotive concept render, ${angle.framing}. ` +
    `${variation.modifier}. ` +
    `${identityRule} ` +
    `\n\nDESIGN DIRECTION: ${variation.direction} ` +
    `\nKEY EMPHASIS: ${variation.emphasis}` +
    intensityRule +
    steerLine +
    `\n\n${carbonFinish}` +
    `\n\nBRIEF (highest priority): ${stylePrompt} ` +
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
    console.error(`AI gen failed (${variation.title} / ${angle.key}):`, aiResp.status, t.slice(0, 200));
    if (aiResp.status === 429) throw new Error("__RATE_LIMIT__");
    if (aiResp.status === 402) throw new Error("__NO_CREDITS__");
    return null;
  }

  const rawText = await aiResp.text();
  if (!rawText) {
    console.error(`AI gen empty body (${variation.title} / ${angle.key})`);
    return null;
  }
  let aiJson: any;
  try {
    aiJson = JSON.parse(rawText);
  } catch {
    console.error(`AI gen JSON parse failed (${variation.title} / ${angle.key}):`, rawText.slice(0, 200));
    return null;
  }
  const imgUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUrl?.startsWith("data:image/")) {
    console.error(`Image gen produced no data URL (${variation.title} / ${angle.key})`);
    return null;
  }

  const [, mime, b64] = imgUrl.match(/^data:(image\/[a-z+]+);base64,(.*)$/i) ?? [];
  if (!b64) return null;

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ext = mime?.includes("jpeg") ? "jpg" : "png";
  const path = `${userId}/${projectId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await admin.storage
    .from("concept-renders")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) {
    console.error("upload failed:", upErr);
    return null;
  }

  const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
  return { publicUrl, dataUrl: imgUrl, promptUsed: promptText };
}

async function queueAllVariations({
  authHeader,
  body,
  variationCount,
  conceptSetId,
}: {
  authHeader: string;
  body: Body;
  variationCount: number;
  conceptSetId: string | null;
}) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let successCount = 0;
  const failures: string[] = [];

  for (let variationIndex = 0; variationIndex < variationCount; variationIndex += 1) {
    const resp = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: body.project_id,
        brief_id: body.brief_id,
        snapshot_data_url: body.snapshot_data_url ?? null,
        snapshots: body.snapshots ?? {},
        variation_index: variationIndex,
      }),
    });

    const raw = await resp.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!resp.ok) {
      failures.push(`variation ${variationIndex}: ${raw.slice(0, 200)}`);
      if (resp.status === 402 || resp.status === 429) break;
      continue;
    }

    successCount += Number(parsed?.count ?? 0);
  }

  if (conceptSetId) {
    await admin.from("concept_sets").update({
      status: successCount > 0 ? "ready" : "failed",
    }).eq("id", conceptSetId);
  }

  if (successCount > 0) {
    await admin
      .from("projects")
      .update({ status: "concepts" })
      .eq("id", body.project_id);
  }

  if (failures.length) {
    console.error("generate-concepts queue failures:", failures);
  }
}

function isImageRef(u: string | null | undefined): u is string {
  return !!u && (u.startsWith("data:image/") || u.startsWith("https://") || u.startsWith("http://"));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function presetVariations(preset: any): Variation[] {
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
