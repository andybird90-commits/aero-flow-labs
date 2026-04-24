/**
 * generate-cad-recipe
 *
 * Uses Lovable AI (Gemini) to convert a part kind + label + optional reference
 * image set into a strict-JSON parametric CAD recipe the CadQuery worker can
 * execute. Heavily validates the AI output before returning, and falls back to
 * a known-good template recipe for body-panel parts (arches, fenders) where
 * the AI tends to produce unbuildable freeform geometry.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

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
    { "type": "sketch", "id": "s1", "plane": "XY"|"YZ"|"XZ",
      "curves": [
        { "type":"line",   "from":[x,y], "to":[x,y] },
        { "type":"arc",    "center":[x,y], "radius":r, "start_deg":a, "end_deg":b },
        { "type":"spline", "points":[[x,y],...] },
        { "type":"naca",   "code":"6412", "chord":120, "origin":[x,y], "rotation_deg":-3 }
      ]
    },
    { "type": "extrude", "id":"e1", "sketch":"s1", "depth_mm": 20, "symmetric": false },
    { "type": "loft",    "id":"l1", "sketches":["s1","s2"] },
    { "type": "revolve", "id":"r1", "sketch":"s1", "axis":"Y", "angle_deg": 180 },
    { "type": "shell",   "id":"sh1","target":"e1", "thickness_mm": 2.0, "open_faces":["+Z"] },
    { "type": "fillet",  "id":"f1", "target":"e1", "edges":"all", "radius_mm": 3 },
    { "type": "chamfer", "id":"c1", "target":"e1", "edges":"all", "distance_mm": 1.5 },
    { "type": "mirror",  "id":"m1", "target":"e1", "plane":"YZ" },
    { "type": "boolean", "id":"b1", "op":"union"|"cut"|"intersect", "targets":["e1","m1"] },
    { "type": "import_mesh", "id":"car", "url":"<base_mesh_url>" }
  ],
  "outputs": ["step", "stl", "glb"]
}

WORKER-SAFE RULES (the worker WILL crash if any are violated):
- Always set units to "mm".
- Every feature MUST have a unique "id". Later features reference earlier ones by id.
- Sketch "plane" MUST be the literal string "XY", "YZ", or "XZ". Never use {origin, normal} object planes.
- Never use the "origin" key on extrude features. Position via the sketch's plane instead.
- Never use "import_mesh" unless a base mesh URL is explicitly provided in the prompt.
- Every sketch MUST form ONE closed profile. The first curve's start point and the last curve's end point must coincide.
- Use AT MOST one spline per sketch (long splines are fragile). Combine line + arc + at most one spline.
- Never draw a full-circle arc (avoid start_deg/end_deg spans of 360 degrees).
- depth_mm MUST be strictly positive. thickness_mm MUST be strictly positive.
- Shell with negative thickness is forbidden.
- Revolve angle_deg MUST be in (0, 360); prefer values <= 180 for body parts.
- For body panels (fenders, arches, skirts, lips, splitters, diffusers): DO NOT loft between sketches on different planes; instead use ONE closed sketch on YZ or XZ + a single positive extrude + optional fillet. Body-panel recipes MUST stay under 8 features.
- BODY-CONFORMING RULE: when a base car mesh URL is provided AND the part is a body-conforming panel (arch, fender, skirt, lip, splitter, diffuser), the recipe MUST include an "import_mesh" feature with that exact URL, and the FINAL feature MUST be a boolean "intersect" between the freshly-extruded panel body and the imported car mesh — so the panel is trimmed to the car's actual surface. Without this, the part will not fit the car.
- For aero parts (wings, canards): NACA airfoil sketch + symmetric extrude is preferred.
- Use mirror across "YZ" for left/right pairs.
- Total features MUST be <= 20. Prefer simplicity over cleverness.
- The LAST body-producing feature is what gets exported, so end with the final composite.

Return ONLY the JSON object.`;

const NAMED_PLANES = new Set(["XY", "YZ", "XZ"]);
const BODY_PRODUCING = new Set([
  "extrude", "loft", "revolve", "sweep", "boolean",
  "shell", "fillet", "chamfer", "mirror",
]);

const BODY_PANEL_KINDS = new Set([
  "wide_arch", "front_arch", "rear_arch", "arch",
  "fender_panel", "fender", "wide_fender",
  "side_skirt", "skirt", "lip", "front_lip", "rear_lip",
  "splitter", "diffuser",
]);

function isClosed(curves: any[]): boolean {
  if (!Array.isArray(curves) || curves.length === 0) return false;
  const start = endpointStart(curves[0]);
  const end = endpointEnd(curves[curves.length - 1]);
  if (!start || !end) return false;
  const dx = start[0] - end[0];
  const dy = start[1] - end[1];
  return Math.hypot(dx, dy) < 1.0; // 1mm tolerance
}

function endpointStart(curve: any): [number, number] | null {
  if (!curve || typeof curve !== "object") return null;
  if (curve.type === "line" && Array.isArray(curve.from)) return [curve.from[0], curve.from[1]];
  if (curve.type === "arc" && Array.isArray(curve.center) && typeof curve.radius === "number") {
    const a = (curve.start_deg ?? 0) * Math.PI / 180;
    return [curve.center[0] + curve.radius * Math.cos(a), curve.center[1] + curve.radius * Math.sin(a)];
  }
  if (curve.type === "spline" && Array.isArray(curve.points) && curve.points.length > 0) {
    const p = curve.points[0];
    return [p[0], p[1]];
  }
  return null;
}

function endpointEnd(curve: any): [number, number] | null {
  if (!curve || typeof curve !== "object") return null;
  if (curve.type === "line" && Array.isArray(curve.to)) return [curve.to[0], curve.to[1]];
  if (curve.type === "arc" && Array.isArray(curve.center) && typeof curve.radius === "number") {
    const a = (curve.end_deg ?? 0) * Math.PI / 180;
    return [curve.center[0] + curve.radius * Math.cos(a), curve.center[1] + curve.radius * Math.sin(a)];
  }
  if (curve.type === "spline" && Array.isArray(curve.points) && curve.points.length > 0) {
    const p = curve.points[curve.points.length - 1];
    return [p[0], p[1]];
  }
  return null;
}

function collectRecipeIssues(recipe: any, opts: { partKind: string; hasBaseMesh: boolean }): string[] {
  if (!recipe || typeof recipe !== "object") return ["Recipe must be a JSON object."];
  if (!Array.isArray(recipe.features) || recipe.features.length === 0) {
    return ["Recipe must include a non-empty features array."];
  }

  const issues: string[] = [];
  const ids = new Set<string>();
  const isBodyPanel = BODY_PANEL_KINDS.has(opts.partKind);

  if (recipe.features.length > 20) {
    issues.push(`Recipe has ${recipe.features.length} features; max is 20.`);
  }
  if (isBodyPanel && recipe.features.length > 8) {
    issues.push(`Body-panel recipes must stay under 8 features (got ${recipe.features.length}).`);
  }

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

    if (type === "import_mesh" && !opts.hasBaseMesh) {
      issues.push(`import_mesh feature ${id} is not allowed without a base mesh URL.`);
    }

    if (type === "sketch") {
      if (!NAMED_PLANES.has(feature.plane)) {
        issues.push(`Sketch ${id} must use plane "XY", "YZ", or "XZ" (got ${JSON.stringify(feature.plane)}).`);
      }
      const curves = Array.isArray(feature.curves) ? feature.curves : [];
      if (curves.length === 0) {
        issues.push(`Sketch ${id} has no curves.`);
      }
      let splines = 0;
      for (const curve of curves) {
        if (curve?.type === "spline") splines++;
        if (
          curve?.type === "arc" &&
          typeof curve.start_deg === "number" &&
          typeof curve.end_deg === "number" &&
          Math.abs(curve.end_deg - curve.start_deg) >= 360
        ) {
          issues.push(`Sketch ${id} contains a full-circle arc; use two half-arcs instead.`);
        }
      }
      if (splines > 1) {
        issues.push(`Sketch ${id} has ${splines} splines; use at most one spline per sketch.`);
      }
      if (curves.length > 0 && !isClosed(curves)) {
        issues.push(`Sketch ${id} is not a closed profile (start and end points must coincide).`);
      }
    }

    if (type === "extrude") {
      if (
        typeof feature.depth_mm !== "number" ||
        !Number.isFinite(feature.depth_mm) ||
        feature.depth_mm <= 0
      ) {
        issues.push(`Extrude ${id} must use a strictly positive depth_mm.`);
      }
      if (feature.origin !== undefined) {
        issues.push(`Extrude ${id} uses unsupported "origin" placement; place the sketch on the correct named plane instead.`);
      }
      if (feature.plane !== undefined && !NAMED_PLANES.has(feature.plane)) {
        issues.push(`Extrude ${id} uses an unsupported plane.`);
      }
    }

    if (type === "loft" && isBodyPanel) {
      issues.push(`Loft ${id} is not allowed for body-panel parts; use a single closed sketch + extrude.`);
    }

    if (type === "shell") {
      if (
        typeof feature.thickness_mm !== "number" ||
        !Number.isFinite(feature.thickness_mm) ||
        feature.thickness_mm <= 0
      ) {
        issues.push(`Shell ${id} must use a strictly positive thickness_mm.`);
      }
    }

    if (type === "revolve") {
      if (
        typeof feature.angle_deg !== "number" ||
        feature.angle_deg <= 0 ||
        feature.angle_deg >= 360
      ) {
        issues.push(`Revolve ${id} angle_deg must be in (0, 360).`);
      }
    }

    if (type === "mirror") {
      const plane = feature.plane ?? "YZ";
      if (!NAMED_PLANES.has(plane)) {
        issues.push(`Mirror ${id} must use plane "XY", "YZ", or "XZ".`);
      }
    }
  }

  const hasBody = recipe.features.some(
    (f: any) => f && typeof f.type === "string" && BODY_PRODUCING.has(f.type),
  );
  if (!hasBody) {
    issues.push("Recipe has no body-producing feature (need at least one extrude / loft / revolve).");
  }

  // Body-conforming requirement: if a base mesh is available and this is a
  // body panel, the recipe MUST trim the panel against the imported car mesh,
  // otherwise the part has no chance of fitting the car.
  if (isBodyPanel && opts.hasBaseMesh) {
    const importMesh = recipe.features.find((f: any) => f?.type === "import_mesh");
    if (!importMesh) {
      issues.push("Body-conforming part must include an import_mesh feature referencing the base car mesh.");
    }
    const last = recipe.features[recipe.features.length - 1];
    if (
      !last ||
      last.type !== "boolean" ||
      last.op !== "intersect" ||
      !Array.isArray(last.targets) ||
      (importMesh && !last.targets.includes(importMesh.id))
    ) {
      issues.push("Body-conforming part must end with a boolean intersect between the panel body and the imported car mesh.");
    }
  }

  return issues;
}

/**
 * Conservative known-good template for body-panel parts. Single closed YZ
 * sketch + symmetric extrude + edge fillet. When a base mesh URL is provided
 * we also import it and intersect the extruded slab with the car body so the
 * resulting part actually conforms to the vehicle's surface.
 */
function fallbackRecipeForBodyPanel(
  partKind: string,
  partLabel?: string,
  baseMeshUrl?: string | null,
) {
  const isArch = partKind.includes("arch");
  // A simple flared quarter shape: rectangle with a chamfered top.
  const halfWidth = 220;     // mm — half of full panel width along X
  const height = isArch ? 380 : 320;
  const flare = isArch ? 60 : 40;
  const depth = isArch ? 180 : 220; // extrusion thickness (X direction, since plane is YZ)
  const features: any[] = [
    {
      type: "sketch",
      id: "s_profile",
      plane: "YZ",
      curves: [
        { type: "line", from: [-halfWidth, 0], to: [halfWidth, 0] },
        { type: "line", from: [halfWidth, 0], to: [halfWidth + flare, height * 0.6] },
        { type: "line", from: [halfWidth + flare, height * 0.6], to: [halfWidth, height] },
        { type: "line", from: [halfWidth, height], to: [-halfWidth, height] },
        { type: "line", from: [-halfWidth, height], to: [-halfWidth - flare, height * 0.6] },
        { type: "line", from: [-halfWidth - flare, height * 0.6], to: [-halfWidth, 0] },
      ],
    },
    { type: "extrude", id: "e_body", sketch: "s_profile", depth_mm: depth, symmetric: true },
    { type: "fillet", id: "f_edges", target: "e_body", edges: "all", radius_mm: 8 },
  ];

  if (baseMeshUrl) {
    features.push({ type: "import_mesh", id: "m_car", url: baseMeshUrl });
    features.push({
      type: "boolean",
      id: "b_fit",
      op: "intersect",
      targets: ["f_edges", "m_car"],
    });
  }

  return {
    version: 1,
    part: partKind,
    units: "mm",
    label: partLabel ?? partKind,
    features,
    outputs: ["step", "stl", "glb"],
    _fallback: true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const body = await req.json();
    const {
      part_kind,
      part_label,
      reference_image_urls = [],
      notes = "",
      base_mesh_url = null,
    } = body ?? {};
    if (!part_kind) return json({ error: "part_kind required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const isBodyPanel = BODY_PANEL_KINDS.has(part_kind);
    const userPrompt = [
      `Part kind: ${part_kind}`,
      part_label ? `Part label: ${part_label}` : null,
      base_mesh_url ? `Base car mesh URL (use this EXACT url for import_mesh): ${base_mesh_url}` : `No base car mesh available — DO NOT use import_mesh.`,
      isBodyPanel
        ? `This is a BODY PANEL. Output a single closed sketch on YZ + one positive extrude + optional fillet. Do NOT use loft. Do NOT use multiple sketches on different planes. Stay under 8 features.`
        : null,
      isBodyPanel && base_mesh_url
        ? `BODY-CONFORMING REQUIREMENT: include an import_mesh feature using the URL above (id "m_car"), and end the recipe with { "type":"boolean", "id":"b_fit", "op":"intersect", "targets":[<extruded panel id>, "m_car"] } so the panel is trimmed to the actual car surface. Without this final intersect, the part will not fit.`
        : null,
      notes ? `Designer notes: ${notes}` : null,
      reference_image_urls.length
        ? `Reference images attached. Match the silhouette closely but stay manufacturable.`
        : null,
      `Return the strict JSON recipe only.`,
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
      return json({ error: "AI returned invalid JSON", raw: String(raw).slice(0, 500) }, 500);
    }

    const validatorOpts = { partKind: part_kind, hasBaseMesh: !!base_mesh_url };
    let issues = collectRecipeIssues(recipe, validatorOpts);

    // For body panels, swap to a known-good fallback recipe instead of failing.
    if (issues.length && isBodyPanel) {
      const fallback = fallbackRecipeForBodyPanel(part_kind, part_label);
      const fbIssues = collectRecipeIssues(fallback, validatorOpts);
      if (fbIssues.length === 0) {
        return json({
          recipe: fallback,
          fallback_used: true,
          original_issues: issues,
        });
      }
    }

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
