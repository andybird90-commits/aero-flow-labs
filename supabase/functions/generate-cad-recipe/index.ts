/**
 * generate-cad-recipe
 *
 * Uses Lovable AI (Gemini) to convert a part kind + label + optional reference
 * image set into a strict-JSON parametric CAD recipe the Onshape worker can
 * execute (sketches, extrudes, lofts, fillets, mirrors, etc.).
 *
 * Body:
 *   { concept_id?, part_kind, part_label, reference_image_urls?: string[], notes?: string }
 *
 * Returns: { recipe }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const SYSTEM = `You are a CAD recipe generator for an Onshape parametric build worker. Output STRICT JSON only — no prose.

The recipe schema (all dimensions in millimetres, vehicle-local coords: forward = -Z, up = +Y, right = +X):

{
  "version": 1,
  "part": "<part_kind>",
  "units": "mm",
  "features": [
    { "type": "sketch", "id": "s1", "plane": "XY"|"YZ"|"XZ"|{"origin":[x,y,z],"normal":[x,y,z]},
      "curves": [
        { "type":"line",   "from":[x,y], "to":[x,y] },
        { "type":"arc",    "center":[x,y], "radius":r, "start_deg":a, "end_deg":b },
        { "type":"spline", "points":[[x,y],...] },
        { "type":"naca",   "code":"6412", "chord":120, "origin":[x,y], "rotation_deg":-3 }
      ]
    },
    { "type": "extrude", "id":"e1", "sketch":"s1", "depth_mm": 20, "symmetric": false },
    { "type": "loft",    "id":"l1", "sketches":["s1","s2"] },
    { "type": "shell",   "id":"sh1", "target":"e1", "thickness_mm": 2.0, "open_faces":["+Z"] },
    { "type": "fillet",  "id":"f1", "target":"e1", "edges":"all"|["edge_id"], "radius_mm": 3 },
    { "type": "mirror",  "id":"m1", "target":"e1", "plane":"YZ" }
  ],
  "outputs": ["step", "stl", "glb"]
}

Rules:
- Always set units to "mm".
- For aero parts (wings, splitters, canards) prefer NACA airfoil sketches with sensible chord/AoA.
- For arches/skirts/lips reference a base mesh import: { "type":"import_mesh", "id":"car", "url":"<base_mesh_url>" } and project sketches onto it.
- Default wall thickness 2mm via shell unless caller specifies otherwise.
- Keep the recipe under 30 features. Prefer simplicity.
- Return ONLY the JSON object. No commentary, no markdown fences.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const body = await req.json();
    const { part_kind, part_label, reference_image_urls = [], notes = "", base_mesh_url = null } = body ?? {};
    if (!part_kind) return json({ error: "part_kind required" }, 400);

    // Auth: just verify the caller is logged in.
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const userPrompt = [
      `Part kind: ${part_kind}`,
      part_label ? `Part label: ${part_label}` : null,
      base_mesh_url ? `Base car mesh URL (for body-conforming parts): ${base_mesh_url}` : null,
      notes ? `Designer notes: ${notes}` : null,
      reference_image_urls.length
        ? `Reference images attached. Match the silhouette closely.`
        : null,
      `Return the strict JSON recipe.`,
    ].filter(Boolean).join("\n");

    const userContent: any[] = [{ type: "text", text: userPrompt }];
    for (const url of reference_image_urls.slice(0, 4)) {
      userContent.push({ type: "image_url", image_url: { url } });
    }

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429) return json({ error: "AI rate limited, retry shortly." }, 429);
      if (aiResp.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: `AI ${aiResp.status}: ${t.slice(0, 300)}` }, 500);
    }
    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";

    let recipe: any;
    try {
      recipe = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return json({ error: "AI returned invalid JSON", raw: raw.slice(0, 500) }, 500);
    }

    if (!recipe || typeof recipe !== "object" || !Array.isArray(recipe.features)) {
      return json({ error: "Recipe missing features[]", recipe }, 422);
    }

    return json({ recipe });
  } catch (e) {
    console.error("generate-cad-recipe error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
