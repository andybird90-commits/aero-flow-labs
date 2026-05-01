/**
 * autofit-placed-part  (legacy filename: bake-bodykit-from-shell)
 *
 * Receives the donor car GLB and a positioned part GLB as multipart/form-data
 * directly from the client (the part has already been transformed into the
 * car's world frame in the browser via GLTFExporter), forwards both to the
 * FastAPI mesh-fitting server's `POST /autofit` endpoint as multipart, then
 * stores the fitted GLB and persists its signed URL onto
 * `placed_parts.metadata.autofit_glb_url`.
 *
 * Worker contract:
 *   POST /autofit   multipart/form-data
 *     car:       file (model/gltf-binary)
 *     part:      file (model/gltf-binary)
 *     part_kind: string
 *   -> { result_url, processing_ms }
 *
 * Edge function request body (multipart):
 *   placed_part_id: string
 *   part_kind:      "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser"
 *   car:            file (GLB bytes)
 *   part:           file (GLB bytes — already in car-world coordinates)
 *
 * Response:
 *   { ok, placed_part_id, result_url, processing_ms }
 *
 * Because the part is sent already positioned, the worker's result is also
 * in car-world coordinates. The placed_parts row is reset to identity transform
 * and metadata.autofit_glb_url is rendered as-is by the viewport.
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
    if (!MESH_API_URL) {
      return json({ error: "Mesh API not configured. Set MESH_API_URL secret." }, 503);
    }

    // --- Parse multipart form ---
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      return json({ error: `Expected multipart/form-data: ${(e as Error).message}` }, 400);
    }

    const placedPartId = form.get("placed_part_id");
    const partKind = form.get("part_kind");
    const carFile = form.get("car");
    const partFile = form.get("part");

    if (typeof placedPartId !== "string" || !placedPartId) {
      return json({ error: "placed_part_id required" }, 400);
    }
    if (typeof partKind !== "string" || !ALLOWED_PARTS.has(partKind)) {
      return json({ error: `part_kind must be one of: ${[...ALLOWED_PARTS].join(", ")}` }, 400);
    }
    if (!(carFile instanceof File) || carFile.size === 0) {
      return json({ error: "car GLB file required (multipart field 'car')" }, 400);
    }
    if (!(partFile instanceof File) || partFile.size === 0) {
      return json({ error: "part GLB file required (multipart field 'part')" }, 400);
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

    // --- Verify ownership of the placed part ---
    const { data: placed, error: placedErr } = await admin
      .from("placed_parts")
      .select("id, user_id, project_id, metadata, position, rotation, scale")
      .eq("id", placedPartId)
      .maybeSingle();
    if (placedErr) return json({ error: placedErr.message }, 500);
    if (!placed) return json({ error: "placed_parts row not found" }, 404);
    if ((placed as any).user_id !== userId) return json({ error: "Forbidden" }, 403);

    // --- Forward to FastAPI /autofit as multipart ---
    const workerForm = new FormData();
    workerForm.append("car", carFile, "car.glb");
    workerForm.append("part", partFile, "part.glb");
    workerForm.append("part_kind", partKind);

    let workerJson: { result_url?: string; processing_ms?: number; error?: string; detail?: string };
    let workerStatus = 0;
    try {
      const resp = await fetch(`${MESH_API_URL.replace(/\/$/, "")}/autofit`, {
        method: "POST",
        body: workerForm,
      });
      workerStatus = resp.status;
      const text = await resp.text();
      try {
        workerJson = JSON.parse(text);
      } catch {
        throw new Error(`Worker returned non-JSON (${resp.status}): ${text.slice(0, 300)}`);
      }
      if (!resp.ok) {
        const detail = workerJson?.detail ?? workerJson?.error ?? text.slice(0, 200);
        throw new Error(`Worker ${resp.status}: ${detail}`);
      }
    } catch (e) {
      const msg = `Autofit call failed: ${(e as Error).message}`.slice(0, 1000);
      return json({ error: msg }, workerStatus >= 400 && workerStatus < 600 ? workerStatus : 502);
    }

    if (!workerJson.result_url) {
      return json({ error: "Worker returned no result_url." }, 502);
    }

    // --- Re-host fitted GLB into geometries bucket ---
    let storedUrl: string;
    try {
      const fetched = await fetch(workerJson.result_url);
      if (!fetched.ok) throw new Error(`Download result_url failed: ${fetched.status}`);
      const bytes = new Uint8Array(await fetched.arrayBuffer());
      const path = `${userId}/autofit/${placedPartId}/${partKind}-${Date.now()}.glb`;
      const { error: upErr } = await admin.storage
        .from("geometries")
        .upload(path, bytes, { contentType: "model/gltf-binary", upsert: true });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: signed } = await admin.storage
        .from("geometries")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      storedUrl = signed?.signedUrl ?? workerJson.result_url;
    } catch (e) {
      return json({ error: `Re-host failed: ${(e as Error).message}`.slice(0, 1000) }, 500);
    }

    // --- Persist override on the placed part ---
    // The part was sent already positioned in car-world coordinates, so the
    // worker's GLB is also in car-world. Reset the placed transform to identity
    // and let the viewport render the fitted GLB as-is.
    const prevMeta = ((placed as any).metadata ?? {}) as Record<string, unknown>;
    const nextMeta = {
      ...prevMeta,
      autofit_glb_url: storedUrl,
      autofit_part_kind: partKind,
      autofit_processing_ms: workerJson.processing_ms ?? null,
      autofit_at: new Date().toISOString(),
      autofit_frame: "car-world",
      autofit_original_transform: {
        position: (placed as any).position,
        rotation: (placed as any).rotation,
        scale: (placed as any).scale,
      },
    };
    const { error: updErr } = await admin
      .from("placed_parts")
      .update({
        metadata: nextMeta,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      })
      .eq("id", placedPartId);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({
      ok: true,
      placed_part_id: placedPartId,
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
