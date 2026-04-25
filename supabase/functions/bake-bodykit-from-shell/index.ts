/**
 * bake-bodykit-from-shell
 *
 * Worker for the bodykit pipeline. Picks up a queued `body_kits` row and:
 *   1. Downloads the donor car STL (`car_stls.repaired_stl_path` preferred).
 *   2. Downloads the body skin STL (`body_skins.file_url_stl` — signed url
 *      or storage path).
 *   3. Applies the baked transform (position/rotation/scale captured from
 *      the user's `shell_alignments` row at bake time) to the shell mesh.
 *   4. Subtracts the donor: keeps shell vertices that sit > TOLERANCE_MM
 *      from the donor surface (vertex-hash distance, identical heuristic
 *      to `subtract-aero-kit`). This isolates the "outboard" aero kit.
 *   5. Splits the resulting mesh into panels by dihedral crease angle and
 *      classifies each component (front_splitter, side_skirt, rear_wing…).
 *   6. Uploads the combined STL + per-panel STLs to the `body-skins`
 *      bucket and inserts `body_kit_parts` rows.
 *
 * Body: { body_kit_id: string }
 *
 * Status transitions:
 *   queued → baking → subtracting → splitting → ready
 *   any → failed (with `error`)
 *
 * Note: This function is invoked by the user from the Build Studio (RLS
 * permits the bake to insert a `body_kits` row, and this function uses
 * the service role to update + write children).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseStl, writeBinaryStl, weldMesh, type Mesh } from "../_shared/stl-io.ts";
import {
  splitByCreases,
  extractComponentMesh,
} from "../_shared/stl-split-by-creases.ts";
import { classifyPanels } from "../_shared/classify-car-panels.ts";

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

/** Distance (in donor mm) below which a shell vertex is considered "on the donor". */
const TOLERANCE_MM = 4;
const MIN_SPLIT_TRIANGLES = 80;
/** Cap input triangle counts so the bake stays under the edge CPU budget. */
const MAX_INPUT_TRIS = 60_000;

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

interface Vec3 { x: number; y: number; z: number }

interface BakedTransform {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let bodyKitId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const body = await req.json().catch(() => ({})) as { body_kit_id?: string };
    if (!body.body_kit_id) return json({ error: "body_kit_id required" }, 400);
    bodyKitId = body.body_kit_id;

    // --- Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // --- Load body_kits row ---
    const { data: kitData, error: kitErr } = await admin
      .from("body_kits")
      .select("*")
      .eq("id", bodyKitId)
      .maybeSingle();
    if (kitErr) return json({ error: kitErr.message }, 500);
    if (!kitData) return json({ error: "body_kits row not found" }, 404);
    const kit = kitData as {
      id: string;
      user_id: string;
      status: string;
      body_skin_id: string;
      donor_car_template_id: string | null;
      baked_transform: unknown;
    };
    if (kit.user_id !== userRes.user.id) return json({ error: "Forbidden" }, 403);

    // Idempotency: skip if already terminal.
    if (kit.status === "ready") {
      return json({ ok: true, status: "ready", body_kit_id: kit.id, skipped: true });
    }

    await admin.from("body_kits")
      .update({ status: "baking", error: null })
      .eq("id", kit.id);

    // --- Load body skin ---
    const { data: skinData, error: skinErr } = await admin
      .from("body_skins")
      .select("file_url_stl, file_url_glb, name")
      .eq("id", kit.body_skin_id)
      .maybeSingle();
    if (skinErr) throw new Error(`Skin lookup failed: ${skinErr.message}`);
    if (!skinData) throw new Error("Body skin not found");
    const skin = skinData as {
      file_url_stl: string | null;
      file_url_glb: string | null;
      name: string;
    };
    if (!skin.file_url_stl) {
      throw new Error(
        "This body skin only has a GLB file. Re-export it as STL (or run the GLB→STL conversion) before baking a kit.",
      );
    }

    // --- Load donor car STL ---
    if (!kit.donor_car_template_id) {
      throw new Error("No donor car template attached to this kit.");
    }
    const { data: carStlData, error: carErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("car_template_id", kit.donor_car_template_id)
      .maybeSingle();
    if (carErr) throw new Error(`Donor lookup failed: ${carErr.message}`);
    if (!carStlData) throw new Error("Donor car has no STL configured.");
    const carStl = carStlData as { repaired_stl_path: string | null; stl_path: string };
    const donorPath = carStl.repaired_stl_path ?? carStl.stl_path;
    if (!donorPath) throw new Error("Donor car STL path missing.");

    // --- Download both meshes ---
    const donorBytes = await downloadStorage(admin, "car-stls", donorPath);
    const skinBytes = await downloadHttpOrStorage(admin, skin.file_url_stl, "body-skins");

    let donorMesh = parseStl(donorBytes);
    let shellMesh = parseStl(skinBytes);
    if (donorMesh.indices.length === 0) throw new Error("Donor mesh empty.");
    if (shellMesh.indices.length === 0) throw new Error("Shell mesh empty.");

    // --- Normalise units ---
    // Donor STLs are millimetres in this project. The shell may have been
    // exported in metres (typical for GLB-derived STLs from Meshy). Detect
    // by bounding-box magnitude: if the shell fits within a 50-unit cube,
    // it's metres and we scale up to mm.
    const shellBox = bbox(shellMesh);
    const shellMaxDim = Math.max(
      shellBox.max[0] - shellBox.min[0],
      shellBox.max[1] - shellBox.min[1],
      shellBox.max[2] - shellBox.min[2],
    );
    if (shellMaxDim < 50) {
      scaleMeshInPlace(shellMesh, 1000); // m → mm
    }

    // --- Apply baked transform ---
    const t = (kit.baked_transform ?? {}) as BakedTransform;
    applyTransformInPlace(shellMesh, t);

    // --- Subtract donor (vertex hash distance) ---
    const isOutboard = computeOutboardMask(shellMesh, donorMesh, TOLERANCE_MM);
    const outboardCount = countOutboard(isOutboard);
    if (outboardCount === 0) {
      throw new Error(
        "No outboard geometry found — the shell sits within tolerance of the donor everywhere. Check the alignment.",
      );
    }

    await admin.from("body_kits")
      .update({ status: "subtracting" })
      .eq("id", kit.id);

    // Free donor mesh now that the mask is computed.
    donorMesh = null as any;

    // --- Build kit-only mesh from kept triangles ---
    let kitMesh = pickTrianglesByVertexMask(shellMesh, isOutboard, /*minVerts*/ 2);
    shellMesh = null as any;
    if (kitMesh.indices.length === 0) {
      throw new Error("No kit triangles after subtraction.");
    }
    kitMesh = weldMesh(kitMesh, 0.5);

    // --- Upload combined STL ---
    const combinedBytes = writeBinaryStl(kitMesh);
    const combinedPath = `bodykits/${kit.id}/combined.stl`;
    const { error: combinedUpErr } = await admin.storage
      .from("body-skins")
      .upload(combinedPath, combinedBytes, { contentType: "model/stl", upsert: true });
    if (combinedUpErr) throw new Error(`Combined STL upload failed: ${combinedUpErr.message}`);

    // --- Split into panels ---
    await admin.from("body_kits")
      .update({ status: "splitting", combined_stl_path: combinedPath, triangle_count: kitMesh.indices.length / 3 })
      .eq("id", kit.id);

    const split = splitByCreases(kitMesh, {
      thresholdDeg: 38,
      minTriangles: MIN_SPLIT_TRIANGLES,
      minAreaFraction: 0.005,
      unitsAreMillimetres: true,
      weldEpsilon: 0.5,
    });

    // Cleanup any prior parts for this kit (idempotent re-bake).
    await admin.from("body_kit_parts").delete().eq("body_kit_id", kit.id);

    let panelCount = 0;
    if (split.components.length > 0) {
      const { assignments } = classifyPanels(split.components);
      const slotCounters = new Map<string, number>();
      const insertRows: Array<Record<string, unknown>> = [];

      for (const a of assignments) {
        const comp = split.components[a.componentIndex];
        const baseSlot = a.slot === "unknown" && a.unknownIndex
          ? `unknown_${a.unknownIndex}`
          : a.slot;
        const n = (slotCounters.get(baseSlot) ?? 0) + 1;
        slotCounters.set(baseSlot, n);
        const slotName = n === 1 ? baseSlot : `${baseSlot}_${n}`;

        const compMesh = extractComponentMesh(split.weldedMesh, comp.triangleIndices);
        const stlBytes = writeBinaryStl(compMesh);
        const stlPath = `bodykits/${kit.id}/panels/${slotName}.stl`;
        const { error: upErr } = await admin.storage
          .from("body-skins")
          .upload(stlPath, stlBytes, { contentType: "model/stl", upsert: true });
        if (upErr) {
          // Skip this panel but don't abort — log via reason.
          insertRows.push({
            body_kit_id: kit.id,
            user_id: kit.user_id,
            slot: slotName,
            label: a.slot,
            confidence: a.confidence,
            stl_path: stlPath,
            triangle_count: comp.triangleCount,
            area_m2: comp.areaM2,
            bbox: { error: `Upload failed: ${upErr.message}` },
          });
          continue;
        }

        insertRows.push({
          body_kit_id: kit.id,
          user_id: kit.user_id,
          slot: slotName,
          label: a.slot,
          confidence: a.confidence,
          stl_path: stlPath,
          triangle_count: comp.triangleCount,
          area_m2: comp.areaM2,
          anchor_position: comp.boundaryCentroid
            ? { x: comp.boundaryCentroid[0], y: comp.boundaryCentroid[1], z: comp.boundaryCentroid[2] }
            : null,
          bbox: {
            min: comp.bbox.min,
            max: comp.bbox.max,
            centroid: comp.centroid,
            avg_normal: comp.avgNormal,
          },
        });
        panelCount++;
      }

      if (insertRows.length > 0) {
        const { error: partsErr } = await admin.from("body_kit_parts").insert(insertRows);
        if (partsErr) throw new Error(`Insert panels failed: ${partsErr.message}`);
      }
    }

    // If splitter found nothing usable, the kit still ships as a single combined STL.
    await admin.from("body_kits")
      .update({
        status: "ready",
        panel_count: panelCount,
        error: null,
      })
      .eq("id", kit.id);

    return json({
      ok: true,
      body_kit_id: kit.id,
      status: "ready",
      combined_stl_path: combinedPath,
      panel_count: panelCount,
      sharp_edges: split.sharpEdgeCount,
      total_components: split.components.length,
      total_triangles: kitMesh.indices.length / 3,
    });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (admin && bodyKitId) {
      await admin.from("body_kits")
        .update({ status: "failed", error: msg })
        .eq("id", bodyKitId);
    }
    return json({ error: msg }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function downloadStorage(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Download ${bucket}/${path} failed: ${error?.message ?? "unknown"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * `body_skins.file_url_stl` may be a full https URL (signed) OR a bucket
 * relative path. Detect and download accordingly.
 */
async function downloadHttpOrStorage(
  admin: ReturnType<typeof createClient>,
  urlOrPath: string,
  fallbackBucket: string,
): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetch(urlOrPath);
    if (!res.ok) {
      // Try to interpret as storage path (signed urls expire — fall back).
      const tail = urlOrPath.split("/object/public/").pop()
        ?? urlOrPath.split("/object/sign/").pop();
      if (tail) {
        const [bucket, ...rest] = tail.split("/");
        const path = rest.join("/").split("?")[0];
        return downloadStorage(admin, bucket, path);
      }
      throw new Error(`Fetch ${urlOrPath} failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  return downloadStorage(admin, fallbackBucket, urlOrPath);
}

function bbox(m: Mesh): { min: [number, number, number]; max: [number, number, number] } {
  const p = m.positions;
  if (p.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minX) minX = p[i]; if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1];
    if (p[i + 2] < minZ) minZ = p[i + 2]; if (p[i + 2] > maxZ) maxZ = p[i + 2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function scaleMeshInPlace(m: Mesh, factor: number): void {
  const p = m.positions;
  for (let i = 0; i < p.length; i++) p[i] *= factor;
}

/**
 * Apply the persisted shell transform (position in m, rotation in radians,
 * scale unitless) to a mesh whose vertices are in mm. The viewport stores
 * the alignment in metres (Three.js world units); we scale translations
 * and treat rotations/scales as-is.
 */
function applyTransformInPlace(m: Mesh, t: BakedTransform): void {
  const sx = t.scale?.x ?? 1, sy = t.scale?.y ?? 1, sz = t.scale?.z ?? 1;
  const rx = t.rotation?.x ?? 0, ry = t.rotation?.y ?? 0, rz = t.rotation?.z ?? 0;
  const tx = (t.position?.x ?? 0) * 1000;
  const ty = (t.position?.y ?? 0) * 1000;
  const tz = (t.position?.z ?? 0) * 1000;

  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);

  // Three.js default rotation order is XYZ.
  const m00 = cy * cz;
  const m01 = -cy * szr;
  const m02 = syr;
  const m10 = sxr * syr * cz + cx * szr;
  const m11 = -sxr * syr * szr + cx * cz;
  const m12 = -sxr * cy;
  const m20 = -cx * syr * cz + sxr * szr;
  const m21 = cx * syr * szr + sxr * cz;
  const m22 = cx * cy;

  const p = m.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * sx, y = p[i + 1] * sy, z = p[i + 2] * sz;
    p[i]     = m00 * x + m01 * y + m02 * z + tx;
    p[i + 1] = m10 * x + m11 * y + m12 * z + ty;
    p[i + 2] = m20 * x + m21 * y + m22 * z + tz;
  }
}

/**
 * Mark each shell vertex as "outboard" if its distance to any donor vertex
 * exceeds `tolMm`. Uses a coarse spatial hash (cell = 100mm) over the
 * donor — same heuristic as `subtract-aero-kit`.
 */
function computeOutboardMask(shell: Mesh, donor: Mesh, tolMm: number): Uint8Array {
  const CELL = 100;
  const dh = new Map<string, number[]>();
  const dp = donor.positions;
  for (let i = 0; i < dp.length; i += 3) {
    const cx = Math.floor(dp[i] / CELL);
    const cy = Math.floor(dp[i + 1] / CELL);
    const cz = Math.floor(dp[i + 2] / CELL);
    const k = `${cx},${cy},${cz}`;
    const arr = dh.get(k);
    if (arr) arr.push(i); else dh.set(k, [i]);
  }

  const tolSq = tolMm * tolMm;
  const sp = shell.positions;
  const vc = sp.length / 3;
  const mask = new Uint8Array(vc);
  for (let v = 0; v < vc; v++) {
    const x = sp[v * 3], y = sp[v * 3 + 1], z = sp[v * 3 + 2];
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const cz = Math.floor(z / CELL);
    let best = Infinity;
    outer: for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = dh.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const idx of arr) {
            const dxv = dp[idx] - x;
            const dyv = dp[idx + 1] - y;
            const dzv = dp[idx + 2] - z;
            const d2 = dxv * dxv + dyv * dyv + dzv * dzv;
            if (d2 < best) {
              best = d2;
              if (best <= tolSq) break outer;
            }
          }
        }
      }
    }
    if (best > tolSq) mask[v] = 1;
  }
  return mask;
}

function countOutboard(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/**
 * Keep triangles with ≥ minVerts vertices marked in `mask`. Re-indexes
 * positions into a fresh, compact mesh.
 */
function pickTrianglesByVertexMask(mesh: Mesh, mask: Uint8Array, minVerts: number): Mesh {
  const { positions, indices } = mesh;
  const triCount = indices.length / 3;
  const kept: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const k = (mask[indices[t * 3]] | 0)
            + (mask[indices[t * 3 + 1]] | 0)
            + (mask[indices[t * 3 + 2]] | 0);
    if (k >= minVerts) kept.push(t);
  }
  const remap = new Map<number, number>();
  const newPos: number[] = [];
  const newIdx = new Uint32Array(kept.length * 3);
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i];
    for (let k = 0; k < 3; k++) {
      const old = indices[t * 3 + k];
      let nid = remap.get(old);
      if (nid === undefined) {
        nid = newPos.length / 3;
        newPos.push(positions[old * 3], positions[old * 3 + 1], positions[old * 3 + 2]);
        remap.set(old, nid);
      }
      newIdx[i * 3 + k] = nid;
    }
  }
  return { positions: new Float32Array(newPos), indices: newIdx };
}
