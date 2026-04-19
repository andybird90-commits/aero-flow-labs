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
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_KINDS = [
  "splitter", "lip", "canard", "side_skirt",
  "wide_arch", "diffuser", "ducktail", "wing",
] as const;
type Kind = typeof ALLOWED_KINDS[number];

const DEFAULT_PARAMS: Record<Kind, Record<string, number>> = {
  splitter:   { depth: 80,  fence_height: 30, fence_inset: 60 },
  lip:        { depth: 30 },
  canard:     { angle: 12,  count: 1, span: 180 },
  side_skirt: { depth: 70,  drop: 25 },
  wide_arch:  { flare: 50 },
  diffuser:   { angle: 12,  strake_count: 5, strake_height: 60 },
  ducktail:   { height: 38, kick: 10 },
  wing:       { aoa: 8, chord: 280, gurney: 12, span_pct: 78, stand_height: 220 },
};

/** Per-part hint about which renders matter most. */
const PART_VIEW_HINT: Record<Kind, string> = {
  splitter:   "Look at the FRONT 3/4 view. The splitter is the flat blade protruding forward at the bottom of the front bumper.",
  lip:        "Look at the FRONT 3/4 view. The lip is a thin extension below the splitter / front bumper.",
  canard:     "Look at the FRONT 3/4 view. Canards are small angled foils on the lower front bumper sides.",
  side_skirt: "Look at the SIDE view. Side skirts are long blades along the rocker panel between the wheels.",
  wide_arch:  "Look at FRONT 3/4 and REAR 3/4 views. Wide arches are bolt-on flares around the wheel openings.",
  diffuser:   "Look at the REAR or REAR 3/4 view. The diffuser is the angled panel under the rear bumper, often with vertical strakes.",
  ducktail:   "Look at the REAR or SIDE view. A ducktail is a small lip rising off the rear deck/trunk.",
  wing:       "Look at the REAR 3/4 or REAR view. Estimate angle of attack, chord, span as % of car width, stand height.",
};

const PARAM_SCHEMA: Record<Kind, Record<string, { type: "number"; description: string }>> = {
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
    height: { type: "number", description: "Ducktail height in mm (15-90)" },
    kick:   { type: "number", description: "Kick angle in degrees (0-30)" },
  },
  wing: {
    aoa:          { type: "number", description: "Angle of attack in degrees (0-20)" },
    chord:        { type: "number", description: "Wing chord in mm (180-420)" },
    gurney:       { type: "number", description: "Gurney lip in mm (0-30)" },
    span_pct:     { type: "number", description: "Span as % of car width (60-100)" },
    stand_height: { type: "number", description: "Swan-neck stand height in mm (80-320)" },
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

    const partProps = PARAM_SCHEMA[kind];
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
