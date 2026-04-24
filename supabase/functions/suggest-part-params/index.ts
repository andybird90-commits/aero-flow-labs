/**
 * suggest-part-params (vision-measured kit synthesis)
 *
 * Looks at the approved concept's rendered images (front 3/4, side, rear 3/4,
 * rear), the design brief, and the user's STL bounds, and returns parametric
 * values for ALL 8 body kit parts. Parts not present in the concept are
 * returned with `enabled: false` and sensible default params so the user can
 * still toggle them on later in Parts/Refine.
 *
 * The vision call uses Gemini 2.5 Pro because we need spatial reasoning over
 * 4 images simultaneously to extract numeric measurements (mm / degrees).
 *
 * Body: { project_id: string; concept_id: string }
 * Returns: { parts: Array<{ kind, params, enabled, reasoning }> }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALL_KINDS = [
  "splitter", "lip", "canard", "side_skirt",
  "wide_arch", "diffuser", "ducktail", "wing",
] as const;

/** Sensible defaults applied to disabled parts so toggling them on yields a usable starting state. */
const DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  splitter:   { depth: 80,  fence_height: 30, fence_inset: 60 },
  lip:        { depth: 30 },
  canard:     { angle: 12,  count: 1, span: 180 },
  side_skirt: { depth: 70,  drop: 25 },
  wide_arch:  { flare: 50 },
  diffuser:   { angle: 12,  strake_count: 5, strake_height: 60 },
  ducktail:   { height: 38, kick: 10 },
  wing:       { aoa: 8,     chord: 280, gurney: 12, span_pct: 78, stand_height: 220 },
};

const PART_SCHEMA = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ALL_KINDS] },
          enabled: { type: "boolean", description: "True if this part is visible/present in the concept renders." },
          reasoning: { type: "string", description: "One-line rationale grounded in what you observed in the renders." },
          params: {
            type: "object",
            description: "Numeric measurements. Units: lengths in mm, angles in degrees, span_pct as 0-100.",
            properties: {
              depth:         { type: "number", description: "Forward/rear protrusion in mm" },
              height:        { type: "number", description: "Vertical extent in mm" },
              flare:         { type: "number", description: "Wide-arch flare in mm" },
              angle:         { type: "number", description: "Tilt in degrees" },
              aoa:           { type: "number", description: "Wing angle of attack, degrees" },
              chord:         { type: "number", description: "Wing chord, mm" },
              gurney:        { type: "number", description: "Wing gurney lip, mm" },
              span_pct:      { type: "number", description: "Wing span as % of car width" },
              stand_height:  { type: "number", description: "Wing stand/swan-neck height, mm" },
              fence_height:  { type: "number", description: "Splitter side-fence height, mm" },
              fence_inset:   { type: "number", description: "Splitter side-fence inset from edge, mm" },
              drop:          { type: "number", description: "Side-skirt vertical drop below rocker, mm" },
              count:         { type: "number", description: "Canard pairs per side (1 or 2)" },
              span:          { type: "number", description: "Canard chord/span, mm" },
              strake_count:  { type: "number", description: "Diffuser strake count" },
              strake_height: { type: "number", description: "Diffuser strake height, mm" },
              kick:          { type: "number", description: "Ducktail kick angle, degrees" },
            },
            additionalProperties: false,
          },
        },
        required: ["kind", "enabled", "params"],
        additionalProperties: false,
      },
      minItems: 8,
      maxItems: 8,
    },
  },
  required: ["parts"],
  additionalProperties: false,
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { project_id, concept_id } = (await req.json()) as { project_id?: string; concept_id?: string };
    if (!project_id || !concept_id) {
      return json({ error: "project_id and concept_id are required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const [{ data: concept }, { data: brief }, { data: geometry }] = await Promise.all([
      admin.from("concepts").select("*").eq("id", concept_id).eq("user_id", userId).maybeSingle(),
      admin.from("design_briefs").select("*").eq("project_id", project_id).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("geometries").select("*").eq("project_id", project_id).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!concept) return json({ error: "Concept not found" }, 404);

    // Collect render URLs (front, side, rear 3/4, rear). Vision needs the actual pixels.
    const renderUrls: Array<{ label: string; url: string }> = [
      { label: "front 3/4", url: concept.render_front_url ?? "" },
      { label: "side",       url: concept.render_side_url ?? "" },
      { label: "rear 3/4",   url: (concept as any).render_rear34_url ?? "" },
      { label: "rear",       url: concept.render_rear_url ?? "" },
    ].filter((r) => !!r.url);

    if (renderUrls.length === 0) {
      return json({ error: "Concept has no rendered images yet — generate concept images first." }, 400);
    }

    const briefSummary = brief
      ? [
          brief.prompt,
          brief.build_type ? `Build type: ${brief.build_type}.` : "",
          (brief.style_tags ?? []).length ? `Style tags: ${brief.style_tags.join(", ")}.` : "",
          (brief.constraints ?? []).length ? `Constraints: ${brief.constraints.join("; ")}.` : "",
        ].filter(Boolean).join(" ")
      : "(no brief provided)";

    // Pull approximate vehicle width/length from geometry metadata if present
    // (Upload page stamps these). Fall back to typical sports-car dims.
    const meta = (geometry?.metadata ?? {}) as any;
    const vehicleWidthMm  = Number(meta?.bounds?.width_mm  ?? 1780);
    const vehicleLengthMm = Number(meta?.bounds?.length_mm ?? 4400);

    const systemPrompt = [
      "You are a senior automotive aero/body-kit designer with experience measuring parts off concept renders.",
      "You will be shown 2-4 renders of the SAME approved concept from different angles.",
      "Your job is to measure each visible body kit part and return numeric parametric values that can drive a CAD-style fitted kit.",
      "",
      "RULES:",
      "1. Return ALL 8 parts every time. For parts NOT visible in the concept, set enabled:false and use the documented default params.",
      "2. Estimate measurements in real-world units (mm, degrees) using the vehicle dimensions provided as a scale reference.",
      "3. Stay within reasonable physical ranges:",
      "   - splitter.depth 30-200, splitter.fence_height 0-80, splitter.fence_inset 30-200",
      "   - lip.depth 10-80",
      "   - canard.angle 0-30, canard.count 1-2, canard.span 100-300",
      "   - side_skirt.depth 30-150, side_skirt.drop 0-60",
      "   - wide_arch.flare 0-120",
      "   - diffuser.angle 0-25, diffuser.strake_count 3-9, diffuser.strake_height 30-120",
      "   - ducktail.height 15-90, ducktail.kick 0-30",
      "   - wing.aoa 0-20, wing.chord 180-420, wing.gurney 0-30, wing.span_pct 60-100, wing.stand_height 80-320",
      "4. If the concept clearly has NO wing (e.g. an OEM+ touring build), set wing.enabled:false but keep modest defaults.",
      "5. Reasoning must reference what you observed (e.g. 'visible 3-piece swan-neck wing in rear 3/4 render, ~30cm chord, moderate AOA').",
      "",
      "Return ONLY the structured tool call.",
    ].join("\n");

    const userText = [
      `Vehicle reference dimensions: ~${vehicleLengthMm}mm long, ~${vehicleWidthMm}mm wide.`,
      `Concept title: ${concept.title}.`,
      `Concept direction: ${concept.direction ?? "(none)"}.`,
      `Design brief: ${briefSummary}`,
      `Render angles attached, in order: ${renderUrls.map((r) => r.label).join(", ")}.`,
      "",
      "Measure every visible kit part and return parametric values for all 8 part kinds.",
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
            name: "measure_kit",
            description: "Return measured parametric values for all 8 body kit parts",
            parameters: PART_SCHEMA,
          },
        }],
        tool_choice: { type: "function", function: { name: "measure_kit" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      const t = await aiResp.text();
      console.error("AI suggest failed:", aiResp.status, t);
      return json({ error: "AI gateway error" }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call in response:", JSON.stringify(aiJson).slice(0, 800));
      return json({ error: "AI returned no structured measurements" }, 500);
    }

    let parsed: { parts: Array<{ kind: string; enabled: boolean; params: Record<string, number>; reasoning?: string }> };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool args:", e);
      return json({ error: "Could not parse AI response" }, 500);
    }

    // Normalise: ensure every kind appears exactly once, fill missing with defaults.
    const byKind = new Map(parsed.parts.map((p) => [p.kind, p]));
    const normalised = ALL_KINDS.map((kind) => {
      const fromAi = byKind.get(kind);
      const params = { ...DEFAULT_PARAMS[kind], ...(fromAi?.params ?? {}) };
      return {
        kind,
        enabled: fromAi?.enabled ?? false,
        params,
        reasoning: fromAi?.reasoning ?? "Not present in concept — defaults applied.",
      };
    });

    // Persist a generation job record (best-effort)
    await admin.from("parts_generation_jobs").insert({
      user_id: userId,
      project_id,
      concept_id,
      state: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      suggested_params: { parts: normalised },
      reasoning: normalised.map((p) => `${p.kind}${p.enabled ? "" : " (off)"}: ${p.reasoning}`).join(" | ").slice(0, 4000),
    });

    return json({ parts: normalised });
  } catch (e) {
    console.error("suggest-part-params error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
