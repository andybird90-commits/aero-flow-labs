/**
 * generate-part-mesh
 *
 * Path B prototype: generate a single fitted body-kit part as its own clean
 * GLB using Meshy text-to-3D, then snap it to the part's anchor in the viewer.
 *
 * Currently supports `wing` only — proves the per-part flow before we expand
 * to splitter / canards / skirts / diffuser / ducktail.
 *
 * Body: { fitted_part_id: string }
 * Returns: { status: "generating", fitted_part_id } (202) — runs in background.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MESHY_API_KEY = Deno.env.get("MESHY_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MESHY_TEXT_BASE = "https://api.meshy.ai/openapi/v2/text-to-3d";
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MS = 10 * 60 * 1000;

/**
 * Per-kind prompt + style hints. Each part is generated as a single isolated
 * automotive component on a transparent background — no car body around it,
 * so we get a clean part we can snap onto the user's STL via anchors.
 */
const PART_PROMPTS: Record<string, { prompt: string; negative: string }> = {
  wing: {
    prompt:
      "A single isolated motorsport rear wing for a sports car. Carbon fiber GT-style swan-neck wing with a curved airfoil main plane, two vertical end plates, and twin swan-neck mounts attaching from above. Clean hard-surface CAD-style geometry. Centered, symmetric, no car body, no background, single solid object.",
    negative: "car, vehicle, body, bumper, wheel, ground, environment, multiple objects, lattice, struts, scaffolding",
  },
  splitter: {
    prompt:
      "A single isolated front splitter for a sports car. Flat carbon fiber aerodynamic blade extending forward, with subtle side fences. Clean hard-surface CAD geometry, centered, symmetric, no car body, no background.",
    negative: "car, vehicle, body, wheel, bumper, ground, environment, lattice",
  },
  diffuser: {
    prompt:
      "A single isolated rear diffuser for a sports car. Carbon fiber underbody panel with parallel vertical fins / strakes angled upward. Clean hard-surface CAD geometry, centered, symmetric, no car body, no background.",
    negative: "car, vehicle, body, wheel, bumper, ground, environment",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!MESHY_API_KEY) return json({ error: "MESHY_API_KEY is not configured" }, 500);

    const { fitted_part_id } = await req.json();
    if (!fitted_part_id || typeof fitted_part_id !== "string") {
      return json({ error: "fitted_part_id is required" }, 400);
    }

    // Auth user
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Load fitted part (verify ownership)
    const { data: part, error: pErr } = await admin
      .from("fitted_parts")
      .select("id, user_id, kind, params, concept_set_id")
      .eq("id", fitted_part_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr || !part) return json({ error: "Part not found" }, 404);

    const promptConfig = PART_PROMPTS[part.kind];
    if (!promptConfig) {
      return json({ error: `AI mesh generation not supported for "${part.kind}" yet (prototype supports: ${Object.keys(PART_PROMPTS).join(", ")})` }, 400);
    }

    // Resolve project_id via concept_set so we can scope storage path
    const { data: cs } = await admin
      .from("concept_sets")
      .select("project_id")
      .eq("id", part.concept_set_id)
      .maybeSingle();
    const projectId = cs?.project_id ?? "unscoped";

    // Mark generating
    await admin
      .from("fitted_parts")
      .update({ ai_mesh_status: "generating", ai_mesh_error: null })
      .eq("id", fitted_part_id);

    console.log("generate-part-mesh: starting", { fitted_part_id, kind: part.kind });

    // @ts-ignore - EdgeRuntime is available in Supabase edge runtime
    EdgeRuntime.waitUntil(runJob({
      admin,
      fitted_part_id,
      userId,
      projectId,
      kind: part.kind,
      prompt: promptConfig.prompt,
      negative: promptConfig.negative,
    }));

    return json({ status: "generating", fitted_part_id }, 202);
  } catch (e) {
    console.error("generate-part-mesh error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function runJob({
  admin, fitted_part_id, userId, projectId, kind, prompt, negative,
}: {
  admin: ReturnType<typeof createClient>;
  fitted_part_id: string;
  userId: string;
  projectId: string;
  kind: string;
  prompt: string;
  negative: string;
}) {
  try {
    // Meshy text-to-3D is a 2-stage pipeline: preview (white mesh) -> refine (textured).
    // For body-kit parts we only need the preview — clean geometry, no PBR required,
    // half the credits and 2x faster.
    const createResp = await fetch(MESHY_TEXT_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MESHY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "preview",
        prompt,
        negative_prompt: negative,
        art_style: "realistic",
        ai_model: "meshy-5",
        topology: "quad",
        target_polycount: 30000,
        symmetry_mode: "on", // body kit parts are nearly always symmetric
        should_remesh: true,
      }),
    });

    if (!createResp.ok) {
      const t = await createResp.text();
      console.error("Meshy create failed:", createResp.status, t.slice(0, 500));
      await admin.from("fitted_parts").update({
        ai_mesh_status: "failed",
        ai_mesh_error: `Meshy ${createResp.status}: ${t.slice(0, 300)}`,
      }).eq("id", fitted_part_id);
      return;
    }

    const createJson = await createResp.json();
    const taskId: string | undefined = createJson.result;
    if (!taskId) {
      await admin.from("fitted_parts").update({
        ai_mesh_status: "failed",
        ai_mesh_error: "Meshy returned no task id",
      }).eq("id", fitted_part_id);
      return;
    }
    console.log("Meshy text-to-3D task created:", taskId, "for kind", kind);

    // Poll until done
    const start = Date.now();
    let task: any = null;
    while (true) {
      if (Date.now() - start > MAX_POLL_MS) {
        await admin.from("fitted_parts").update({
          ai_mesh_status: "failed",
          ai_mesh_error: "Generation timed out after 10 minutes",
        }).eq("id", fitted_part_id);
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollResp = await fetch(`${MESHY_TEXT_BASE}/${taskId}`, {
        headers: { Authorization: `Bearer ${MESHY_API_KEY}` },
      });
      if (!pollResp.ok) continue;
      task = await pollResp.json();
      console.log("Meshy poll:", task.status, "progress:", task.progress);
      if (["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"].includes(task.status)) break;
    }

    if (task.status !== "SUCCEEDED") {
      const errMsg = task.task_error?.message || `Meshy status: ${task.status}`;
      await admin.from("fitted_parts").update({
        ai_mesh_status: "failed",
        ai_mesh_error: String(errMsg).slice(0, 500),
      }).eq("id", fitted_part_id);
      return;
    }

    const glbUrl: string | undefined = task.model_urls?.glb;
    if (!glbUrl) {
      await admin.from("fitted_parts").update({
        ai_mesh_status: "failed",
        ai_mesh_error: "Meshy returned no GLB URL",
      }).eq("id", fitted_part_id);
      return;
    }

    // Download + re-host
    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) {
      await admin.from("fitted_parts").update({
        ai_mesh_status: "failed",
        ai_mesh_error: `Failed to download GLB: ${glbResp.status}`,
      }).eq("id", fitted_part_id);
      return;
    }
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());
    const path = `${userId}/${projectId}/parts/${fitted_part_id}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) {
      await admin.from("fitted_parts").update({
        ai_mesh_status: "failed",
        ai_mesh_error: `Upload failed: ${upErr.message}`,
      }).eq("id", fitted_part_id);
      return;
    }

    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    await admin.from("fitted_parts").update({
      ai_mesh_url: bustedUrl,
      ai_mesh_status: "ready",
      ai_mesh_error: null,
    }).eq("id", fitted_part_id);

    console.log("generate-part-mesh: success", bustedUrl);
  } catch (e) {
    console.error("runJob error:", e);
    await admin.from("fitted_parts").update({
      ai_mesh_status: "failed",
      ai_mesh_error: e instanceof Error ? e.message.slice(0, 500) : "Unknown error",
    }).eq("id", fitted_part_id);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
