/**
 * build-aero-kit
 *
 * Single entry point the UI calls. Queues the build immediately, then runs
 *   displace-stl-to-concept → subtract-aero-kit
 * in the background while the UI polls `concepts.aero_kit_status`.
 *
 * Refuses to run if:
 *   - The project's car has no hero STL.
 *   - The hero STL is not repaired.
 *   - The concept has no renders to compare against.
 *
 * Body: { concept_id: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { concept_id?: string };
    if (!body.concept_id) return json({ error: "concept_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Pre-flight: confirm the kit can actually run before mutating any state.
    const { data: concept } = await admin
      .from("concepts").select("*").eq("id", body.concept_id).maybeSingle();
    if (!concept) return json({ error: "concept not found" }, 404);
    if (concept.user_id !== userRes.user.id) return json({ error: "Forbidden" }, 403);
    if (!concept.render_front_url && !concept.render_side_url && !concept.render_rear_url) {
      return json({ error: "Concept has no renders to compare against." }, 400);
    }

    const { data: project } = await admin
      .from("projects").select("*, car:cars(template_id)").eq("id", concept.project_id).maybeSingle();
    const templateId = (project as any)?.car?.template_id;
    if (!templateId) return json({ error: "Project car has no template" }, 400);

    const { data: stlRow } = await admin
      .from("car_stls").select("*").eq("car_template_id", templateId).maybeSingle();
    if (!stlRow) return json({ error: "Upload a hero STL for this car first." }, 400);
    if (!stlRow.repaired_stl_path) return json({ error: "Repair the hero STL first." }, 400);
    // Note: non-manifold meshes are allowed through. The boolean kit may produce
    // imperfect shells (stray faces, open edges) on scraped meshes with holes,
    // but it's better than blocking the user entirely. The UI surfaces a warning.
    const nonManifoldWarning = !stlRow.manifold_clean
      ? "Hero STL is non-manifold — kit output may have stray or open faces."
      : null;

    await admin.from("concepts").update({
      aero_kit_status: "queued",
      aero_kit_error: null,
      aero_kit_warning: nonManifoldWarning,
      aero_kit_url: null,
    }).eq("id", concept.id);

    EdgeRuntime.waitUntil(runBuildInBackground({ conceptId: concept.id, authHeader }));
    return json({ started: true, concept_id: concept.id, status: "queued", warning: nonManifoldWarning }, 202);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

async function runBuildInBackground({ conceptId, authHeader }: { conceptId: string; authHeader: string }) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const headers = {
    "Content-Type": "application/json",
    Authorization: authHeader,
  };

  try {
    const dispResp = await fetch(`${SUPABASE_URL}/functions/v1/displace-stl-to-concept`, {
      method: "POST",
      headers,
      body: JSON.stringify({ concept_id: conceptId }),
    });
    if (!dispResp.ok) {
      const errText = await dispResp.text();
      await markFailed(admin, conceptId, `Displacement failed: ${errText.slice(0, 300)}`);
      return;
    }
    await dispResp.text();

    const subResp = await fetch(`${SUPABASE_URL}/functions/v1/subtract-aero-kit`, {
      method: "POST",
      headers,
      body: JSON.stringify({ concept_id: conceptId }),
    });
    if (!subResp.ok) {
      const errText = await subResp.text();
      await markFailed(admin, conceptId, `Subtraction failed: ${errText.slice(0, 300)}`);
      return;
    }
    await subResp.text();
  } catch (e) {
    await markFailed(admin, conceptId, String((e as Error).message ?? e));
  }
}

async function markFailed(admin: any, conceptId: string, message: string) {
  await admin.from("concepts").update({ aero_kit_status: "failed", aero_kit_error: message }).eq("id", conceptId);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
