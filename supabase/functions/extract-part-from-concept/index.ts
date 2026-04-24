/**
 * extract-part-from-concept
 *
 * Click-to-extract: given a concept + a single part kind (e.g. "wide_arch"),
 * use Gemini Vision to measure JUST that part from the concept renders and
 * return parametric values that the client can serialise to STL.
 *
 * Body: { project_id: string; concept_id: string; part_kind: string }
 * Returns: { kind, params, reasoning }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_KINDS = [
  // Bolt-on parts
  "splitter", "lip", "canard", "side_skirt",
  "wide_arch", "diffuser", "ducktail", "wing",
  "bonnet_vent", "wing_vent",
  // Body-swap panels — these are crops of the swap shell that the meshify
  // worker reconstructs as outer-skin + donor-conformed inner.
  "front_clip", "hood_panel", "fender_panel", "door_skin",
  "side_skirt_panel", "rear_quarter", "rear_clip", "deck_panel",
] as const;
type Kind = typeof ALLOWED_KINDS[number];

/** Body-swap panel kinds get the same default params bag: a normalised crop
 *  rectangle (filled in client-side from the hotspot box) and a flag that
 *  tells meshify-carbon-kit to build an inner skin conformed to the donor
 *  stock panel instead of just a thin outer shell.
 *
 *  conform_to_donor = 1  → meshify worker shrinkwraps the back of the panel
 *                          to the donor body so the kit bolts straight on.
 *  panel_thickness_mm    → fallback wall thickness if the donor surface
 *                          can't be sampled at that point. */
const PANEL_KINDS = new Set<Kind>([
  "front_clip", "hood_panel", "fender_panel", "door_skin",
  "side_skirt_panel", "rear_quarter", "rear_clip", "deck_panel",
]);

const PANEL_DEFAULT_PARAMS = {
  conform_to_donor: 1,
  panel_thickness_mm: 4,
  flange_width_mm: 18,
};

const DEFAULT_PARAMS: Record<Kind, Record<string, number>> = {
  splitter:    { depth: 80,  fence_height: 30, fence_inset: 60 },
  lip:         { depth: 30 },
  canard:      { angle: 12,  count: 1, span: 180 },
  side_skirt:  { depth: 70,  drop: 25 },
  wide_arch:   { flare: 50 },
  diffuser:    { angle: 12,  strake_count: 5, strake_height: 60 },
  ducktail:    { height: 38, kick: 10 },
  wing:        { aoa: 8, chord: 280, gurney: 12, span_pct: 78, stand_height: 220 },
  bonnet_vent: { length: 240, width: 120, louvre_count: 5, depth: 18 },
  wing_vent:   { length: 180, width: 90,  louvre_count: 4, depth: 14 },
  // Panel kinds — same defaults bag, the per-panel crop is filled by the client.
  front_clip:        { ...PANEL_DEFAULT_PARAMS },
  hood_panel:        { ...PANEL_DEFAULT_PARAMS },
  fender_panel:      { ...PANEL_DEFAULT_PARAMS },
  door_skin:         { ...PANEL_DEFAULT_PARAMS, panel_thickness_mm: 3 },
  side_skirt_panel:  { ...PANEL_DEFAULT_PARAMS },
  rear_quarter:      { ...PANEL_DEFAULT_PARAMS },
  rear_clip:         { ...PANEL_DEFAULT_PARAMS },
  deck_panel:        { ...PANEL_DEFAULT_PARAMS, panel_thickness_mm: 3 },
};

/** Per-part hint about which renders matter most.
 *  Only populated for bolt-on kinds — body-swap PANEL kinds short-circuit
 *  before this lookup is used. */
const PART_VIEW_HINT: Partial<Record<Kind, string>> = {
  splitter:    "Look at the FRONT 3/4 view. The splitter is the flat blade protruding forward at the bottom of the front bumper.",
  lip:         "Look at the FRONT 3/4 view. The lip is a thin extension below the splitter / front bumper.",
  canard:      "Look at the FRONT 3/4 view. Canards are small angled foils on the lower front bumper sides.",
  side_skirt:  "Look at the SIDE view. Side skirts are long blades along the rocker panel between the wheels.",
  wide_arch:   "Look at FRONT 3/4 and REAR 3/4 views. Wide arches are bolt-on flares around the wheel openings.",
  diffuser:    "Look at the REAR or REAR 3/4 view. The diffuser is the angled panel under the rear bumper, often with vertical strakes.",
  ducktail:    "Look at the REAR or SIDE view. A DUCKTAIL is a SHORT INTEGRATED LIP rising directly off the bootlid/rear deck — it touches the body and has NO stalks/uprights/gap underneath. If you can see daylight under a blade, that is a WING, not a ducktail.",
  wing:        "Look at the REAR 3/4 or REAR view. A WING is a SEPARATE AEROFOIL BLADE held above the rear deck on visible stalks/swan-necks with a clear gap of air underneath. If there is no gap and no stalks, it is a ducktail, NOT a wing. Estimate angle of attack, chord, span as % of car width, stand height.",
  bonnet_vent: "Look at the FRONT 3/4 view. A bonnet vent is a louvred opening or scoop cut into the bonnet/hood for engine-bay heat extraction.",
  wing_vent:   "Look at the FRONT 3/4 or SIDE view. A wing vent (fender vent) is a louvred opening on the front fender/wing panel behind the wheel arch.",
};

const PARAM_SCHEMA: Partial<Record<Kind, Record<string, { type: "number"; description: string }>>> = {
  splitter: {
    depth:        { type: "number", description: "Forward protrusion in mm (30-200)" },
    fence_height: { type: "number", description: "Side-fence height in mm (0-80)" },
    fence_inset:  { type: "number", description: "Side-fence inset from edge in mm (30-200)" },
  },
  lip: {
    depth: { type: "number", description: "Lip protrusion in mm (10-80)" },
  },
  canard: {
    angle: { type: "number", description: "Canard tilt in degrees (0-30)" },
    count: { type: "number", description: "Canards per side (1 or 2)" },
    span:  { type: "number", description: "Canard span/chord in mm (100-300)" },
  },
  side_skirt: {
    depth: { type: "number", description: "Skirt depth (forward extent) in mm (30-150)" },
    drop:  { type: "number", description: "Vertical drop below rocker in mm (0-60)" },
  },
  wide_arch: {
    flare: { type: "number", description: "Arch flare in mm (0-120)" },
  },
  diffuser: {
    angle:         { type: "number", description: "Diffuser angle in degrees (0-25)" },
    strake_count:  { type: "number", description: "Number of vertical strakes (3-9)" },
    strake_height: { type: "number", description: "Strake height in mm (30-120)" },
  },
  ducktail: {
    height: { type: "number", description: "Ducktail lip height above the deck in mm (15-90). Must be small — if it looks taller than ~90mm or sits on stalks, it's a wing." },
    kick:   { type: "number", description: "Kick angle in degrees (0-30)" },
  },
  wing: {
    aoa:          { type: "number", description: "Angle of attack in degrees (0-20)" },
    chord:        { type: "number", description: "Wing chord in mm (180-420)" },
    gurney:       { type: "number", description: "Gurney lip in mm (0-30)" },
    span_pct:     { type: "number", description: "Span as % of car width (60-100)" },
    stand_height: { type: "number", description: "Swan-neck stand height in mm (80-320). MUST be > 0 — a wing always has visible stand height. If there is no gap below the blade, this is not a wing." },
  },
  bonnet_vent: {
    length:       { type: "number", description: "Vent length along the bonnet in mm (120-400)" },
    width:        { type: "number", description: "Vent width across the bonnet in mm (60-260)" },
    louvre_count: { type: "number", description: "Number of louvre slats (3-9)" },
    depth:        { type: "number", description: "Recess/scoop depth in mm (8-40)" },
  },
  wing_vent: {
    length:       { type: "number", description: "Vent length along the fender in mm (80-260)" },
    width:        { type: "number", description: "Vent height on the fender in mm (40-160)" },
    louvre_count: { type: "number", description: "Number of louvre slats (2-7)" },
    depth:        { type: "number", description: "Recess depth in mm (6-30)" },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, concept_id, part_kind } = await req.json() as {
      project_id?: string; concept_id?: string; part_kind?: string;
    };

    if (!project_id || !concept_id || !part_kind) {
      return json({ error: "project_id, concept_id, part_kind are required" }, 400);
    }
    if (!ALLOWED_KINDS.includes(part_kind as Kind)) {
      return json({ error: `Unknown part_kind. Allowed: ${ALLOWED_KINDS.join(", ")}` }, 400);
    }
    const kind = part_kind as Kind;

    // Fast-path for body-swap PANEL kinds: there's no aerodynamic parameter
    // to measure — the part IS a crop of the swap shell. The hotspot box
    // already gave us the exact image region; we just stamp the
    // conform-to-donor flag so meshify-carbon-kit knows to build an inner
    // skin that hugs the donor stock body.
    if (PANEL_KINDS.has(kind)) {
      return json({
        kind,
        present: true,
        reasoning:
          "Body-swap panel — outer surface taken from the swap-shell render; " +
          "inner surface will be conformed to the donor stock panel by the meshify worker.",
        params: { ...DEFAULT_PARAMS[kind] },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const [{ data: concept }, { data: geometry }] = await Promise.all([
      admin.from("concepts").select("*").eq("id", concept_id).eq("user_id", userId).maybeSingle(),
      admin.from("geometries").select("*").eq("project_id", project_id).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!concept) return json({ error: "Concept not found" }, 404);

    const renderUrls: Array<{ label: string; url: string }> = [
      { label: "front 3/4", url: concept.render_front_url ?? "" },
      { label: "side",       url: concept.render_side_url ?? "" },
      { label: "rear 3/4",   url: (concept as any).render_rear34_url ?? "" },
      { label: "rear",       url: concept.render_rear_url ?? "" },
    ].filter((r) => !!r.url);

    if (renderUrls.length === 0) {
      return json({ error: "Concept has no rendered images yet." }, 400);
    }

    const meta = (geometry?.metadata ?? {}) as any;
    const widthMm  = Number(meta?.bounds?.width_mm  ?? 1780);
    const lengthMm = Number(meta?.bounds?.length_mm ?? 4400);

    // Bolt-on path — guarded by the PANEL_KINDS short-circuit above, so this
    // lookup is always defined for non-panel kinds.
    const partProps = PARAM_SCHEMA[kind]!;
    const paramSchema = {
      type: "object",
      properties: {
        present:   { type: "boolean", description: "True if this part is visibly present in the concept renders." },
        reasoning: { type: "string", description: "1-2 sentence rationale grounded in what you observed." },
        params: {
          type: "object",
          properties: partProps,
          required: Object.keys(partProps),
          additionalProperties: false,
        },
      },
      required: ["present", "reasoning", "params"],
      additionalProperties: false,
    };

    const systemPrompt = [
      `You are a senior automotive body-kit designer measuring ONE specific part from concept renders.`,
      `Target part: "${kind}".`,
      PART_VIEW_HINT[kind],
      `Vehicle scale: car is ~${lengthMm}mm long, ~${widthMm}mm wide. Use this to convert pixel sizes to mm.`,
      `Even if the part is not clearly visible, return reasonable defaults and set present:false with a brief reason.`,
      `If the part IS visible, set present:true and give your best numeric estimate within the documented ranges.`,
      `Return ONLY the structured tool call.`,
    ].join("\n");

    const userText = [
      `Concept title: ${concept.title}.`,
      `Concept direction: ${concept.direction ?? "(none)"}.`,
      `Render angles attached, in order: ${renderUrls.map((r) => r.label).join(", ")}.`,
      ``,
      `Measure the "${kind}" part and return its parametric values.`,
    ].join("\n");

    const visionContent: Array<any> = [
      { type: "text", text: userText },
      ...renderUrls.map((r) => ({ type: "image_url", image_url: { url: r.url } })),
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: visionContent },
        ],
        tools: [{
          type: "function",
          function: {
            name: "measure_part",
            description: `Return measured parametric values for the ${kind} part`,
            parameters: paramSchema,
          },
        }],
        tool_choice: { type: "function", function: { name: "measure_part" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      const t = await aiResp.text();
      console.error("AI extract failed:", aiResp.status, t);
      return json({ error: "AI gateway error" }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call:", JSON.stringify(aiJson).slice(0, 800));
      return json({ error: "AI returned no structured measurements" }, 500);
    }

    let parsed: { present: boolean; reasoning: string; params: Record<string, number> };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Parse failed:", e);
      return json({ error: "Could not parse AI response" }, 500);
    }

    // Merge with defaults to guarantee every required field is present.
    const params = { ...DEFAULT_PARAMS[kind], ...parsed.params };

    return json({
      kind,
      present: !!parsed.present,
      reasoning: parsed.reasoning ?? "",
      params,
    });
  } catch (e) {
    console.error("extract-part error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
