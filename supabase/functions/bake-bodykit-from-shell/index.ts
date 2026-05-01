/**
 * bake-bodykit-from-shell  (a.k.a. "Autofit")
 *
 * Calls the FastAPI mesh-fitting server (`POST /autofit`) to fit a single
 * part (wing / bumper / spoiler / lip / skirt / diffuser) against a donor
 * car GLB. Synchronous — should complete in ~5–30s.
 *
 * Request body:
 *   {
 *     body_kit_id: string,       // existing body_kits row to update
 *     part_kind: "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser",
 *     width_mm: number,
 *     height_mm: number,
 *     depth_mm: number
 *   }
 *
 * Flow:
 *   1. Resolve donor car GLB public URL (car-stls bucket is public).
 *   2. POST to ${MESH_API_URL}/autofit with car_url + part dims.
 *   3. Download the result_url returned by the worker.
 *   4. Re-host the GLB into the `geometries` bucket (signed URL, 7 days).
 *   5. Update body_kits row to status=ready with combined_glb_url.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
const MESH_API_URL = Deno.env.get("MESH_API_URL");

const ALLOWED_PARTS = new Set([
  "wing", "bumper", "spoiler", "lip", "skirt", "diffuser",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      body_kit_id?: string;
      part_kind?: string;
      width_mm?: number;
      height_mm?: number;
      depth_mm?: number;
    };

    if (!body.body_kit_id) return json({ error: "body_kit_id required" }, 400);
    if (!body.part_kind || !ALLOWED_PARTS.has(body.part_kind)) {
      return json({ error: `part_kind must be one of: ${[...ALLOWED_PARTS].join(", ")}` }, 400);
    }
    const w = Number(body.width_mm), h = Number(body.height_mm), d = Number(body.depth_mm);
    if (![w, h, d].every((n) => Number.isFinite(n) && n > 0 && n < 5000)) {
      return json({ error: "width_mm/height_mm/depth_mm must be positive numbers under 5000" }, 400);
    }

    if (!MESH_API_URL) {
      return json({ error: "Mesh API not configured. Set MESH_API_URL secret." }, 503);
    }

    // --- Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Verify ownership ---
    const { data: kitData, error: kitErr } = await admin
      .from("body_kits")
      .select("id, user_id, donor_car_template_id")
      .eq("id", body.body_kit_id)
      .maybeSingle();
    if (kitErr) return json({ error: kitErr.message }, 500);
    if (!kitData) return json({ error: "body_kits row not found" }, 404);
    if ((kitData as any).user_id !== userId) return json({ error: "Forbidden" }, 403);
    const donorId = (kitData as any).donor_car_template_id as string | null;
    if (!donorId) return json({ error: "No donor car template attached to this kit." }, 400);

    // --- Resolve donor car GLB public URL ---
    const { data: carStl, error: carErr } = await admin
      .from("car_stls")
      .select("glb_path, repaired_stl_path, stl_path")
      .eq("car_template_id", donorId)
      .maybeSingle();
    if (carErr) return json({ error: `Donor lookup failed: ${carErr.message}` }, 500);
    if (!carStl) return json({ error: "Donor car has no STL/GLB configured." }, 400);
    const donorPath = (carStl as any).glb_path
      ?? (carStl as any).repaired_stl_path
      ?? (carStl as any).stl_path;
    if (!donorPath) return json({ error: "Donor car file path missing." }, 400);
    const carUrl = publicUrl(admin, "car-stls", donorPath);

    // Flip to baking so the UI shows progress.
    await admin.from("body_kits")
      .update({ status: "baking", error: null })
      .eq("id", body.body_kit_id);

    // --- Call FastAPI /autofit ---
    let workerJson: { result_url?: string; processing_ms?: number; error?: string };
    try {
      const resp = await fetch(`${MESH_API_URL.replace(/\/$/, "")}/autofit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_url: carUrl,
          part_kind: body.part_kind,
          width_mm: w,
          height_mm: h,
          depth_mm: d,
        }),
      });
      const text = await resp.text();
      try {
        workerJson = JSON.parse(text);
      } catch {
        throw new Error(`Worker returned non-JSON (${resp.status}): ${text.slice(0, 300)}`);
      }
      if (!resp.ok) {
        throw new Error(workerJson?.error ?? `Worker ${resp.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      const msg = `Autofit call failed: ${(e as Error).message}`.slice(0, 1000);
      await admin.from("body_kits").update({ status: "failed", error: msg }).eq("id", body.body_kit_id);
      return json({ error: msg }, 502);
    }

    if (!workerJson.result_url) {
      const msg = "Worker returned no result_url.";
      await admin.from("body_kits").update({ status: "failed", error: msg }).eq("id", body.body_kit_id);
      return json({ error: msg }, 502);
    }

    // --- Re-host GLB into geometries bucket ---
    let storedUrl: string;
    let triCount: number | null = null;
    try {
      const fetched = await fetch(workerJson.result_url);
      if (!fetched.ok) throw new Error(`Download result_url failed: ${fetched.status}`);
      const bytes = new Uint8Array(await fetched.arrayBuffer());
      const path = `${userId}/autofit/${body.body_kit_id}/${body.part_kind}-${Date.now()}.glb`;
      const { error: upErr } = await admin.storage
        .from("geometries")
        .upload(path, bytes, { contentType: "model/gltf-binary", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: signed } = await admin.storage
        .from("geometries")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      storedUrl = signed?.signedUrl ?? workerJson.result_url;
    } catch (e) {
      const msg = `Re-host failed: ${(e as Error).message}`.slice(0, 1000);
      await admin.from("body_kits").update({ status: "failed", error: msg }).eq("id", body.body_kit_id);
      return json({ error: msg }, 500);
    }

    // --- Mark kit ready ---
    const { error: updErr } = await admin.from("body_kits").update({
      status: "ready",
      combined_glb_url: storedUrl,
      panel_count: 1,
      triangle_count: triCount,
      error: null,
      ai_notes: workerJson.processing_ms != null
        ? `Autofit ${body.part_kind} in ${workerJson.processing_ms} ms`
        : `Autofit ${body.part_kind}`,
    }).eq("id", body.body_kit_id);
    if (updErr) return json({ error: updErr.message }, 500);

    // Replace any prior parts row with the new single fitted part.
    await admin.from("body_kit_parts").delete().eq("body_kit_id", body.body_kit_id);
    await admin.from("body_kit_parts").insert({
      body_kit_id: body.body_kit_id,
      user_id: userId,
      slot: body.part_kind,
      label: body.part_kind,
      confidence: 1,
      stl_path: storedUrl,
      glb_url: storedUrl,
      triangle_count: 0,
      area_m2: 0,
      bbox: { dims_mm: { w, h, d } },
    });

    return json({
      ok: true,
      status: "ready",
      body_kit_id: body.body_kit_id,
      result_url: storedUrl,
      processing_ms: workerJson.processing_ms ?? null,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function publicUrl(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  pathOrUrl: string,
): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return admin.storage.from(bucket).getPublicUrl(pathOrUrl).data.publicUrl;
}
