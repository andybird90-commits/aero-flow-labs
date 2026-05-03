/**
 * spec-part-from-prompt
 *
 * Two-phase flow:
 *   Phase 1 (reference): generate or accept a reference image, show it to the
 *                        user, accept revision comments, regenerate as needed.
 *   Phase 2 (mesh):      once the user approves the reference, kick off Meshy
 *                        image-to-3D, poll, then save into library_items.
 *
 * Actions:
 *   "generate_ref"  → { prompt, image_data_url? }
 *                     → { generation_id, reference_url }
 *   "revise_ref"    → { generation_id, comment }
 *                     → { reference_url }
 *   "approve"       → { generation_id }
 *                     → { status: "running" }   (kicks off Meshy)
 *   "status"        → { generation_id }
 *                     → { status, progress?, library_item_id?, glb_url?, preview_url? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createImageTo3dTask, getImageTo3dTask } from "../_shared/meshy.ts";
import { lovableGenerateImage } from "../_shared/lovable-image.ts";
import { perplexityResearch, formatResearchBlock } from "../_shared/perplexity.ts";

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
  folder = "spec-refs",
): Promise<string> {
  const { bytes, mime } = decodeDataUrl(dataUrl);
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const path = `${userId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await admin.storage
    .from("library-uploads")
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return admin.storage.from("library-uploads").getPublicUrl(path).data.publicUrl;
}

function enrichPrompt(prompt: string, comments?: string[], research?: string): string {
  const cleanComments = (comments ?? []).map((c) => c?.trim()).filter(Boolean) as string[];
  const revisionBlock = cleanComments.length
    ? `\n\n!!! HIGHEST PRIORITY — APPLY THESE REVISIONS TO THE REFERENCE IMAGE !!!\n` +
      cleanComments.map((c, i) => `${i + 1}. ${c}`).join("\n") +
      `\nThese revisions MUST be visibly reflected in the output. Keep the same part identity, just change what's described above.\n`
    : "";

  const base =
    `Subject: ${prompt}` +
    revisionBlock +
    `\n\nSTRICT ISOLATION RULES — render ONLY the requested part as a standalone ` +
    `aftermarket component, floating in empty space. ` +
    `ABSOLUTELY DO NOT include: any car body, fender, bumper, door, wheel, tire, ` +
    `chassis, headlight, window, mounting surface, ground, shadow plane, hands, ` +
    `mannequin, packaging, text, watermarks, or any other object. ` +
    `If the part normally attaches to a car, render JUST the part itself — ` +
    `nothing it bolts onto. Treat it like a product photo of a single SKU on a ` +
    `seamless white background.\n\n` +
    `Style: industrial spec part, single solid object, watertight mesh, clean ` +
    `engineering surfaces, ~3mm wall thickness, neutral matte grey material, ` +
    `soft studio lighting, pure white seamless background, centered isometric ` +
    `3/4 view, full part visible, no cropping.`;
  return research ? `${base}${research}` : base;
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
      action?: "generate_ref" | "revise_ref" | "approve" | "status" | "start";
      generation_id?: string;
      prompt?: string;
      comment?: string;
      image_data_url?: string | null;
    };
    const action = body.action ?? "generate_ref";

    // ── PHASE 1a: generate reference ──────────────────────────────
    if (action === "generate_ref" || action === "start") {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return json({ error: "prompt required" }, 400);

      if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

      // If user supplied an image, use it as a styling/identity reference but
      // still render a clean isolated spec image they can approve before mesh.
      let userRefUrl: string | undefined;
      if (body.image_data_url) {
        userRefUrl = /^https?:\/\//i.test(body.image_data_url)
          ? body.image_data_url
          : await uploadImageToBucket(admin, userId, body.image_data_url);
      }

      // Web-grounded research first — pulls real-world part naming / shapes
      // so e.g. "front splitter for porsche cayman 987" actually looks the part.
      const research = await perplexityResearch(
        `Automotive aero / body part: ${prompt}. Describe typical shape, ` +
        `proportions, mounting, materials and any well-known products that match.`,
      );
      const img = await lovableGenerateImage({
        apiKey: LOVABLE_API_KEY,
        prompt: enrichPrompt(prompt, undefined, formatResearchBlock(research)),
        referenceImages: userRefUrl ? [userRefUrl] : undefined,
      });
      if (!img.ok || !img.dataUrl) {
        return json({ error: `Reference generation failed: ${img.error ?? "unknown"}` }, 502);
      }
      const refImageUrl = await uploadImageToBucket(admin, userId, img.dataUrl);

      const { data: gen, error: insErr } = await admin
        .from("meshy_generations")
        .insert({
          user_id: userId,
          generation_type: "part",
          prompt,
          reference_image_urls: [refImageUrl],
          parameters: { source: "spec_part_from_prompt", phase: "awaiting_approval" },
          status: "queued",
        })
        .select("*")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);

      return json({ generation_id: gen.id, reference_url: refImageUrl, status: "awaiting_approval" });
    }

    // ── PHASE 1b: revise reference ────────────────────────────────
    if (action === "revise_ref") {
      if (!body.generation_id) return json({ error: "generation_id required" }, 400);
      const { data: gen } = await admin
        .from("meshy_generations").select("*").eq("id", body.generation_id).maybeSingle();
      if (!gen || gen.user_id !== userId) return json({ error: "Not found" }, 404);
      if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

      const prevRefs: string[] = Array.isArray(gen.reference_image_urls) ? gen.reference_image_urls : [];
      const lastRef = prevRefs[prevRefs.length - 1];
      const params = (gen.parameters && typeof gen.parameters === "object") ? gen.parameters as Record<string, unknown> : {};
      const prevComments: string[] = Array.isArray(params.revision_comments) ? params.revision_comments as string[] : [];
      const newComment = (body.comment ?? "").trim();
      const allComments = newComment ? [...prevComments, newComment] : prevComments;

      const img = await lovableGenerateImage({
        apiKey: LOVABLE_API_KEY,
        prompt: enrichPrompt(gen.prompt as string, allComments),
        referenceImages: lastRef ? [lastRef] : undefined,
      });
      if (!img.ok || !img.dataUrl) return json({ error: img.error ?? "Revision failed" }, 502);

      const newUrl = await uploadImageToBucket(admin, userId, img.dataUrl);
      await admin.from("meshy_generations")
        .update({
          reference_image_urls: [...prevRefs, newUrl],
          parameters: { ...params, revision_comments: allComments },
        })
        .eq("id", gen.id);
      return json({ reference_url: newUrl });
    }

    // ── PHASE 2: approve & kick off Meshy ─────────────────────────
    if (action === "approve") {
      if (!body.generation_id) return json({ error: "generation_id required" }, 400);
      const { data: gen } = await admin
        .from("meshy_generations").select("*").eq("id", body.generation_id).maybeSingle();
      if (!gen || gen.user_id !== userId) return json({ error: "Not found" }, 404);

      const refs: string[] = Array.isArray(gen.reference_image_urls) ? gen.reference_image_urls : [];
      const refUrl = refs[refs.length - 1];
      if (!refUrl) return json({ error: "No reference image" }, 400);

      try {
        const { task_id } = await createImageTo3dTask({
          image_url: refUrl,
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
        return json({ status: "running" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Meshy create failed";
        await admin.from("meshy_generations")
          .update({ status: "failed", error: msg.slice(0, 500) })
          .eq("id", gen.id);
        return json({ error: msg }, 500);
      }
    }

    // ── STATUS ────────────────────────────────────────────────────
    if (action !== "status") return json({ error: `Unknown action: ${action}` }, 400);

    const generation_id = body.generation_id;
    if (!generation_id) return json({ error: "generation_id required" }, 400);

    const { data: gen } = await admin
      .from("meshy_generations").select("*").eq("id", generation_id).maybeSingle();
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
    if (!gen.meshy_task_id) {
      return json({ status: gen.status === "failed" ? "failed" : "awaiting_approval", error: gen.error });
    }

    const result = await getImageTo3dTask(gen.meshy_task_id);
    if (result.status === "FAILED" || result.status === "CANCELED" || result.status === "EXPIRED") {
      const msg = (result.error || `Meshy ${result.status}`).slice(0, 500);
      await admin.from("meshy_generations").update({ status: "failed", error: msg }).eq("id", generation_id);
      return json({ status: "failed", error: msg });
    }
    if (result.status !== "SUCCEEDED") return json({ status: "running", progress: result.progress });
    if (!result.glb_url) {
      await admin.from("meshy_generations")
        .update({ status: "failed", error: "Meshy returned no GLB" }).eq("id", generation_id);
      return json({ status: "failed", error: "Meshy returned no GLB" });
    }

    // Re-host GLB
    const glbResp = await fetch(result.glb_url);
    if (!glbResp.ok) return json({ error: `Failed to fetch GLB: ${glbResp.status}` }, 500);
    const glbBytes = new Uint8Array(await glbResp.arrayBuffer());
    const glbPath = `${userId}/parts/${generation_id}-${Date.now()}.glb`;
    const { error: upErr } = await admin.storage
      .from("library-uploads")
      .upload(glbPath, glbBytes, { contentType: "model/gltf-binary", upsert: true });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);
    const publicUrl = admin.storage.from("library-uploads").getPublicUrl(glbPath).data.publicUrl;

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
          if (!tErr) thumbUrl = admin.storage.from("library-uploads").getPublicUrl(tPath).data.publicUrl;
        }
      } catch (_) { /* keep meshy thumb */ }
    }

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
