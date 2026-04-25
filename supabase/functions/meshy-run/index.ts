/**
 * meshy-run
 *
 * Admin-only edge function that kicks off a Meshy 6 image-to-3d task from
 * the Meshy Admin UI. Records the request in `meshy_generations` so the
 * admin can promote the result into the Part Library or Body Skin Library
 * once it lands.
 *
 * Two actions:
 *   action: "start"   → creates Meshy task, inserts meshy_generations row
 *                       with status="running" and meshy_task_id.
 *   action: "status"  → polls Meshy by generation id; on success downloads
 *                       the GLB into the body-skins bucket and updates the
 *                       row with output_glb_url + preview_url.
 *
 * Body:
 *   start:  { action: "start", generation_type, prompt, image_url,
 *             texture_image_url?, donor_car_template_id? }
 *   status: { action: "status", generation_id }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createImageTo3dTask, getImageTo3dTask } from "../_shared/meshy.ts";

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
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) return json({ error: "Admin only" }, 403);

    const body = await req.json() as {
      action?: "start" | "status";
      generation_id?: string;
      generation_type?: "part" | "body_skin";
      prompt?: string;
      image_url?: string;
      texture_image_url?: string | null;
      donor_car_template_id?: string | null;
    };
    const action = body.action ?? "start";

    if (action === "start") {
      const { generation_type, prompt, image_url } = body;
      if (!generation_type || !prompt || !image_url) {
        return json({ error: "generation_type, prompt and image_url required" }, 400);
      }

      const { data: gen, error: insErr } = await admin
        .from("meshy_generations")
        .insert({
          user_id: userId,
          generation_type,
          prompt,
          reference_image_urls: [image_url, body.texture_image_url].filter(Boolean),
          parameters: { ai_model: "latest", source: "meshy_admin" },
          donor_car_template_id: body.donor_car_template_id ?? null,
          status: "queued",
        })
        .select("*")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      try {
        const { task_id } = await createImageTo3dTask({
          image_url,
          texture_image_url: body.texture_image_url ?? undefined,
          ai_model: "latest",
          enable_pbr: true,
          should_remesh: true,
          target_polycount: generation_type === "body_skin" ? 80000 : 30000,
          symmetry_mode: generation_type === "body_skin" ? "on" : "auto",
          remove_lighting: true,
          target_formats: ["glb", "stl"],
        });
        await admin.from("meshy_generations")
          .update({ meshy_task_id: task_id, status: "running" })
          .eq("id", gen.id);
        return json({ generation_id: gen.id, task_id, status: "running" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Meshy create failed";
        await admin.from("meshy_generations")
          .update({ status: "failed", error: msg.slice(0, 500) })
          .eq("id", gen.id);
        return json({ error: msg, generation_id: gen.id }, 500);
      }
    }

    // STATUS
    const { generation_id } = body;
    if (!generation_id) return json({ error: "generation_id required" }, 400);

    const { data: gen } = await admin
      .from("meshy_generations")
      .select("*")
      .eq("id", generation_id)
      .maybeSingle();
    if (!gen) return json({ error: "Generation not found" }, 404);
    if (!gen.meshy_task_id) return json({ error: "No meshy task on this generation" }, 400);
    if (gen.status === "complete") {
      return json({ status: "complete", glb_url: gen.output_glb_url });
    }

    const result = await getImageTo3dTask(gen.meshy_task_id);

    if (result.status === "FAILED" || result.status === "CANCELED" || result.status === "EXPIRED") {
      const msg = (result.error || `Meshy ${result.status}`).slice(0, 500);
      await admin.from("meshy_generations")
        .update({ status: "failed", error: msg })
        .eq("id", generation_id);
      return json({ status: "failed", error: msg });
    }
    if (result.status !== "SUCCEEDED") {
      return json({ status: "running", progress: result.progress });
    }
    if (!result.glb_url) {
      await admin.from("meshy_generations")
        .update({ status: "failed", error: "Meshy returned no GLB" })
        .eq("id", generation_id);
      return json({ status: "failed", error: "Meshy returned no GLB" });
    }

    // Re-host the GLB so we own it (Meshy URLs expire).
    const glbResp = await fetch(result.glb_url);
    if (!glbResp.ok) {
      return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    }
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());
    const folder = gen.generation_type === "body_skin" ? "body-skins" : "parts";
    const path = `${userId}/${folder}/${generation_id}-${Date.now()}.glb`;
    const bucket = gen.generation_type === "body_skin" ? "body-skins" : "concept-renders";
    const { error: upErr } = await admin.storage
      .from(bucket)
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    let publicUrl: string;
    if (bucket === "body-skins") {
      const { data: signed, error: sErr } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365);
      if (sErr) return json({ error: `Sign failed: ${sErr.message}` }, 500);
      publicUrl = signed.signedUrl;
    } else {
      publicUrl = admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    }
    const bustedUrl = `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;

    await admin.from("meshy_generations").update({
      status: "complete",
      output_glb_url: bustedUrl,
      preview_url: result.thumbnail_url,
      error: null,
    }).eq("id", generation_id);

    return json({ status: "complete", glb_url: bustedUrl, preview_url: result.thumbnail_url });
  } catch (e) {
    console.error("meshy-run error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
