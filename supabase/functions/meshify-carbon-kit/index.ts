/**
 * meshify-carbon-kit
 *
 * Reconstructs the entire isolated carbon-fibre body kit (matte-white side +
 * rear renders) as a SINGLE combined GLB using Meshy 6 image-to-3d.
 *
 * Why one mesh: the AI is bad at deciding "this pixel is the arch, this is
 * the bumper". By exporting the kit as one cohesive mesh and letting the
 * user split it in Fusion / Blender, we sidestep the labelling problem.
 *
 * Pixel sizing is preserved by:
 *   1. Sending matte-white renders (carbon weave + clearcoat reflections
 *      confuse Meshy's shape-from-shading).
 *   2. Optionally snapping the recovered scale to the project's hero STL
 *      bounding box (car length).
 *
 * Two actions:
 *   action: "start"  → kicks off Meshy task, persists task id.
 *   action: "status" → polls Meshy. On success, downloads GLB,
 *                      re-hosts it in `concept-renders`, persists URL,
 *                      and updates `carbon_kit_*` columns on the concept.
 *
 * Body: { action, concept_id }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createImageTo3dTask, getImageTo3dTask } from "../_shared/meshy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const KIT_TEXTURE_PROMPT =
  "Floating disconnected aftermarket aero parts (splitter, canards, side " +
  "skirts, flared arches, diffuser, rear wing, vents, quarter panels) in " +
  "matte white clay. Clean smooth surfaces, sharp edges, flat aero faces. " +
  "Parts stay visually distinct for CAD split.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as {
      action?: "start" | "status";
      concept_id?: string;
    };
    const action = body.action ?? "start";
    if (!body.concept_id) return json({ error: "concept_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: concept } = await admin
      .from("concepts")
      .select("*")
      .eq("id", body.concept_id)
      .maybeSingle();
    if (!concept) return json({ error: "Concept not found" }, 404);
    if (concept.user_id !== userId) return json({ error: "Forbidden" }, 403);

    // ─────────── START ───────────
    if (action === "start") {
      // Generate fresh MATTE WHITE renders of the kit (side + rear) for
      // meshing input. Carbon weave + clearcoat reflections confuse the
      // shape-from-shading; flat white clay gives clean silhouettes.
      const whiteResp = await fetch(`${SUPABASE_URL}/functions/v1/isolate-white-bodywork`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ concept_id: concept.id }),
      });
      if (!whiteResp.ok) {
        const t = await whiteResp.text();
        await admin.from("concepts").update({
          carbon_kit_status: "failed",
          carbon_kit_error: `White-render step failed: ${t.slice(0, 300)}`,
        }).eq("id", concept.id);
        return json({ error: `White-render step failed: ${t.slice(0, 300)}` }, 500);
      }
      const whiteJson = await whiteResp.json() as { side_url?: string | null; rear_url?: string | null };
      const sideUrl = typeof whiteJson.side_url === "string" ? whiteJson.side_url : null;
      const rearUrl = typeof whiteJson.rear_url === "string" ? whiteJson.rear_url : null;

      // Side gives us length; use it as the primary. Rear becomes the
      // texture reference so Meshy biases the back-side surfacing.
      const primary = sideUrl ?? rearUrl;
      if (!primary) {
        await admin.from("concepts").update({
          carbon_kit_status: "failed",
          carbon_kit_error: "White renders came back empty.",
        }).eq("id", concept.id);
        return json({ error: "White renders came back empty." }, 500);
      }
      const textureRef = primary === sideUrl ? rearUrl : sideUrl;

      await admin.from("concepts").update({
        carbon_kit_status: "queued",
        carbon_kit_error: null,
      }).eq("id", concept.id);

      try {
        const { task_id } = await createImageTo3dTask({
          image_url: primary,
          texture_image_url: textureRef ?? undefined,
          texture_prompt: textureRef ? undefined : KIT_TEXTURE_PROMPT,
          ai_model: "latest",
          enable_pbr: true,
          should_remesh: true,
          target_polycount: 50000,
          symmetry_mode: "on",
          remove_lighting: true,
          target_formats: ["glb", "stl"],
        });
        await admin.from("concepts").update({
          carbon_kit_status: "generating",
          carbon_kit_task_id: task_id,
        }).eq("id", concept.id);
        console.log("meshify-carbon-kit Meshy task created:", task_id);
        return json({ task_id, status: "generating", progress: 0 });
      } catch (e: any) {
        // Surface 429s as soft rate-limit so the UI can prompt a retry
        // without losing state.
        if (e?.status === 429) {
          await admin.from("concepts").update({
            carbon_kit_status: "idle",
            carbon_kit_error: null,
          }).eq("id", concept.id);
          return json({
            status: "rate_limited",
            retry_after: 10,
            message: "Meshy is rate-limiting requests. Try again in ~10s.",
          });
        }
        const msg = (e instanceof Error ? e.message : "Meshy create failed").slice(0, 500);
        await admin.from("concepts").update({
          carbon_kit_status: "failed",
          carbon_kit_error: msg,
        }).eq("id", concept.id);
        return json({ error: msg }, 500);
      }
    }

    // ─────────── STATUS ───────────
    const taskId = (concept as any).carbon_kit_task_id as string | null;
    if (!taskId) return json({ status: concept.carbon_kit_status ?? "idle" });

    const result = await getImageTo3dTask(taskId);

    if (result.status === "FAILED" || result.status === "CANCELED" || result.status === "EXPIRED") {
      const msg = (result.error || `Meshy ${result.status}`).slice(0, 500);
      await admin.from("concepts").update({
        carbon_kit_status: "failed",
        carbon_kit_error: msg,
      }).eq("id", concept.id);
      return json({ status: "failed", error: msg });
    }
    if (result.status !== "SUCCEEDED") {
      return json({ status: "generating", progress: result.progress });
    }

    const glbUrl = result.glb_url;
    if (!glbUrl) {
      await admin.from("concepts").update({
        carbon_kit_status: "failed",
        carbon_kit_error: "Meshy returned no GLB",
      }).eq("id", concept.id);
      return json({ error: "Meshy returned no GLB" }, 500);
    }

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());

    const path = `${userId}/${concept.project_id}/carbon_kit/${concept.id}-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage
      .from("concept-renders")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    // Try to recover real-world scale from the project's hero STL bbox
    // (car length in mm). Meshy returns mesh in arbitrary units; emit
    // scale_m so the user can rescale on import.
    let scaleM: number | null = null;
    try {
      const { data: project } = await admin
        .from("projects")
        .select("car_id")
        .eq("id", concept.project_id)
        .maybeSingle();
      if (project?.car_id) {
        const { data: car } = await admin
          .from("cars")
          .select("template_id")
          .eq("id", project.car_id)
          .maybeSingle();
        if (car?.template_id) {
          const { data: stl } = await admin
            .from("car_stls")
            .select("bbox_min_mm, bbox_max_mm")
            .eq("car_template_id", car.template_id)
            .maybeSingle();
          const minB = stl?.bbox_min_mm as number[] | null | undefined;
          const maxB = stl?.bbox_max_mm as number[] | null | undefined;
          if (minB && maxB && minB.length === 3 && maxB.length === 3) {
            const lenMm = Math.max(
              maxB[0] - minB[0],
              maxB[1] - minB[1],
              maxB[2] - minB[2],
            );
            if (lenMm > 0) scaleM = lenMm / 1000;
          }
        }
      }
    } catch (e) {
      console.warn("scale recovery failed:", e);
    }

    await admin.from("concepts").update({
      carbon_kit_status: "ready",
      carbon_kit_glb_url: bustedUrl,
      carbon_kit_stl_url: bustedUrl, // GLB doubles as download; STL conversion happens client-side via existing glb-to-stl helper.
      carbon_kit_scale_m: scaleM,
      carbon_kit_error: null,
    }).eq("id", concept.id);

    return json({
      status: "ready",
      progress: 100,
      glb_url: bustedUrl,
      stl_url: bustedUrl,
      scale_m: scaleM,
    });
  } catch (e) {
    console.error("meshify-carbon-kit error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
