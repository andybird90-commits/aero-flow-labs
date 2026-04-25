/**
 * classify-car-materials — geometric paint classifier (v3).
 *
 * v3 uses **connected-component segmentation** based on dihedral creases
 * between triangles. Glass panels naturally separate from bodywork because
 * window seals form sharp edges (~30–60° dihedral). For each component we
 * then compute aggregate stats (flatness, vertical band, normal direction,
 * outer-envelope proximity) and score it as glass / wheel / tyre / body.
 *
 * Compared to the heuristic-only v2:
 *   - far fewer speckled wheel/tyre tris on bodywork
 *   - whole windscreens / side glass tag in one swoop
 *   - rim spokes vs rubber tread are separated by component flatness, not
 *     just radial distance from a guessed hub
 *
 * Result is cached in `car_material_maps` (one row per car_stl, shared across
 * users). Bumping `CLASSIFIER_VERSION` auto-reruns on next request.
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
  use_ai?: boolean;
  force?: boolean;
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

    const CLASSIFIER_VERSION = "geometric-v3";

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

    console.log(`[classify-car-materials v3] ${body.car_stl_id}: ${triCount} tris`);

    const tags = classifyV3(mesh);

    const counts = [0, 0, 0, 0];
    for (let i = 0; i < tags.length; i++) counts[tags[i]]++;
    const stats = {
      body: counts[TAG_BODY],
      glass: counts[TAG_GLASS],
      wheel: counts[TAG_WHEEL],
      tyre: counts[TAG_TYRE],
      total: triCount,
    };
    console.log("[classify-car-materials v3] stats:", stats);

    const tagBlobB64 = base64Encode(tags);

    const { data: saved, error: upErr } = await admin
      .from("car_material_maps")
      .upsert(
        {
          car_stl_id: body.car_stl_id,
          method: CLASSIFIER_VERSION,
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

/* ─── v3 classifier ────────────────────────────────────────── */

interface Mesh3 {
  positions: Float32Array;
  indices: Uint32Array;
}

function classifyV3(mesh: Mesh3): Uint8Array {
  const triCount = mesh.indices.length / 3;
  const tags = new Uint8Array(triCount); // default = body

  // ── 1. Bounding box / car dimensions ────────────────────────
  const p = mesh.positions;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
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

  // ── 2. Per-triangle centroids + face normals ────────────────
  const centroids = new Float32Array(triCount * 3);
  const normals = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const ai = mesh.indices[t * 3] * 3;
    const bi = mesh.indices[t * 3 + 1] * 3;
    const ci = mesh.indices[t * 3 + 2] * 3;
    const ax = p[ai], ay = p[ai + 1], az = p[ai + 2];
    const bx = p[bi], by = p[bi + 1], bz = p[bi + 2];
    const cx = p[ci], cy = p[ci + 1], cz = p[ci + 2];
    centroids[t * 3]     = (ax + bx + cx) / 3;
    centroids[t * 3 + 1] = (ay + by + cy) / 3;
    centroids[t * 3 + 2] = (az + bz + cz) / 3;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const ln = Math.hypot(nx, ny, nz) || 1;
    normals[t * 3]     = nx / ln;
    normals[t * 3 + 1] = ny / ln;
    normals[t * 3 + 2] = nz / ln;
  }

  // ── 3. Triangle adjacency via shared (welded) edges ─────────
  // Vertex weld at 0.1% of car length to bridge floating-point gaps.
  const weldEps = Math.max(length * 0.001, 0.5);
  const vKey = (x: number, y: number, z: number) =>
    `${Math.round(x / weldEps)}|${Math.round(y / weldEps)}|${Math.round(z / weldEps)}`;
  const vertId = new Int32Array(p.length / 3);
  const vertMap = new Map<string, number>();
  for (let i = 0; i < p.length / 3; i++) {
    const k = vKey(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    let id = vertMap.get(k);
    if (id == null) { id = vertMap.size; vertMap.set(k, id); }
    vertId[i] = id;
  }

  const adj = new Int32Array(triCount * 3).fill(-1);
  const edgeMap = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const va = vertId[mesh.indices[t * 3]];
    const vb = vertId[mesh.indices[t * 3 + 1]];
    const vc = vertId[mesh.indices[t * 3 + 2]];
    const edges: Array<[number, number]> = [[va, vb], [vb, vc], [vc, va]];
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(edges[k][0], edges[k][1]);
      const hi = Math.max(edges[k][0], edges[k][1]);
      const key = `${lo}|${hi}`;
      const other = edgeMap.get(key);
      if (other == null) {
        edgeMap.set(key, t);
      } else {
        adj[t * 3 + k] = other;
        // back-fill the other triangle's slot
        const ova = vertId[mesh.indices[other * 3]];
        const ovb = vertId[mesh.indices[other * 3 + 1]];
        const ovc = vertId[mesh.indices[other * 3 + 2]];
        const oe: Array<[number, number]> = [[ova, ovb], [ovb, ovc], [ovc, ova]];
        for (let kk = 0; kk < 3; kk++) {
          const olo = Math.min(oe[kk][0], oe[kk][1]);
          const ohi = Math.max(oe[kk][0], oe[kk][1]);
          if (olo === lo && ohi === hi) { adj[other * 3 + kk] = t; break; }
        }
      }
    }
  }

  // ── 4. Connected components, separated by sharp dihedral creases ──
  // Threshold: faces stay in the same component while their normals are
  // within ~25° of each other. Glass-to-body seals are typically >30°.
  const CREASE_DOT = Math.cos((25 * Math.PI) / 180);
  const compId = new Int32Array(triCount).fill(-1);
  const components: number[][] = [];
  const queue = new Int32Array(triCount);
  for (let seed = 0; seed < triCount; seed++) {
    if (compId[seed] !== -1) continue;
    const id = components.length;
    let qh = 0, qt = 0;
    queue[qt++] = seed;
    compId[seed] = id;
    const list: number[] = [];
    while (qh < qt) {
      const t = queue[qh++];
      list.push(t);
      const nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const nb = adj[t * 3 + k];
        if (nb < 0 || compId[nb] !== -1) continue;
        const mx = normals[nb * 3], my = normals[nb * 3 + 1], mz = normals[nb * 3 + 2];
        const dot = nx * mx + ny * my + nz * mz;
        if (dot < CREASE_DOT) continue;
        compId[nb] = id;
        queue[qt++] = nb;
      }
    }
    components.push(list);
  }

  console.log(`[v3] ${components.length} components`);

  // ── 5. Wheel envelope geometry (used by per-component scoring) ──
  // Sports-car tyre OD ≈ 30% of wheelbase length → radius ≈ 15%.
  const wheelRadius = length * 0.16;
  const wheelCenterZ = groundZ + wheelRadius;
  const frontWheelX = maxX - length * 0.20;
  const rearWheelX = minX + length * 0.20;
  const wheelInnerY = halfWidth * 0.55;
  const tyreInnerR = wheelRadius * 0.62;

  // Glass band
  const glassBottomZ = groundZ + height * 0.50;
  const glassTopZ = groundZ + height * 0.96;

  // ── 6. Score every component ─────────────────────────────────
  for (const comp of components) {
    const sz = comp.length;
    if (sz === 0) continue;

    // Aggregate stats
    let cxSum = 0, cySum = 0, czSum = 0;
    let nxSum = 0, nySum = 0, nzSum = 0;
    let absNySum = 0, absNzSum = 0;
    let inFrontWheel = 0, inRearWheel = 0;
    let inOuterTrack = 0;
    let inGlassBand = 0;
    for (const t of comp) {
      const cx = centroids[t * 3], cy = centroids[t * 3 + 1], cz = centroids[t * 3 + 2];
      const nx = normals[t * 3], ny = normals[t * 3 + 1], nz = normals[t * 3 + 2];
      cxSum += cx; cySum += cy; czSum += cz;
      nxSum += nx; nySum += ny; nzSum += nz;
      absNySum += Math.abs(ny); absNzSum += Math.abs(nz);
      const cyRel = cy - centerY;
      if (Math.abs(cx - frontWheelX) <= wheelRadius * 1.1) inFrontWheel++;
      if (Math.abs(cx - rearWheelX) <= wheelRadius * 1.1) inRearWheel++;
      if (Math.abs(cyRel) >= wheelInnerY) inOuterTrack++;
      if (cz >= glassBottomZ && cz <= glassTopZ) inGlassBand++;
    }
    const cxA = cxSum / sz, cyA = cySum / sz, czA = czSum / sz;
    const meanNx = nxSum / sz, meanNy = nySum / sz, meanNz = nzSum / sz;
    const absNyA = absNySum / sz, absNzA = absNzSum / sz;
    const cyRelA = cyA - centerY;

    // Flatness: |meanNormal| close to 1 → all faces point the same way
    // (a flat panel like glass). Curved bodywork has |meanNormal| ≪ 1.
    const flatness = Math.hypot(meanNx, meanNy, meanNz);

    const wheelFrac = (inFrontWheel + inRearWheel) / sz;
    const outerTrackFrac = inOuterTrack / sz;
    const glassBandFrac = inGlassBand / sz;

    /* ── Wheel / tyre detection ──────────────────────────────
       The component must sit inside one of the four wheel envelopes
       AND on the outer Y-track. Inside that, we discriminate rim vs
       tyre by per-triangle radial distance from the hub. */
    const isWheelLike =
      wheelFrac > 0.5 && outerTrackFrac > 0.4 && czA <= wheelCenterZ + wheelRadius;

    if (isWheelLike) {
      const inFront = inFrontWheel >= inRearWheel;
      const hubX = inFront ? frontWheelX : rearWheelX;
      for (const t of comp) {
        const cx = centroids[t * 3];
        const cz = centroids[t * 3 + 2];
        const radial = Math.hypot(cx - hubX, cz - wheelCenterZ);
        if (radial > wheelRadius * 1.15) {
          // Just outside the envelope (e.g. arch lip) — leave as body.
          continue;
        }
        if (radial > tyreInnerR) {
          tags[t] = TAG_TYRE;
        } else {
          tags[t] = TAG_WHEEL;
        }
      }
      continue;
    }

    /* ── Glass detection ─────────────────────────────────────
       Strong indicators:
         - lives in the upper half of the car
         - flat (high flatness) — glass panes barely curve
         - normals aren't vertical (a flat horizontal patch is the roof,
           not a window)
         - sits near the outer envelope, not buried inside the cabin
       A component qualifies when it ticks most of these. */
    if (
      glassBandFrac > 0.7 &&
      flatness > 0.85 &&
      sz >= 8 &&
      czA > groundZ + height * 0.45
    ) {
      const isWindscreenOrRear =
        Math.abs(meanNx) > 0.30 && meanNz > 0.10 && absNzA < 0.95;
      const isSideOrQuarter =
        absNyA > 0.55 &&
        Math.abs(cyRelA) > halfWidth * 0.25 &&
        absNzA < 0.65;
      // Roof opt-out: roof is also flat & horizontal but normal points
      // straight up (nz≈+1) and sits near the very top.
      const isRoof = meanNz > 0.85 && czA > groundZ + height * 0.85;
      if (!isRoof && (isWindscreenOrRear || isSideOrQuarter)) {
        for (const t of comp) tags[t] = TAG_GLASS;
        continue;
      }
    }

    // Otherwise: leave as body (default 0).
  }

  return tags;
}

/* ─── helpers ─────────────────────────────────────────────── */

function base64Encode(bytes: Uint8Array): string {
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
