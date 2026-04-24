/**
 * detect-concept-hotspots
 *
 * Given a concept render (front / side / rear34 / rear), uses Gemini vision
 * to detect normalised bounding boxes for body kit parts that are visible in
 * that specific image. Caches results in concepts.hotspots[view] so the
 * client only pays for the AI call once per (concept, view).
 *
 * Body: { concept_id: string, view: "front"|"side"|"rear34"|"rear", force?: boolean }
 * Returns: { boxes: Array<{kind,label,x,y,w,h}>, cached: boolean }
 *
 * Why: hardcoded boxes never line up because Gemini renders cars at varying
 * positions/scales. Asking the model directly is the only reliable way to
 * place pickable hotspots on the actual car.
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

type ViewKey = "front" | "side" | "rear34" | "rear";

const URL_COL: Record<ViewKey, string> = {
  front: "render_front_url",
  side: "render_side_url",
  rear34: "render_rear34_url",
  rear: "render_rear_url",
};

/** In body-swap mode prefer the isolated carbon shell render — the
 *  silhouette is cleaner there so panel boxes hug the actual swap shell
 *  instead of being thrown by background/wheels/glass. Falls back to the
 *  regular render when the carbon view isn't ready. */
const CARBON_URL_COL: Record<ViewKey, string> = {
  front: "render_front_carbon_url",
  side: "render_side_carbon_url",
  rear34: "render_rear34_carbon_url",
  rear: "render_rear_carbon_url",
};

/** Parts the model is allowed to return per view. Keeps detections relevant
 * to what's actually visible from each camera. */
const ALLOWED_PARTS: Record<ViewKey, Array<{ kind: string; label: string; hint: string }>> = {
  front: [
    { kind: "splitter", label: "Front splitter", hint: "lower front lip / splitter under the bumper" },
    { kind: "lip", label: "Front lip", hint: "thin lip protruding under the front bumper" },
    { kind: "canard", label: "Canards", hint: "small angled fins on the front bumper corners" },
    { kind: "wide_arch", label: "Front arch (L)", hint: "left front fender flare / arch" },
    { kind: "wide_arch", label: "Front arch (R)", hint: "right front fender flare / arch" },
    { kind: "bonnet_vent", label: "Bonnet vent", hint: "louvred opening or scoop cut into the bonnet/hood" },
    { kind: "wing_vent", label: "Wing vent (L)", hint: "louvred vent on the left front fender behind the wheel" },
    { kind: "wing_vent", label: "Wing vent (R)", hint: "louvred vent on the right front fender behind the wheel" },
  ],
  side: [
    { kind: "side_skirt", label: "Side skirt", hint: "side skirt running along the bottom of the doors" },
    { kind: "wide_arch", label: "Front arch", hint: "front fender flare around the front wheel" },
    { kind: "wide_arch", label: "Rear arch", hint: "rear fender flare around the rear wheel" },
    { kind: "wing_vent", label: "Wing vent", hint: "louvred vent on the front fender behind the wheel arch" },
    { kind: "bonnet_vent", label: "Bonnet vent", hint: "louvred opening on the bonnet, visible in profile" },
    { kind: "ducktail", label: "Ducktail", hint: "SHORT INTEGRATED LIP rising directly off the bootlid with NO stalks and NO gap underneath. Skip if the rear blade sits on visible uprights." },
    { kind: "wing", label: "Rear wing", hint: "SEPARATE AEROFOIL BLADE held above the deck on visible stalks/swan-necks with a clear air gap underneath. Only return if the gap is clearly visible." },
  ],
  rear34: [
    { kind: "diffuser", label: "Diffuser", hint: "rear diffuser under the rear bumper" },
    { kind: "wing", label: "Rear wing", hint: "SEPARATE AEROFOIL BLADE on stalks/swan-necks above the deck with a clear gap underneath. Do NOT return if the blade is integrated into the bootlid (that's a ducktail)." },
    { kind: "ducktail", label: "Ducktail", hint: "SHORT INTEGRATED LIP rising off the rear deck/bootlid, NO stalks, NO gap. Mutually exclusive with wing — pick only one." },
    { kind: "wide_arch", label: "Rear arch", hint: "rear fender flare visible on the side" },
  ],
  rear: [
    { kind: "diffuser", label: "Diffuser", hint: "rear diffuser under the rear bumper" },
    { kind: "wing", label: "Rear wing", hint: "SEPARATE AEROFOIL BLADE on stalks above the deck, daylight visible underneath. Mutually exclusive with ducktail." },
    { kind: "ducktail", label: "Ducktail", hint: "SHORT LIP integrated into the bootlid surface, no stalks, no gap. Mutually exclusive with wing." },
  ],
};

/**
 * BODY-SWAP MODE panel atlas. The kit is a full outer shell, so we segment
 * it into the body panels a real wide-body conversion ships as: front clip,
 * hood, fenders L/R, door skins L/R, side skirts L/R, rear quarters L/R,
 * rear clip, deck/bootlid, and wing if present. Each box should hug ONE
 * panel — these later become "outer skin + conformed inner" parts that the
 * Blender worker can shrinkwrap to the donor stock body.
 */
const BODY_SWAP_PARTS: Record<ViewKey, Array<{ kind: string; label: string; hint: string }>> = {
  front: [
    { kind: "front_clip", label: "Front clip", hint: "the entire replacement front bumper / nose panel below the hood line" },
    { kind: "hood_panel", label: "Hood", hint: "the bonnet/hood panel of the swap kit" },
    { kind: "fender_panel", label: "Fender (L)", hint: "left front fender / wide-body arch panel — one continuous panel from hood shut-line down to rocker" },
    { kind: "fender_panel", label: "Fender (R)", hint: "right front fender / wide-body arch panel" },
    { kind: "splitter", label: "Front splitter", hint: "splitter blade protruding forward off the front clip — only if it's clearly a separate aero piece" },
  ],
  side: [
    { kind: "fender_panel", label: "Front fender", hint: "front wide-body fender panel from A-pillar forward, around the front wheel arch, down to rocker" },
    { kind: "door_skin",   label: "Door skin",   hint: "outer door skin only — the painted surface between the front and rear shut-lines, NOT the window aperture" },
    { kind: "side_skirt_panel", label: "Side skirt", hint: "rocker-line panel running between the front and rear arches" },
    { kind: "rear_quarter", label: "Rear quarter", hint: "rear wide-body quarter panel from B/C-pillar back, around the rear wheel arch, to the rear clip shut-line" },
    { kind: "deck_panel",  label: "Rear deck",  hint: "boot-lid / engine-cover panel visible from side" },
    { kind: "wing",        label: "Rear wing",  hint: "SEPARATE blade on stalks/swan-necks above the deck, only if a clear gap is visible" },
  ],
  rear34: [
    { kind: "rear_clip",   label: "Rear clip", hint: "the entire replacement rear bumper / tail panel below the boot-lid line" },
    { kind: "rear_quarter",label: "Rear quarter (L)", hint: "left rear wide-body quarter panel" },
    { kind: "rear_quarter",label: "Rear quarter (R)", hint: "right rear wide-body quarter panel" },
    { kind: "deck_panel",  label: "Rear deck", hint: "boot-lid / engine-cover top panel" },
    { kind: "diffuser",    label: "Diffuser",  hint: "diffuser panel under the rear bumper, only if it's a distinct sub-piece" },
    { kind: "wing",        label: "Rear wing", hint: "SEPARATE blade on stalks above the deck — clear gap underneath" },
  ],
  rear: [
    { kind: "rear_clip",   label: "Rear clip",  hint: "the full replacement rear bumper / tail panel" },
    { kind: "deck_panel",  label: "Rear deck",  hint: "boot-lid / engine-cover panel above the rear clip" },
    { kind: "rear_quarter",label: "Rear quarter (L)", hint: "left rear quarter panel visible at the corner" },
    { kind: "rear_quarter",label: "Rear quarter (R)", hint: "right rear quarter panel visible at the corner" },
    { kind: "diffuser",    label: "Diffuser",   hint: "diffuser sub-panel under the rear clip, only if distinct" },
    { kind: "wing",        label: "Rear wing",  hint: "SEPARATE blade on stalks with daylight underneath" },
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { concept_id, view, force, body_swap_mode } = await req.json() as {
      concept_id: string; view: ViewKey; force?: boolean; body_swap_mode?: boolean;
    };
    if (!concept_id || !view || !URL_COL[view]) {
      return json({ error: "concept_id and a valid view are required" }, 400);
    }
    const swapMode = !!body_swap_mode;

    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Read both regular + carbon URLs so swap mode can prefer the cleaner
    // isolated shell when it's available.
    const { data: concept, error: cErr } = await admin
      .from("concepts")
      .select(`id, user_id, hotspots, ${URL_COL[view]}, ${CARBON_URL_COL[view]}`)
      .eq("id", concept_id)
      .maybeSingle();
    if (cErr || !concept) return json({ error: "Concept not found" }, 404);
    if (concept.user_id !== userId) return json({ error: "Forbidden" }, 403);

    const carbonUrl = (concept as any)[CARBON_URL_COL[view]] as string | null;
    const baseUrl   = (concept as any)[URL_COL[view]] as string | null;
    const renderUrl = swapMode ? (carbonUrl ?? baseUrl) : baseUrl;
    if (!renderUrl) return json({ error: `No ${view} render on this concept` }, 400);

    // Cache hit — namespaced by mode so bolt-on and swap detections don't
    // overwrite each other on the same concept.
    const cacheKey = swapMode ? `${view}__swap` : view;
    const existing = (concept.hotspots ?? {}) as Record<string, any>;
    if (!force && existing[cacheKey]?.boxes) {
      // analyzed_url falls back to current renderUrl for older cached entries
      // that pre-date this field.
      return json({
        boxes: existing[cacheKey].boxes,
        analyzed_url: existing[cacheKey].analyzed_url ?? renderUrl,
        cached: true,
      });
    }

    const allowed = (swapMode ? BODY_SWAP_PARTS : ALLOWED_PARTS)[view];
    const partList = allowed.map((p, i) =>
      `  ${i + 1}. kind="${p.kind}" label="${p.label}" — ${p.hint}`
    ).join("\n");

    const systemPrompt = swapMode
      ? "You are a precise visual annotator for a car body-swap design tool. " +
        "The image shows a FULL replacement body shell (a wide-body conversion " +
        "kit such as a GT1-style or slantnose conversion). Your job is to " +
        "segment that shell into its constituent body panels and return one " +
        "tight bounding box per panel.\n\n" +
        "PANEL RULES:\n" +
        "• Each box must hug exactly ONE panel — never group two panels into one box.\n" +
        "• Panels meet at shut-lines: hood↔fender, fender↔door, door↔rear quarter, " +
        "  rear quarter↔rear clip, deck↔rear clip. Use these shut-lines as box edges.\n" +
        "• Do NOT include the window aperture inside a door-skin box — clip the box " +
        "  to the painted skin only.\n" +
        "• Do NOT include the wheel inside a fender or quarter box — clip around it.\n" +
        "• For symmetric panels (fenders, quarters, doors) return ONE box per side, " +
        "  and only if both sides are clearly visible from this camera.\n" +
        "• Skip panels that are not visible from this camera — never guess off-screen.\n" +
        "• Boxes are in normalised image coords (0..1 from top-left). x+w ≤ 1, y+h ≤ 1."
      : "You are a precise visual annotator for a car body kit design tool. " +
        "You will be shown a single render of a custom car and asked to locate " +
        "specific body kit parts. Return tight bounding boxes in normalised " +
        "image coordinates (0..1 from the top-left). Only return boxes for " +
        "parts that are clearly visible. Skip parts that are occluded or absent.\n\n" +
        "CRITICAL DISAMBIGUATION — WING vs DUCKTAIL:\n" +
        "• A WING is a separate aerofoil blade held above the rear deck on " +
        "  visible stalks/swan-necks. There is a CLEAR GAP of air (daylight) " +
        "  between the underside of the blade and the bootlid surface.\n" +
        "• A DUCKTAIL is a short integrated lip rising directly off the " +
        "  bootlid/rear-deck panel. It is part of the body itself — NO stalks, " +
        "  NO daylight underneath, NO separation from the body surface.\n" +
        "• Never return both for the same car — they are mutually exclusive.\n" +
        "• If you cannot see daylight under a rear blade, it is a DUCKTAIL.\n" +
        "• If you can see daylight + uprights, it is a WING.";

    const userPrompt =
      `View: ${view}. ` +
      `Locate the following body kit parts in the image. For each one that is ` +
      `clearly visible on the car, return a tight bounding box.\n\n` +
      `Parts to consider:\n${partList}\n\n` +
      `Output rules:\n` +
      `- Coordinates: x, y = top-left corner (0..1). w, h = width/height (0..1). x+w<=1, y+h<=1.\n` +
      `- Boxes must hug the actual part on the car, not be huge generic regions.\n` +
      `- If a part is not clearly present, OMIT it entirely. Do not guess.\n` +
      `- For symmetric parts (e.g. front arches L/R) return one box per side only ` +
      `  if both are visible.\n` +
      `- Wing and ducktail are MUTUALLY EXCLUSIVE — return at most one of them.`;

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
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: renderUrl } },
            ],
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_part_boxes",
            description: "Report bounding boxes for visible body kit parts.",
            parameters: {
              type: "object",
              properties: {
                boxes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: Array.from(new Set(allowed.map((a) => a.kind))) },
                      label: { type: "string" },
                      x: { type: "number" },
                      y: { type: "number" },
                      w: { type: "number" },
                      h: { type: "number" },
                    },
                    required: ["kind", "label", "x", "y", "w", "h"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["boxes"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_part_boxes" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("vision call failed", aiResp.status, t.slice(0, 300));
      if (aiResp.status === 429) return json({ error: "Rate limit reached. Try again shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: "Vision detection failed" }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let boxes: any[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(args.boxes)) boxes = args.boxes;
      } catch (e) {
        console.error("failed to parse tool args", e);
      }
    }

    // Sanitise + clamp
    const allowedKinds = new Set(allowed.map((a) => a.kind));
    boxes = boxes
      .filter((b) =>
        b && allowedKinds.has(b.kind) &&
        Number.isFinite(b.x) && Number.isFinite(b.y) &&
        Number.isFinite(b.w) && Number.isFinite(b.h) &&
        b.w > 0.01 && b.h > 0.01
      )
      .map((b) => {
        const x = clamp01(b.x);
        const y = clamp01(b.y);
        const w = Math.min(clamp01(b.w), 1 - x);
        const h = Math.min(clamp01(b.h), 1 - y);
        return {
          kind: String(b.kind),
          label: String(b.label || allowed.find((a) => a.kind === b.kind)?.label || b.kind),
          x, y, w, h,
        };
      });

    // Persist into hotspots[cacheKey] — namespaced so bolt-on and swap-mode
    // detections coexist on the same concept row.
    const nextHotspots = {
      ...existing,
      [cacheKey]: { boxes, detected_at: new Date().toISOString(), mode: swapMode ? "body_swap" : "bolt_on" },
    };
    const { error: upErr } = await admin
      .from("concepts")
      .update({ hotspots: nextHotspots })
      .eq("id", concept_id);
    if (upErr) console.error("hotspot cache write failed", upErr);

    return json({ boxes, cached: false });
  } catch (e) {
    console.error("detect-concept-hotspots error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
