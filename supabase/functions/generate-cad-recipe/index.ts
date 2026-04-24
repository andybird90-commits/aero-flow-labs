/**
 * generate-cad-recipe
 *
 * Uses Lovable AI (Gemini) to convert a part kind + label + optional reference
 * image set into a strict-JSON parametric CAD recipe the CadQuery worker can
 * execute (sketches, extrudes, lofts, fillets, mirrors, etc.). Engine-agnostic
 * — any kernel (CadQuery, Build123d, OpenCascade.js, Onshape) that consumes
 * the schema documented in `docs/cad-worker.md` works.
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

const SYSTEM = `You are a CAD recipe generator for a CadQuery (OpenCascade) parametric build worker. Output STRICT JSON only — no prose, no markdown fences.

Recipe schema. All dimensions in millimetres. Vehicle-local coords: forward = -Z, up = +Y, right = +X.

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
    { "type": "revolve", "id":"r1", "sketch":"s1", "axis":"Y", "angle_deg": 360 },
    { "type": "sweep",   "id":"sw1","profile":"s1", "path":"s2" },
    { "type": "shell",   "id":"sh1","target":"e1", "thickness_mm": 2.0, "open_faces":["+Z"] },
    { "type": "fillet",  "id":"f1", "target":"e1", "edges":"all"|["edge_id"], "radius_mm": 3 },
    { "type": "chamfer", "id":"c1", "target":"e1", "edges":"all", "distance_mm": 1.5 },
    { "type": "mirror",  "id":"m1", "target":"e1", "plane":"YZ" },
    { "type": "boolean", "id":"b1", "op":"union"|"cut"|"intersect", "targets":["e1","m1"] },
    { "type": "import_mesh", "id":"car", "url":"<base_mesh_url>" }
  ],
  "outputs": ["step", "stl", "glb"]
}

Rules:
- Always set units to "mm".
- Every feature MUST have a unique "id". Later features reference earlier ones by id.
- The LAST body produced is what gets exported, so finish with the final composite (boolean union or the dressed-up extrude).
- For aero parts (wings, splitters, canards, diffuser fins) prefer NACA airfoil sketches with sensible chord (150-300mm) and AoA (-2 to -6 deg).
- For arches/skirts/lips that must conform to the car body, FIRST emit { "type":"import_mesh", "id":"car", "url":"<base_mesh_url>" }, THEN sketch the part profile and the worker will project it against the car surface.
- Default wall thickness 2mm via shell on hollow aero parts.
- Use mirror across "YZ" for any part that has a left/right pair (canards, side skirts) — sketch one side, mirror the other.
- Keep the recipe under 25 features. Prefer simplicity over cleverness.
- Return ONLY the JSON object.`;

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
