/**
 * suggest-part-params
 *
 * Given an approved concept + the project's design brief, ask Lovable AI to
 * propose parametric values for fitted body kit parts. Output is forced to a
 * structured JSON schema via tool calling.
 *
 * Body: { project_id: string; concept_id: string }
 * Returns: { parts: Array<{ kind: string; params: Record<string, number>; enabled: boolean; reasoning?: string }> }
 *
 * The values returned line up with the parametric controls used in the 3D
 * viewer and Refine page so the suggestions can be applied directly to
 * `fitted_parts` rows.
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

const PART_SCHEMA = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["splitter", "lip", "canard", "side_skirt", "wide_arch", "diffuser", "ducktail", "wing"],
          },
          enabled: { type: "boolean" },
          reasoning: { type: "string", description: "One-line rationale" },
          params: {
            type: "object",
            description: "Parameter values appropriate to this part kind. Units: depth/height/chord in mm, flare in mm, angle/aoa in degrees, gurney in mm.",
            properties: {
              depth:  { type: "number" },
              height: { type: "number" },
              flare:  { type: "number" },
              angle:  { type: "number" },
              aoa:    { type: "number" },
              chord:  { type: "number" },
              gurney: { type: "number" },
            },
            additionalProperties: false,
          },
        },
        required: ["kind", "enabled", "params"],
        additionalProperties: false,
      },
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

    const [{ data: concept }, { data: brief }] = await Promise.all([
      admin.from("concepts").select("*").eq("id", concept_id).eq("user_id", userId).maybeSingle(),
      admin.from("design_briefs").select("*").eq("project_id", project_id).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!concept) return json({ error: "Concept not found" }, 404);

    const briefSummary = brief
      ? [
          brief.prompt,
          brief.build_type ? `Build type: ${brief.build_type}.` : "",
          (brief.style_tags ?? []).length ? `Style tags: ${brief.style_tags.join(", ")}.` : "",
          (brief.constraints ?? []).length ? `Constraints: ${brief.constraints.join("; ")}.` : "",
        ].filter(Boolean).join(" ")
      : "(no brief provided)";

    const conceptSummary = `Concept: ${concept.title}. Direction: ${concept.direction ?? "(none)"}.`;

    const systemPrompt =
      "You are a senior automotive aero designer. Given a brief and an approved styling concept, propose " +
      "sensible parametric values for fitted body kit parts (splitter, lip, canards, side skirts, wide arches, " +
      "diffuser, ducktail, wing). Stay within these ranges: depth 10-200 mm, height 10-100 mm, flare 0-120 mm, " +
      "angle 0-30°, aoa 0-20°, chord 150-400 mm, gurney 0-30 mm. Disable parts that don't fit the concept's " +
      "direction (e.g. no big wing on a subtle OEM+ build). Return ONLY the structured tool call.";

    const userPrompt = `${briefSummary}\n\n${conceptSummary}\n\nPropose parameters for each part. Mark unrelated parts as enabled:false.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_parts",
            description: "Return the recommended parts and parameters",
            parameters: PART_SCHEMA,
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_parts" } },
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
      console.error("No tool call in response:", JSON.stringify(aiJson).slice(0, 500));
      return json({ error: "AI returned no structured suggestions" }, 500);
    }

    let parsed: { parts: Array<{ kind: string; enabled: boolean; params: Record<string, number>; reasoning?: string }> };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("Failed to parse tool args:", e);
      return json({ error: "Could not parse AI response" }, 500);
    }

    // Persist a generation job record (best-effort)
    await admin.from("parts_generation_jobs").insert({
      user_id: userId,
      project_id,
      concept_id,
      state: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      suggested_params: parsed,
      reasoning: parsed.parts.map((p) => `${p.kind}: ${p.reasoning ?? ""}`).join(" | ").slice(0, 4000),
    });

    return json({ parts: parsed.parts });
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
