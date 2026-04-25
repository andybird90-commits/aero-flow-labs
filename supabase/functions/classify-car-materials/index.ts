/**
 * classify-car-materials — Tier 2 paint classifier.
 *
 * Loads a car_stl, runs a fast geometric classifier that tags every triangle
 * as one of:
 *   0 = body
 *   1 = glass
 *   2 = wheel  (rim/spoke)
 *   3 = tyre   (rubber)
 *
 * Optionally augments with Lovable AI (Gemini 2.5 Pro) to verify ambiguous
 * decisions. Result is stored in `car_material_maps` keyed by car_stl_id and
 * is shared across all users (paint tags don't depend on user choices — they
 * describe the geometry of the hero car itself).
 *
 * Trigger: called from the client when Paint Studio first opens for a car
 * that has no material map yet, OR explicitly via the "Re-classify" button.
 *
 * Coordinate assumptions (matches existing car_stls library):
 *   - Z-up, units = millimetres
 *   - forward axis defaults to +X
 *   - tyres rest near Z=0
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { parseStl } from "../_shared/stl-io.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TAG_BODY = 0;
const TAG_GLASS = 1;
const TAG_WHEEL = 2;
const TAG_TYRE = 3;

interface ClassifyRequest {
  car_stl_id: string;
  use_ai?: boolean; // future: enable verification pass
  force?: boolean;  // re-run even if a map already exists
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = (await req.json()) as ClassifyRequest;
    if (!body.car_stl_id) {
      return json({ error: "car_stl_id required" }, 400);
    }

    // Bumped whenever the heuristic changes — older entries get auto-rerun.
    const CLASSIFIER_VERSION = "geometric-v2";

    // Skip if already cached at the current version (unless forced).
    if (!body.force) {
      const { data: existing } = await admin
        .from("car_material_maps")
        .select("id, method, triangle_count, stats")
        .eq("car_stl_id", body.car_stl_id)
        .maybeSingle();
      if (existing && existing.method === CLASSIFIER_VERSION) {
        return json({ ok: true, cached: true, map: existing });
      }
    }

    // Load car_stl row
    const { data: stlRow, error: stlErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("id", body.car_stl_id)
      .maybeSingle();
    if (stlErr) throw stlErr;
    if (!stlRow) return json({ error: "car_stl not found" }, 404);

    const path = stlRow.repaired_stl_path ?? stlRow.stl_path;
    const { data: download, error: dlErr } = await admin.storage
      .from("car-stls")
      .download(path);
    if (dlErr) throw dlErr;

    const bytes = new Uint8Array(await download.arrayBuffer());
    const mesh = parseStl(bytes);
    const triCount = mesh.indices.length / 3;
    if (triCount === 0) {
      return json({ error: "STL parsed to zero triangles" }, 400);
    }

    console.log(`[classify-car-materials] STL ${body.car_stl_id}: ${triCount} triangles`);

    const tags = classifyGeometric(mesh);

    // Compute summary stats
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < tags.length; i++) counts[tags[i]]++;
    const stats = {
      body: counts[TAG_BODY],
      glass: counts[TAG_GLASS],
      wheel: counts[TAG_WHEEL],
      tyre: counts[TAG_TYRE],
      total: triCount,
    };

    console.log("[classify-car-materials] stats:", stats);

    // Encode tags to base64
    const tagBlobB64 = base64Encode(tags);

    // Upsert
    const { data: saved, error: upErr } = await admin
      .from("car_material_maps")
      .upsert(
        {
          car_stl_id: body.car_stl_id,
          method: "geometric",
          triangle_count: triCount,
          tag_blob_b64: tagBlobB64,
          stats,
          ai_notes: null,
        },
        { onConflict: "car_stl_id" },
      )
      .select("id, method, triangle_count, stats")
      .single();
    if (upErr) throw upErr;

    return json({ ok: true, cached: false, map: saved });
  } catch (e) {
    console.error("[classify-car-materials] error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});

/* ─── Geometric classifier ─────────────────────────────────── */

interface Mesh3 {
  positions: Float32Array;
  indices: Uint32Array;
}

function classifyGeometric(mesh: Mesh3): Uint8Array {
  const triCount = mesh.indices.length / 3;
  const tags = new Uint8Array(triCount);

  // Bounding box (Z-up, X-forward assumption)
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const length = maxX - minX;
  const width = maxY - minY;
  const height = maxZ - minZ;
  const groundZ = minZ;
  const centerY = (minY + maxY) / 2;
  const halfWidth = width / 2;

  // ── Wheel geometry ────────────────────────────────────────
  // Wheels sit at the corners. Tyre OD ≈ 32% of car length for sports cars,
  // 28% for sedans. Use 30% to be safe → radius ≈ 15% of length.
  const wheelRadius = length * 0.16;
  const wheelCenterZ = groundZ + wheelRadius; // wheel hub height
  const frontWheelX = maxX - length * 0.20;
  const rearWheelX = minX + length * 0.20;
  // Outer edge band (where wheels live) — outer ~30% of width on each side
  const wheelInnerY = halfWidth * 0.55;
  // Inside the wheel-radius envelope, distinguish tyre (outer ring, far from hub)
  // vs rim (inner disc, close to hub). Boundary ≈ 65% of wheelRadius.
  const tyreInnerR = wheelRadius * 0.62;

  // ── Glass geometry ────────────────────────────────────────
  // Glass starts above the belt-line. For sports cars belt-line ≈ 55% height.
  const glassBottomZ = groundZ + height * 0.52;
  // Roof line ≈ 92% — above this is bodywork roof not glass.
  const glassTopZ = groundZ + height * 0.95;

  for (let t = 0; t < triCount; t++) {
    const ai = mesh.indices[t * 3] * 3;
    const bi = mesh.indices[t * 3 + 1] * 3;
    const ci = mesh.indices[t * 3 + 2] * 3;
    const ax = p[ai], ay = p[ai + 1], az = p[ai + 2];
    const bx = p[bi], by = p[bi + 1], bz = p[bi + 2];
    const cx = p[ci], cy = p[ci + 1], cz = p[ci + 2];

    const cxm = (ax + bx + cx) / 3;
    const cym = (ay + by + cy) / 3;
    const czm = (az + bz + cz) / 3;
    const cyRel = cym - centerY; // signed Y relative to car centerline

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen; ny /= nlen; nz /= nlen;

    let tag = TAG_BODY;

    // ── 1) Wheel/tyre detection ─────────────────────────────
    // The triangle must sit inside the spherical envelope of one of the four
    // wheel hubs. We check distance from hub centre in the X-Z plane (radial
    // in the wheel's rotational frame).
    const isFrontHub = Math.abs(cxm - frontWheelX) <= wheelRadius;
    const isRearHub = Math.abs(cxm - rearWheelX) <= wheelRadius;
    const isOuterTrack = Math.abs(cyRel) >= wheelInnerY;

    if ((isFrontHub || isRearHub) && isOuterTrack && czm <= wheelCenterZ + wheelRadius) {
      // Distance from wheel hub in the X-Z plane (the wheel's "radius" axis)
      const hubX = isFrontHub ? frontWheelX : rearWheelX;
      const dx = cxm - hubX;
      const dz = czm - wheelCenterZ;
      const radial = Math.hypot(dx, dz);

      if (radial <= wheelRadius * 1.05) {
        // Inside wheel envelope. Discriminate by radial position:
        //   - Outer ring (radial > tyreInnerR) → TYRE
        //   - Inner disc (radial <= tyreInnerR) → WHEEL
        // Plus a normal-direction tiebreaker for the boundary zone:
        //   rim faces have normals strongly along ±Y (face the camera from
        //   the side). Tread/sidewall normals are radial → mostly in X-Z.
        const absNy = Math.abs(ny);
        if (radial > tyreInnerR) {
          // Outer ring — almost certainly tyre, unless it's clearly a rim
          // face poking out (rare).
          tag = absNy > 0.85 && radial < wheelRadius * 0.85
            ? TAG_WHEEL
            : TAG_TYRE;
        } else {
          // Inner disc → rim/spoke
          tag = TAG_WHEEL;
        }
      }
    }

    // ── 2) Glass detection ──────────────────────────────────
    // Only consider triangles in the glasshouse band that haven't already
    // been claimed by the wheel zone.
    if (tag === TAG_BODY && czm >= glassBottomZ && czm <= glassTopZ) {
      const absNx = Math.abs(nx);
      const absNy = Math.abs(ny);
      const absNz = Math.abs(nz);

      // Side glass: triangle is on the outer edge of the body, normal points
      // mostly sideways (±Y), surface is roughly vertical (low Nz).
      const sideGlass =
        absNy > 0.5 &&
        Math.abs(cyRel) > halfWidth * 0.30 &&
        absNz < 0.55;

      // Windscreen / rear screen: normal slopes upward and forward/backward.
      // Excludes roof (which has nz≈1 and small nx).
      const frontRearScreen =
        nz > 0.20 &&
        absNx > 0.30 &&
        absNz < 0.88;

      // Quarter glass (small triangular pane behind the door): similar to
      // side glass but sits closer to the centerline and high up.
      const quarterGlass =
        absNy > 0.55 &&
        Math.abs(cyRel) > halfWidth * 0.22 &&
        czm > groundZ + height * 0.65 &&
        absNz < 0.5;

      if (sideGlass || frontRearScreen || quarterGlass) {
        tag = TAG_GLASS;
      }
    }

    tags[t] = tag;
  }

  return tags;
}

/* ─── helpers ─────────────────────────────────────────────── */

function base64Encode(bytes: Uint8Array): string {
  // Chunked btoa to avoid call-stack issues on huge meshes.
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    s += String.fromCharCode(...slice);
  }
  return btoa(s);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
