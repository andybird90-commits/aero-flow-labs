/**
 * generate-cad-recipe
 *
 * NEW MODEL — "AI generates parameters, NOT code":
 *
 * The AI does NOT generate arbitrary CadQuery operations any more. Instead it
 * picks ONE trusted builder function (e.g. `build_front_arch`) and produces a
 * validated `params` object for it. The worker decides which trusted builder
 * to call. This eliminates the entire class of "the AI hallucinated an
 * unbuildable sketch" failures.
 *
 * Output (still stored in `cad_jobs.recipe` for backward compat):
 *   {
 *     "version": 2,
 *     "builder": "build_front_arch",
 *     "part_type": "front_arch",
 *     "params": { ... }
 *   }
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

// ---------------------------------------------------------------------------
// Trusted builder registry
// ---------------------------------------------------------------------------
//
// Each entry describes ONE builder function the worker is known to implement.
// The AI is forced to pick from this list. Validation runs server-side against
// `params` before we ever ship to the worker.

interface ParamSpec {
  type: "number" | "string" | "enum" | "vector3";
  min?: number;
  max?: number;
  values?: string[];
  required?: boolean;
  default?: number | string | number[];
  description?: string;
}

interface BuilderSpec {
  builder: string;
  part_types: string[];
  description: string;
  params: Record<string, ParamSpec>;
}

const BUILDERS: BuilderSpec[] = [
  {
    builder: "build_front_arch",
    part_types: ["front_arch", "front_fender_flare", "wide_arch", "arch_left", "arch_right", "fender_flare"],
    description: "Solid wheel arch / fender flare for the front. Curved sweep around the wheel with optional outward flare and an inward lip return.",
    params: {
      side:              { type: "enum",   values: ["left", "right"], required: true,  default: "left" },
      radius:            { type: "number", min: 200, max: 600, required: true,  default: 330, description: "Wheel arch radius (mm)" },
      arch_width:        { type: "number", min: 30,  max: 250, required: true,  default: 90,  description: "Width of the arch panel along the tyre axis (mm)" },
      flare_out:         { type: "number", min: 0,   max: 200, required: true,  default: 55,  description: "How far the arch flares outward beyond the body (mm)" },
      thickness:         { type: "number", min: 1,   max: 20,  required: true,  default: 3,   description: "Panel wall thickness (mm)" },
      lip_return:        { type: "number", min: 0,   max: 60,  required: true,  default: 18,  description: "Inward return lip depth (mm)" },
      length_front:      { type: "number", min: 50,  max: 800, required: true,  default: 380, description: "How far forward the arch extends from the wheel centre (mm)" },
      length_rear:       { type: "number", min: 50,  max: 800, required: true,  default: 480, description: "How far rearward the arch extends from the wheel centre (mm)" },
      height_above_wheel:{ type: "number", min: 20,  max: 400, required: false, default: 100, description: "How high the arch reaches above the wheel centre (mm)" },
      wheel_centre:      { type: "vector3", required: false, description: "Optional [x,y,z] wheel-centre in vehicle coords. If omitted the arch is built at the origin." },
    },
  },
  // Future builders (rear_arch, splitter_blade, side_skirt, wing_blade…)
  // get added here. The AI can only pick from this list.
];

function findBuilderForPartKind(partKind: string): BuilderSpec | null {
  const k = partKind.toLowerCase();
  return BUILDERS.find((b) => b.part_types.some((p) => k.includes(p) || p.includes(k))) ?? null;
}

function findBuilderByName(name: string): BuilderSpec | null {
  return BUILDERS.find((b) => b.builder === name) ?? null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateParams(spec: BuilderSpec, params: Record<string, unknown>): { ok: true; params: Record<string, unknown> } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const out: Record<string, unknown> = {};

  for (const [key, ps] of Object.entries(spec.params)) {
    let v = params[key];
    if (v === undefined || v === null) {
      if (ps.required) {
        if (ps.default !== undefined) {
          v = ps.default;
        } else {
          issues.push(`Missing required param "${key}"`);
          continue;
        }
      } else if (ps.default !== undefined) {
        v = ps.default;
      } else {
        continue;
      }
    }

    if (ps.type === "number") {
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        issues.push(`Param "${key}" must be a finite number (got ${JSON.stringify(v)})`);
        continue;
      }
      if (ps.min !== undefined && n < ps.min) issues.push(`Param "${key}"=${n} below min ${ps.min}`);
      if (ps.max !== undefined && n > ps.max) issues.push(`Param "${key}"=${n} above max ${ps.max}`);
      if (n < 1 && (key.includes("radius") || key.includes("width") || key.includes("thickness") || key.includes("length"))) {
        issues.push(`Dimension "${key}"=${n}mm is sub-millimetre — rejected.`);
      }
      out[key] = n;
    } else if (ps.type === "enum") {
      if (typeof v !== "string" || !ps.values?.includes(v)) {
        issues.push(`Param "${key}" must be one of ${JSON.stringify(ps.values)} (got ${JSON.stringify(v)})`);
        continue;
      }
      out[key] = v;
    } else if (ps.type === "string") {
      if (typeof v !== "string" || v.length === 0) {
        issues.push(`Param "${key}" must be a non-empty string`);
        continue;
      }
      out[key] = v;
    } else if (ps.type === "vector3") {
      if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        issues.push(`Param "${key}" must be a [x,y,z] array of 3 finite numbers`);
        continue;
      }
      out[key] = v;
    }
  }

  // Reject unknown keys (forces AI to stick to schema).
  for (const k of Object.keys(params)) {
    if (!(k in spec.params)) {
      // soft-ignore rather than hard-fail (AI sometimes adds a "style" hint)
      // but DO surface so we can audit
      console.warn(`generate-cad-recipe: ignoring unknown param "${k}"`);
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, params: out };
}

// ---------------------------------------------------------------------------
// Fallback param sets — used when the AI is offline / returns garbage
// ---------------------------------------------------------------------------

function fallbackParams(spec: BuilderSpec, partLabel: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(spec.params)) {
    if (p.default !== undefined) out[k] = p.default;
  }
  // Side hint from label.
  const lbl = partLabel.toLowerCase();
  if ("side" in spec.params) {
    if (/right|rh|\(r\)/.test(lbl)) out.side = "right";
    else out.side = "left";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      concept_id = null,
      part_kind,
      part_label = "",
      reference_image_urls = [],
      base_mesh_url = null,
      notes = "",
    } = body ?? {};

    if (!part_kind) return json({ error: "part_kind required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const spec = findBuilderForPartKind(part_kind);
    if (!spec) {
      return json({
        error: `No trusted CAD builder yet for part_kind="${part_kind}". Available builders: ${BUILDERS.map((b) => b.builder).join(", ")}.`,
      }, 400);
    }

    // 1) Try Lovable AI to fill params. We give it the schema and demand strict
    //    JSON of shape { params: {...} } — nothing else.
    let aiParams: Record<string, unknown> | null = null;
    let aiError: string | null = null;

    if (LOVABLE_API_KEY) {
      try {
        aiParams = await callLovableAI(spec, {
          part_kind, part_label, notes,
          reference_image_urls: reference_image_urls.slice(0, 4),
          has_base_mesh: !!base_mesh_url,
        });
      } catch (e) {
        aiError = e instanceof Error ? e.message : String(e);
        console.warn("AI param generation failed:", aiError);
      }
    }

    let chosenParams = aiParams;
    let fallbackUsed = false;
    let originalIssues: string[] = [];

    if (chosenParams) {
      const v = validateParams(spec, chosenParams);
      if (!v.ok) {
        originalIssues = v.issues;
        console.warn(`AI params failed validation, using fallback:`, v.issues);
        chosenParams = null;
      } else {
        chosenParams = v.params;
      }
    }

    if (!chosenParams) {
      const fb = fallbackParams(spec, part_label);
      const v = validateParams(spec, fb);
      if (!v.ok) {
        return json({
          error: `Internal: fallback params for ${spec.builder} failed validation`,
          issues: v.issues,
        }, 500);
      }
      chosenParams = v.params;
      fallbackUsed = true;
    }

    const recipe = {
      version: 2,
      builder: spec.builder,
      part_type: part_kind,
      params: chosenParams,
    };

    return json({
      recipe,
      builder: spec.builder,
      fallback_used: fallbackUsed,
      original_issues: originalIssues,
      ai_error: aiError,
    });
  } catch (e) {
    console.error("generate-cad-recipe error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function callLovableAI(
  spec: BuilderSpec,
  ctx: { part_kind: string; part_label: string; notes: string; reference_image_urls: string[]; has_base_mesh: boolean },
): Promise<Record<string, unknown>> {
  const paramDocs = Object.entries(spec.params)
    .map(([k, p]) => {
      const range = p.min !== undefined ? ` (${p.min}–${p.max}${p.type === "number" ? "mm" : ""})` : "";
      const req = p.required ? "REQUIRED" : "optional";
      const enumStr = p.values ? ` one of ${JSON.stringify(p.values)}` : "";
      return `  - ${k} [${p.type}${enumStr}, ${req}, default ${JSON.stringify(p.default ?? null)}]${range}: ${p.description ?? ""}`;
    })
    .join("\n");

  const system = `You are a parametric CAD parameter generator. You do NOT write code. You ONLY pick numerical / enum values for a fixed builder function the worker already implements.

Builder: ${spec.builder}
Purpose: ${spec.description}

Allowed params:
${paramDocs}

Output STRICT JSON only, no prose, no markdown, of EXACTLY this shape:
{ "params": { "<key>": <value>, ... } }

Rules:
- Use millimetres for all dimensions.
- Stay inside the [min, max] ranges. Never invent new keys.
- Pick "side" from the label/notes (left vs right). Default to "left" if unsure.
- Aggressive / wide-body styles → flare_out, arch_width, height_above_wheel toward the upper end.
- Subtle / OEM+ styles → toward the lower end.
- Never return zero or negative dimensions.`;

  const userParts: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [];
  userParts.push({
    type: "text",
    text:
      `part_kind: ${ctx.part_kind}\n` +
      `part_label: ${ctx.part_label}\n` +
      `designer notes: ${ctx.notes || "(none)"}\n` +
      (ctx.has_base_mesh ? `(A base car mesh is available — pick proportions consistent with a real road car.)\n` : "") +
      (ctx.reference_image_urls.length ? `Reference images follow.` : ""),
  });
  for (const url of ctx.reference_image_urls) {
    userParts.push({ type: "image_url", image_url: { url } });
  }

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: userParts },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Lovable AI ${resp.status}: ${t.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned empty content");

  let parsed: any;
  try { parsed = JSON.parse(content); }
  catch { throw new Error(`AI returned non-JSON: ${String(content).slice(0, 200)}`); }

  if (!parsed || typeof parsed !== "object" || !parsed.params || typeof parsed.params !== "object") {
    throw new Error(`AI JSON missing "params" object`);
  }
  return parsed.params as Record<string, unknown>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
