/**
 * meshify-prototype
 *
 * Prototyper meshing step. Takes the cached front/side render URLs from a
 * prototype row and runs Meshy 6 image-to-3d to produce a textured GLB.
 *
 * Two actions:
 *   action: "start"  → kicks off Meshy task, stores task_id on the prototype.
 *   action: "status" → polls Meshy. On success: downloads GLB, re-hosts in
 *                      our bucket, writes glb_url, AND auto-creates a
 *                      library_items row (prototype_part_mesh) so the part
 *                      shows up in the Library with a Prototype badge.
 *
 * Body: { action, prototype_id }
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
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = (await req.json()) as { action?: "start" | "status"; prototype_id?: string };
    const action = body.action ?? "start";
    const { prototype_id } = body;
    if (!prototype_id) return json({ error: "prototype_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: proto } = await admin
      .from("prototypes")
      .select("id, user_id, title, render_urls, mesh_task_id, glb_url")
      .eq("id", prototype_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!proto) return json({ error: "Prototype not found" }, 404);

    if (action === "start") {
      const renders = ((proto.render_urls as Array<{ angle: string; url: string }>) ?? []);
      if (!renders.length) return json({ error: "No renders yet — run render-prototype-views first" }, 400);

      // Meshy 6 takes a single primary image. Use the front 3/4 if present,
      // otherwise the first render. Use side as the texture reference if available.
      const primary = renders.find((r) => r.angle === "front34")?.url
        ?? renders.find((r) => r.angle === "front")?.url
        ?? renders[0].url;
      const textureRef = renders.find((r) => r.angle === "side")?.url
        ?? renders.find((r) => r.angle === "rear34")?.url
        ?? null;

      try {
        const { task_id } = await createImageTo3dTask({
          image_url: primary,
          texture_image_url: textureRef ?? undefined,
          ai_model: "latest",
          enable_pbr: true,
          should_remesh: true,
          target_polycount: 30000,
          symmetry_mode: "auto",
          remove_lighting: true,
          target_formats: ["glb", "stl"],
        });
        await admin.from("prototypes")
          .update({ mesh_status: "meshing", mesh_task_id: task_id, mesh_error: null })
          .eq("id", prototype_id);
        return json({ task_id, status: "IN_PROGRESS", progress: 0 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Meshy create failed";
        await admin.from("prototypes")
          .update({ mesh_status: "failed", mesh_error: msg.slice(0, 500) })
          .eq("id", prototype_id);
        return json({ error: msg }, 500);
      }
    }

    // STATUS
    const taskId = (proto.mesh_task_id as string | null) ?? null;
    if (!taskId) return json({ error: "No active mesh task — start one first" }, 400);

    const result = await getImageTo3dTask(taskId);

    if (result.status === "FAILED" || result.status === "CANCELED" || result.status === "EXPIRED") {
      const msg = (result.error || `Meshy ${result.status}`).slice(0, 500);
      await admin.from("prototypes")
        .update({ mesh_status: "failed", mesh_error: msg })
        .eq("id", prototype_id);
      return json({ status: "FAILED", error: msg });
    }
    if (result.status !== "SUCCEEDED") {
      return json({ status: "IN_PROGRESS", progress: result.progress });
    }

    const glbUrl = result.glb_url;
    if (!glbUrl) return json({ error: "Meshy returned no GLB url" }, 500);

    const glbResp = await fetch(glbUrl);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());

    const path = `${userId}/prototypes/${prototype_id}/mesh-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage.from("concept-renders").upload(path, glbBytes, {
      contentType: "model/gltf-binary", upsert: true,
    });
    if (upErr) {
      await admin.from("prototypes").update({ mesh_status: "failed", mesh_error: upErr.message }).eq("id", prototype_id);
      return json({ error: `Upload failed: ${upErr.message}` }, 500);
    }
    const publicUrl = admin.storage.from("concept-renders").getPublicUrl(path).data.publicUrl;
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    await admin
      .from("prototypes")
      .update({ mesh_status: "ready", mesh_error: null, glb_url: bustedUrl })
      .eq("id", prototype_id);

    // Reload to get title + first render for the library entry.
    const { data: refreshed } = await admin
      .from("prototypes")
      .select("id, user_id, title, render_urls")
      .eq("id", prototype_id)
      .maybeSingle();
    const renders = (refreshed?.render_urls as Array<{ angle: string; url: string }>) ?? [];
    const thumb = renders[0]?.url ?? result.thumbnail_url ?? null;

    // Auto-add to library (idempotent: don't duplicate if there's already
    // an entry for this prototype).
    const { data: existingLib } = await admin
      .from("library_items")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", "prototype_part_mesh")
      .contains("metadata", { prototype_id })
      .maybeSingle();
    if (!existingLib) {
      await admin.from("library_items").insert({
        user_id: userId,
        kind: "prototype_part_mesh",
        title: refreshed?.title ?? "Prototype",
        asset_url: bustedUrl,
        asset_mime: "model/gltf-binary",
        thumbnail_url: thumb,
        visibility: "private",
        metadata: { prototype_id, source: "meshy_image_to_3d" },
      });
    } else {
      await admin.from("library_items").update({
        asset_url: bustedUrl,
        thumbnail_url: thumb,
        title: refreshed?.title ?? "Prototype",
      }).eq("id", existingLib.id);
    }

    return json({ status: "SUCCEEDED", progress: 100, glb_url: bustedUrl });
  } catch (e) {
    console.error("meshify-prototype error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
