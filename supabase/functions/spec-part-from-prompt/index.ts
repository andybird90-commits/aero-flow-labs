/**
 * spec-part-from-prompt
 *
 * User-facing edge function that turns a text description (and optional
 * reference image) into a 3D spec part saved into the user's part library.
 *
 * Flow:
 *   1. If no reference image is provided, generate one with Lovable AI
 *      (gemini image preview) so Meshy has something to work from.
 *   2. Kick off a Meshy 6 image-to-3d task tuned for a printable spec part
 *      (solid shell, watertight, moderate polycount).
 *   3. Poll until SUCCEEDED, download the GLB, re-host it in the
 *      `library-uploads` bucket under the user's folder.
 *   4. Insert a `library_items` row (kind = uploaded_part_mesh) so it
 *      shows up immediately in the Part Library rail.
 *
 * Two actions:
 *   "start"  → { prompt, image_data_url? }      → { generation_id }
 *   "status" → { generation_id }                → { status, library_item_id?, error? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createImageTo3dTask, getImageTo3dTask } from "../_shared/meshy.ts";
import { lovableGenerateImage } from "../_shared/lovable-image.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Decode a data URL → Uint8Array + mime. */
function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

async function uploadImageToBucket(
  admin: ReturnType<typeof createClient>,
  userId: string,
  dataUrl: string,
): Promise<string> {
  const { bytes, mime } = decodeDataUrl(dataUrl);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/spec-refs/${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from("library-uploads")
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`Reference upload failed: ${error.message}`);
  const { data } = admin.storage.from("library-uploads").getPublicUrl(path);
  return data.publicUrl;
}

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

    const body = await req.json() as {
      action?: "start" | "status";
      generation_id?: string;
      prompt?: string;
      image_data_url?: string | null;
    };
    const action = body.action ?? "start";

    if (action === "start") {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return json({ error: "prompt required" }, 400);

      // Build a "spec part" friendly prompt — encourages a solid printable shell.
      const enriched =
        `${prompt}\n\nIndustrial spec part. Single solid object, watertight mesh, ` +
        `clean engineering surfaces, ~3mm wall thickness, neutral matte material, ` +
        `studio lighting, plain white background, centered isometric 3/4 view.`;

      // 1. Reference image — provided or generated.
      let refImageUrl: string;
      if (body.image_data_url) {
        // If it's already an http(s) URL, use as-is; else upload data URL.
        if (/^https?:\/\//i.test(body.image_data_url)) {
          refImageUrl = body.image_data_url;
        } else {
          refImageUrl = await uploadImageToBucket(admin, userId, body.image_data_url);
        }
      } else {
        if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);
        const img = await lovableGenerateImage({
          apiKey: LOVABLE_API_KEY,
          prompt: enriched,
        });
        if (!img.ok || !img.dataUrl) {
          return json({ error: `Reference image generation failed: ${img.error ?? "unknown"}` }, 502);
        }
        refImageUrl = await uploadImageToBucket(admin, userId, img.dataUrl);
      }

      // 2. Insert tracking row.
      const { data: gen, error: insErr } = await admin
        .from("meshy_generations")
        .insert({
          user_id: userId,
          generation_type: "part",
          prompt,
          reference_image_urls: [refImageUrl],
          parameters: { source: "spec_part_from_prompt", ai_model: "latest" },
          status: "queued",
        })
        .select("*")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      // 3. Kick off Meshy.
      try {
        const { task_id } = await createImageTo3dTask({
          image_url: refImageUrl,
          ai_model: "latest",
          enable_pbr: true,
          should_remesh: true,
          target_polycount: 30000,
          symmetry_mode: "auto",
          remove_lighting: true,
          target_formats: ["glb", "stl"],
        });
        await admin.from("meshy_generations")
          .update({ meshy_task_id: task_id, status: "running" })
          .eq("id", gen.id);
        return json({ generation_id: gen.id, status: "running", reference_url: refImageUrl });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Meshy create failed";
        await admin.from("meshy_generations")
          .update({ status: "failed", error: msg.slice(0, 500) })
          .eq("id", gen.id);
        return json({ error: msg, generation_id: gen.id }, 500);
      }
    }

    // STATUS — also handles promotion to the user's library on first success.
    const generation_id = body.generation_id;
    if (!generation_id) return json({ error: "generation_id required" }, 400);

    const { data: gen } = await admin
      .from("meshy_generations")
      .select("*")
      .eq("id", generation_id)
      .maybeSingle();
    if (!gen) return json({ error: "Generation not found" }, 404);
    if (gen.user_id !== userId) return json({ error: "Forbidden" }, 403);

    if (gen.status === "complete") {
      return json({
        status: "complete",
        library_item_id: gen.saved_library_item_id,
        glb_url: gen.output_glb_url,
        preview_url: gen.preview_url,
      });
    }
    if (!gen.meshy_task_id) return json({ error: "No meshy task on this generation" }, 400);

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

    // Re-host the GLB in our bucket (Meshy URLs expire).
    const glbResp = await fetch(result.glb_url);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());
    const path = `${userId}/parts/${generation_id}-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage
      .from("library-uploads")
      .upload(path, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const publicUrl = admin.storage.from("library-uploads").getPublicUrl(path).data.publicUrl;

    // Optionally re-host the preview thumb so it survives Meshy URL expiry.
    let thumbUrl: string | null = result.thumbnail_url;
    if (thumbUrl) {
      try {
        const tResp = await fetch(thumbUrl);
        if (tResp.ok) {
          const tBytes = new Uint8Array(await tResp.arrayBuffer());
          const tMime = tResp.headers.get("content-type") ?? "image/png";
          const tExt = tMime.includes("jpeg") || tMime.includes("jpg") ? "jpg" : "png";
          const tPath = `${userId}/parts/${generation_id}-thumb-${Date.now()}.${tExt}`;
          const { error: tErr } = await admin.storage
            .from("library-uploads")
            .upload(tPath, tBytes, { contentType: tMime, upsert: true });
          if (!tErr) {
            thumbUrl = admin.storage.from("library-uploads").getPublicUrl(tPath).data.publicUrl;
          }
        }
      } catch (_) { /* keep original meshy thumb */ }
    }

    // Insert library item.
    const titleBase = (gen.prompt as string).trim().slice(0, 80) || "Spec part";
    const { data: lib, error: libErr } = await admin
      .from("library_items")
      .insert({
        user_id: userId,
        kind: "uploaded_part_mesh",
        title: titleBase,
        asset_url: publicUrl,
        asset_mime: "model/gltf-binary",
        thumbnail_url: thumbUrl,
        visibility: "private",
        metadata: {
          source: "spec_part_from_prompt",
          meshy_generation_id: generation_id,
          prompt: gen.prompt,
          reference_image_urls: gen.reference_image_urls,
        },
      })
      .select("*")
      .single();
    if (libErr) return json({ error: `Library insert failed: ${libErr.message}` }, 500);

    await admin.from("meshy_generations").update({
      status: "complete",
      output_glb_url: publicUrl,
      preview_url: thumbUrl,
      saved_library_item_id: lib.id,
      error: null,
    }).eq("id", generation_id);

    return json({
      status: "complete",
      library_item_id: lib.id,
      glb_url: publicUrl,
      preview_url: thumbUrl,
    });
  } catch (e) {
    console.error("spec-part-from-prompt error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
