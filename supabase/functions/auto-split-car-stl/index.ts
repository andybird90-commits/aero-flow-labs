/**
 * auto-split-car-stl
 *
 * Admin-only. One-click splits a repaired hero-car STL into named panels
 * (hood, doors, bumpers, fenders, wheels, etc.) using dihedral-crease
 * segmentation + bbox-based slot classification.
 *
 * For each detected panel:
 *   - the panel mesh is uploaded to car-stls/<id>/panels/<slot>.stl
 *   - a row is inserted into car_panels with confidence + bbox + boundary
 *     centroid (which doubles as a hardpoint anchor at the mating surface).
 *
 * Body: { car_stl_id: string, threshold_deg?: number }
 *
 * Refuses gracefully when the splitter finds < 4 components: the input
 * doesn't have detectable shut lines, no panels are written, and the
 * frontend surfaces a "use as non-splittable base" message.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseStl, writeBinaryStl, type Mesh } from "../_shared/stl-io.ts";
import {
  splitByCreases,
  extractComponentMesh,
} from "../_shared/stl-split-by-creases.ts";
import {
  classifyPanels,
  canonicalisePositions,
} from "../_shared/classify-car-panels.ts";

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

const MIN_USEFUL_COMPONENTS = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      car_stl_id?: string;
      threshold_deg?: number;
    };
    if (!body.car_stl_id) return json({ error: "car_stl_id required" }, 400);
    const thresholdDeg = clamp(body.threshold_deg ?? 45, 15, 80);

    // --- Auth + admin check ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
      _user_id: userRes.user.id,
      _role: "admin",
    });
    if (roleErr) return json({ error: roleErr.message }, 500);
    if (!isAdmin) return json({ error: "Admin role required" }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Load car_stl row ---
    const { data: row, error: rowErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("id", body.car_stl_id)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: "car_stls row not found" }, 404);

    const sourcePath = row.repaired_stl_path ?? row.stl_path;
    if (!sourcePath) return json({ error: "No mesh path on row" }, 400);
    if (!row.repaired_stl_path) {
      return json({
        ok: false,
        reason: "needs_repair",
        message: "Run the repair pass before auto-splitting.",
      }, 400);
    }

    // --- Download mesh ---
    const { data: file, error: dlErr } = await admin.storage
      .from("car-stls")
      .download(sourcePath);
    if (dlErr || !file) {
      return json({ error: `Download failed: ${dlErr?.message ?? "unknown"}` }, 500);
    }
    const inputBytes = new Uint8Array(await file.arrayBuffer());
    if (inputBytes.length === 0) return json({ error: "Empty mesh file" }, 400);

    // --- Parse + canonicalise ---
    const mesh = parseStl(inputBytes);
    if (mesh.indices.length === 0) {
      return json({ error: "Mesh has zero triangles" }, 400);
    }
    canonicalisePositions(mesh.positions, row.forward_axis ?? "-z");

    // --- Split ---
    const split = splitByCreases(mesh, {
      thresholdDeg,
      minTriangles: 200,
      minAreaFraction: 0.005,
      // Repaired STLs are in millimetres in this project.
      unitsAreMillimetres: true,
      weldEpsilon: 0.05,
    });

    if (split.components.length < MIN_USEFUL_COMPONENTS) {
      return json({
        ok: false,
        reason: "no_shut_lines_detected",
        components_found: split.components.length,
        sharp_edges: split.sharpEdgeCount,
        message:
          "This mesh doesn't have detectable panel seams (likely heavily smoothed or single-blob scan). The car still works as a non-splittable base.",
      }, 200);
    }

    // --- Classify ---
    const { assignments } = classifyPanels(split.components);

    // --- Wipe any prior panels for this car_stl ---
    const { error: delErr } = await admin
      .from("car_panels")
      .delete()
      .eq("car_stl_id", row.id);
    if (delErr) return json({ error: `Cleanup failed: ${delErr.message}` }, 500);

    // Also remove any panel STL files under this car_stl's panel folder.
    const panelsPrefix = panelStorageFolder(row.id);
    try {
      const { data: existing } = await admin.storage.from("car-stls").list(panelsPrefix);
      if (existing && existing.length > 0) {
        const paths = existing.map((f) => `${panelsPrefix}/${f.name}`);
        await admin.storage.from("car-stls").remove(paths);
      }
    } catch {
      // best-effort cleanup
    }

    // --- Upload each panel + insert rows ---
    const slotCounters = new Map<string, number>();
    const insertRows: Array<{
      car_stl_id: string;
      slot: string;
      confidence: number;
      stl_path: string;
      triangle_count: number;
      area_m2: number;
      bbox: unknown;
    }> = [];

    let successCount = 0;
    let unknownCount = 0;
    const summary: Array<{
      slot: string;
      confidence: number;
      triangle_count: number;
      area_m2: number;
      reason: string;
    }> = [];

    for (const a of assignments) {
      const comp = split.components[a.componentIndex];
      const baseSlot = a.slot === "unknown" && a.unknownIndex
        ? `unknown_${a.unknownIndex}`
        : a.slot;
      // Disambiguate duplicates (e.g. extra hoods that survived classification).
      const n = (slotCounters.get(baseSlot) ?? 0) + 1;
      slotCounters.set(baseSlot, n);
      const slotName = n === 1 ? baseSlot : `${baseSlot}_${n}`;

      const compMesh = extractComponentMesh(split.weldedMesh, comp.triangleIndices);
      const stlBytes = writeBinaryStl(compMesh);
      const stlPath = `${panelsPrefix}/${slotName}.stl`;

      const { error: upErr } = await admin.storage
        .from("car-stls")
        .upload(stlPath, stlBytes, { contentType: "model/stl", upsert: true });
      if (upErr) {
        // Skip but don't abort the whole operation.
        summary.push({
          slot: slotName,
          confidence: a.confidence,
          triangle_count: comp.triangleCount,
          area_m2: comp.areaM2,
          reason: `Upload failed: ${upErr.message}`,
        });
        continue;
      }

      insertRows.push({
        car_stl_id: row.id,
        slot: slotName,
        confidence: a.confidence,
        stl_path: stlPath,
        triangle_count: comp.triangleCount,
        area_m2: comp.areaM2,
        bbox: {
          min: comp.bbox.min,
          max: comp.bbox.max,
          centroid: comp.centroid,
          avg_normal: comp.avgNormal,
          boundary_centroid: comp.boundaryCentroid,
          boundary_vertex_count: comp.boundaryVerts.length,
        },
      });
      summary.push({
        slot: slotName,
        confidence: a.confidence,
        triangle_count: comp.triangleCount,
        area_m2: comp.areaM2,
        reason: a.reason,
      });
      if (a.slot === "unknown") unknownCount++;
      else successCount++;
    }

    if (insertRows.length > 0) {
      const { error: insErr } = await admin.from("car_panels").insert(insertRows);
      if (insErr) return json({ error: `Insert failed: ${insErr.message}` }, 500);
    }

    return json({
      ok: true,
      total_panels: insertRows.length,
      named_panels: successCount,
      unknown_panels: unknownCount,
      sharp_edges: split.sharpEdgeCount,
      total_triangles: split.totalTriangles,
      threshold_deg: thresholdDeg,
      summary,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function panelStorageFolder(carStlId: string): string {
  return `panels/${carStlId}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
