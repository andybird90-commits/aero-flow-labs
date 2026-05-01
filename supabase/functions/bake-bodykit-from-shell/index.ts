/**
 * autofit-placed-part  (legacy filename: bake-bodykit-from-shell)
 *
 * Calls the FastAPI mesh-fitting server (`POST /autofit`) to deform an
 * existing part GLB so it fits the donor car. Synchronous — should
 * complete in a few seconds.
 *
 * Worker contract:
 *   POST /autofit  { car_url, part_url, part_kind } -> { result_url, processing_ms }
 *
 * Request body to this edge function:
 *   {
 *     placed_part_id: string,   // placed_parts row to update
 *     part_kind: "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser"
 *   }
 *
 * Flow:
 *   1. Load placed_part → project → car_template_id → car_stls.glb_path  (car_url)
 *   2. Load placed_part.library_item_id → library_items.asset_url        (part_url)
 *   3. POST { car_url, part_url, part_kind } to ${MESH_API_URL}/autofit
 *   4. Download result_url, re-host into `geometries` bucket, signed 7d
 *   5. Save the signed url to placed_parts.metadata.autofit_glb_url so the
 *      viewport renders the fitted part instead of the original library asset.
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
      placed_part_id?: string;
      part_kind?: string;
    };

    if (!body.placed_part_id) return json({ error: "placed_part_id required" }, 400);
    if (!body.part_kind || !ALLOWED_PARTS.has(body.part_kind)) {
      return json({ error: `part_kind must be one of: ${[...ALLOWED_PARTS].join(", ")}` }, 400);
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

    // --- Load placed part + verify ownership ---
    const { data: placed, error: placedErr } = await admin
      .from("placed_parts")
      .select("id, user_id, project_id, library_item_id, metadata, position, rotation, scale")
      .eq("id", body.placed_part_id)
      .maybeSingle();
    if (placedErr) return json({ error: placedErr.message }, 500);
    if (!placed) return json({ error: "placed_parts row not found" }, 404);
    if ((placed as any).user_id !== userId) return json({ error: "Forbidden" }, 403);
    const libraryItemId = (placed as any).library_item_id as string | null;
    if (!libraryItemId) {
      return json({ error: "Placed part has no library item — nothing to autofit." }, 400);
    }

    // --- Resolve part GLB URL ---
    const { data: item, error: itemErr } = await admin
      .from("library_items")
      .select("asset_url, asset_mime")
      .eq("id", libraryItemId)
      .maybeSingle();
    if (itemErr) return json({ error: `Library lookup failed: ${itemErr.message}` }, 500);
    if (!item?.asset_url) return json({ error: "Library item has no asset_url." }, 400);
    const partMime = ((item as any).asset_mime ?? "").toString().toLowerCase();
    const partUrlLower = (item as any).asset_url.toString().toLowerCase().split("?")[0];
    const isGlb = partMime.includes("gltf") || partMime.includes("glb")
      || partUrlLower.endsWith(".glb") || partUrlLower.endsWith(".gltf");
    if (!isGlb) {
      return json({ error: "Autofit requires a GLB part. This library item isn't a GLB." }, 400);
    }
    const partUrl = (item as any).asset_url as string;

    // --- Resolve donor car GLB URL via project → car → template → car_stls ---
    const { data: project, error: projErr } = await admin
      .from("projects")
      .select("id, car_id")
      .eq("id", (placed as any).project_id)
      .maybeSingle();
    if (projErr) return json({ error: `Project lookup failed: ${projErr.message}` }, 500);
    if (!project) return json({ error: "Project not found." }, 404);

    const { data: car, error: carErr } = await admin
      .from("cars")
      .select("id, template_id")
      .eq("id", (project as any).car_id)
      .maybeSingle();
    if (carErr) return json({ error: `Car lookup failed: ${carErr.message}` }, 500);
    const templateId = (car as any)?.template_id as string | null;
    if (!templateId) return json({ error: "Project car has no template — pick a donor car first." }, 400);

    const { data: carStl, error: stlErr } = await admin
      .from("car_stls")
      .select("glb_path")
      .eq("car_template_id", templateId)
      .maybeSingle();
    if (stlErr) return json({ error: `Donor lookup failed: ${stlErr.message}` }, 500);
    if (!carStl?.glb_path) {
      return json({
        error: "Donor car has no GLB available. Upload a GLB for it in Admin → Car STLs.",
      }, 400);
    }
    const carUrl = admin.storage.from("car-stls").getPublicUrl((carStl as any).glb_path).data.publicUrl;

    // --- Call FastAPI /autofit ---
    let workerJson: { result_url?: string; processing_ms?: number; error?: string; detail?: string };
    let workerStatus = 0;
    try {
      const resp = await fetch(`${MESH_API_URL.replace(/\/$/, "")}/autofit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_url: carUrl,
          part_url: partUrl,
          part_kind: body.part_kind,
        }),
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
      const path = `${userId}/autofit/${body.placed_part_id}/${body.part_kind}-${Date.now()}.glb`;
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
    // The worker returns a GLB baked in the car's world frame, so we reset
    // the placed part's transform to identity. The viewport renders the
    // autofit GLB as-is (see BuildStudioViewport + PartMesh).
    const prevMeta = ((placed as any).metadata ?? {}) as Record<string, unknown>;
    const nextMeta = {
      ...prevMeta,
      autofit_glb_url: storedUrl,
      autofit_part_kind: body.part_kind,
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
      .eq("id", body.placed_part_id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({
      ok: true,
      placed_part_id: body.placed_part_id,
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

