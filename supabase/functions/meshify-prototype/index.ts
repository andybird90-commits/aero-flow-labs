/**
 * meshify-prototype
 *
 * Prototyper meshing step. Takes the cached front/back render URLs from a
 * prototype row and runs Hyper3D Rodin via Replicate to produce a GLB.
 *
 * Two actions:
 *   action: "start"  → kicks off Rodin, stores task_id on the prototype.
 *   action: "status" → polls Replicate. On success: downloads GLB, re-hosts in
 *                      our bucket, writes glb_url, AND auto-creates a
 *                      library_items row (prototype_part_mesh) so the part
 *                      shows up in the Library with a Prototype badge.
 *
 * Body: { action, prototype_id }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RODIN_MODEL = "hyper3d/rodin";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    if (!REPLICATE_API_TOKEN) return json({ error: "REPLICATE_API_TOKEN not configured" }, 500);

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
      const renders = ((proto.render_urls as Array<{ angle: string; url: string }>) ?? []).map((r) => r.url);
      if (!renders.length) return json({ error: "No renders yet — run render-prototype-views first" }, 400);

      const createResp = await fetch(`https://api.replicate.com/v1/models/${RODIN_MODEL}/predictions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: {
            images: renders,
            prompt:
              `A standalone aftermarket automotive part, clean smooth surfaces, matte clay render, flat panels, sharp edges, no surface noise, thin-walled composite shell construction, ~2mm wall thickness, preserve real part depth and section, preserve reverse / inner side from the reference views, open-backed where appropriate, visible edge thickness, no bolt holes, no fasteners, no mounting tabs, no flanges, no brackets — bonded or bolted on after printing, never a solid block, never a paper-thin ribbon`,
          },
        }),
      });
      if (!createResp.ok) {
        const t = await createResp.text();
        await admin.from("prototypes").update({ mesh_status: "failed", mesh_error: `Rodin ${createResp.status}` }).eq("id", prototype_id);
        return json({ error: `Rodin ${createResp.status}: ${t.slice(0, 300)}` }, 500);
      }
      const pred = await createResp.json();
      const taskId: string | undefined = pred.id;
      if (!taskId) return json({ error: "Rodin returned no prediction id" }, 500);

      await admin.from("prototypes").update({ mesh_status: "meshing", mesh_task_id: taskId, mesh_error: null }).eq("id", prototype_id);
      return json({ task_id: taskId, status: "IN_PROGRESS", progress: 0 });
    }

    // STATUS
    const taskId = (proto.mesh_task_id as string | null) ?? null;
    if (!taskId) return json({ error: "No active mesh task — start one first" }, 400);

    const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${taskId}`, {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    });
    if (!pollResp.ok) {
      const t = await pollResp.text();
      return json({ error: `Rodin poll ${pollResp.status}: ${t.slice(0, 200)}` }, 500);
    }
    const pred = await pollResp.json();
    const status: string = pred.status;

    if (status === "failed" || status === "canceled") {
      const msg = String(pred.error ?? `Rodin ${status}`).slice(0, 500);
      await admin.from("prototypes").update({ mesh_status: "failed", mesh_error: msg }).eq("id", prototype_id);
      return json({ status: "FAILED", error: msg });
    }
    if (status !== "succeeded") {
      const fakeProgress = status === "processing" ? 60 : status === "starting" ? 15 : 30;
      return json({ status: "IN_PROGRESS", progress: fakeProgress });
    }

    const out = pred.output;
    const glbUrl: string | undefined =
      typeof out === "string" ? out :
      Array.isArray(out) ? (out.find((u: string) => typeof u === "string" && u.endsWith(".glb")) ?? out[0]) :
      undefined;
    if (!glbUrl) return json({ error: "Rodin returned no GLB" }, 500);

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
    const thumb = renders[0]?.url ?? null;

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
        metadata: { prototype_id },
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