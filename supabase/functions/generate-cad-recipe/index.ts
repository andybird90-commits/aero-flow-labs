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
- Worker-safe mode is preferred: use only named planes ("XY", "YZ", "XZ"), not custom {origin, normal} planes.
- Prefer one closed sketch + extrude over loft / sweep whenever possible.
- Never use negative extrude depths.
- Never include unsupported placement keys like "origin" on extrude features; place the sketch on the correct named plane instead.
- Shell thickness must always be strictly positive.
- Keep each sketch to closed, manufacturable profiles; avoid disconnected multi-island sketches unless absolutely necessary.
- Never draw a full circle with one arc from 0 to 360 degrees.
- For body panels like fenders / arches, return a conservative manufacturable solid rather than a sculpted multi-plane loft.
- Return ONLY the JSON object.`;

const NAMED_PLANES = new Set(["XY", "YZ", "XZ"]);
const BODY_PRODUCING = new Set([
  "extrude", "loft", "revolve", "sweep", "boolean",
  "shell", "fillet", "chamfer", "mirror",
]);

function collectRecipeIssues(recipe: any): string[] {
  if (!recipe || typeof recipe !== "object") return ["Recipe must be a JSON object."];
  if (!Array.isArray(recipe.features) || recipe.features.length === 0) {
    return ["Recipe must include a non-empty features array."];
  }

  const issues: string[] = [];
  const ids = new Set<string>();

  for (const feature of recipe.features) {
    if (!feature || typeof feature !== "object") {
      issues.push("Every feature must be an object.");
      continue;
    }

    const id = typeof feature.id === "string" ? feature.id : "(missing id)";
    const type = typeof feature.type === "string" ? feature.type : "(missing type)";

    if (typeof feature.id !== "string" || !feature.id) {
      issues.push(`Feature ${id} is missing a string id.`);
    } else if (ids.has(feature.id)) {
      issues.push(`Feature ${feature.id} is duplicated.`);
    } else {
      ids.add(feature.id);
    }

    if (typeof feature.type !== "string" || !feature.type) {
      issues.push(`Feature ${id} is missing a string type.`);
      continue;
    }

    if (type === "sketch") {
      if (!NAMED_PLANES.has(feature.plane)) {
        issues.push(`Sketch ${id} must use plane XY, YZ, or XZ.`);
      }
      for (const curve of Array.isArray(feature.curves) ? feature.curves : []) {
        if (
          curve?.type === "arc" &&
          typeof curve.start_deg === "number" &&
          typeof curve.end_deg === "number" &&
          Math.abs(curve.end_deg - curve.start_deg) >= 360
        ) {
          issues.push(`Sketch ${id} contains a full-circle arc, which the worker cannot build safely.`);
        }
      }
    }

    if (type === "extrude") {
      if (
        typeof feature.depth_mm !== "number" ||
        !Number.isFinite(feature.depth_mm) ||
        feature.depth_mm <= 0
      ) {
        issues.push(`Extrude ${id} must use a positive depth_mm.`);
      }
      if (feature.origin !== undefined) {
        issues.push(`Extrude ${id} uses unsupported origin placement.`);
      }
    }

    if (type === "shell") {
      if (
        typeof feature.thickness_mm !== "number" ||
        !Number.isFinite(feature.thickness_mm) ||
        feature.thickness_mm <= 0
      ) {
        issues.push(`Shell ${id} must use a positive thickness_mm.`);
      }
    }

    if (type === "mirror") {
      const plane = feature.plane ?? "YZ";
      if (!NAMED_PLANES.has(plane)) {
        issues.push(`Mirror ${id} must use plane XY, YZ, or XZ.`);
      }
    }
  }

  const hasBody = recipe.features.some(
    (f: any) => f && typeof f.type === "string" && BODY_PRODUCING.has(f.type),
  );
  if (!hasBody) {
    issues.push(
      "Recipe has no body-producing feature (need at least one extrude / loft / revolve / sweep).",
    );
  }

  return issues;
}

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

    const issues = collectRecipeIssues(recipe);
    if (issues.length) {
      return json(
        {
          error: `Recipe is not CAD-worker-safe: ${issues[0]}`,
          issues,
          recipe,
        },
        422,
      );
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
