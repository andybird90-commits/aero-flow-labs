/**
 * repair-car-stl
 *
 * Admin-only. Loads a hero-car STL row from `car_stls`, downloads the raw
 * file from the `car-stls` bucket, runs the repair pass (weld + degenerate
 * removal + outward normal orientation + manifold check), uploads the
 * repaired result alongside the original, and updates the row with stats.
 *
 * Body: { car_stl_id: string }
 *
 * The boolean aero-kit pipeline refuses to run on non-manifold inputs, so
 * `manifold_clean` is the gate the rest of the system reads.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { repairStl } from "../_shared/stl-repair.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { car_stl_id?: string };
    if (!body.car_stl_id) return json({ error: "car_stl_id required" }, 400);

    // 1. Authenticate caller and confirm admin.
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

    // 2. Service-role client for storage + DB writes.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: row, error: rowErr } = await admin
      .from("car_stls")
      .select("*")
      .eq("id", body.car_stl_id)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 500);
    if (!row) return json({ error: "car_stls row not found" }, 404);

    // 3. Download original mesh (STL or OBJ).
    const { data: file, error: dlErr } = await admin.storage
      .from("car-stls")
      .download(row.stl_path);
    if (dlErr || !file) return json({ error: `Download failed: ${dlErr?.message ?? "unknown"}` }, 500);

    let inputBytes = new Uint8Array(await file.arrayBuffer());
    if (inputBytes.length === 0) return json({ error: "Empty mesh file" }, 400);

    // If OBJ, convert directly to BINARY STL bytes (memory-efficient) so repairStl can parse it.
    const isObj = /\.obj$/i.test(row.stl_path);
    if (isObj) {
      inputBytes = objToBinaryStl(inputBytes);
    }

    // 4. Repair.
    const result = repairStl(inputBytes);

    // 5. Upload repaired file as <basename>.repaired.stl (always .stl output).
    const repairedPath = row.stl_path.replace(/\.(stl|obj)$/i, "") + ".repaired.stl";
    const { error: upErr } = await admin.storage
      .from("car-stls")
      .upload(repairedPath, result.bytes, {
        contentType: "model/stl",
        upsert: true,
      });
    if (upErr) return json({ error: `Upload failed: ${upErr.message}` }, 500);

    // 6. Update row.
    const { error: updErr } = await admin
      .from("car_stls")
      .update({
        repaired_stl_path: repairedPath,
        manifold_clean: result.stats.manifold,
        triangle_count: result.stats.triangle_count_out,
        bbox_min_mm: result.stats.bbox_min,
        bbox_max_mm: result.stats.bbox_max,
      })
      .eq("id", row.id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, stats: result.stats, repaired_stl_path: repairedPath });
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

/**
 * Memory-efficient Wavefront OBJ → BINARY STL converter.
 *
 * Streams the OBJ bytes line-by-line (no global split, no big string array)
 * and writes triangles into a single pre-allocated binary STL buffer.
 * Faces with > 3 vertices are fan-triangulated. Per-face normals are computed
 * from geometry — repairStl re-orients them anyway.
 *
 * Binary STL layout: 80-byte header + uint32 tri count + 50 bytes per triangle.
 */
function objToBinaryStl(objBytes: Uint8Array): Uint8Array {
  // Use Float32Array storage for vertices to keep memory tight (~12 B/vertex
  // vs ~80+ B for [number,number,number] tuples in V8).
  let vCap = 1 << 16;
  let vCount = 0;
  let vx = new Float32Array(vCap);
  let vy = new Float32Array(vCap);
  let vz = new Float32Array(vCap);

  // Triangles as flat Int32Array of 1-based vertex indices (3 per tri).
  let tCap = 1 << 16;
  let tCount = 0;
  let tris = new Int32Array(tCap * 3);

  const pushVertex = (x: number, y: number, z: number) => {
    if (vCount === vCap) {
      vCap *= 2;
      const nx = new Float32Array(vCap); nx.set(vx); vx = nx;
      const ny = new Float32Array(vCap); ny.set(vy); vy = ny;
      const nz = new Float32Array(vCap); nz.set(vz); vz = nz;
    }
    vx[vCount] = x; vy[vCount] = y; vz[vCount] = z;
    vCount++;
  };
  const pushTri = (a: number, b: number, c: number) => {
    if (tCount === tCap) {
      tCap *= 2;
      const nt = new Int32Array(tCap * 3); nt.set(tris); tris = nt;
    }
    const o = tCount * 3;
    tris[o] = a; tris[o + 1] = b; tris[o + 2] = c;
    tCount++;
  };

  // Stream line-by-line over the raw bytes (avoid `String.split` blowup).
  const decoder = new TextDecoder();
  let lineStart = 0;
  const len = objBytes.length;
  const faceIdx: number[] = [];
  for (let i = 0; i <= len; i++) {
    const b = i < len ? objBytes[i] : 10; // virtual newline at EOF
    if (b !== 10 && b !== 13) continue;
    if (i > lineStart) {
      // Decode just this line.
      const line = decoder.decode(objBytes.subarray(lineStart, i));
      // Cheap dispatch on first non-space char.
      let p = 0;
      while (p < line.length && (line.charCodeAt(p) === 32 || line.charCodeAt(p) === 9)) p++;
      const c0 = line.charCodeAt(p);
      const c1 = line.charCodeAt(p + 1);
      // 'v' + space → vertex
      if (c0 === 118 && (c1 === 32 || c1 === 9)) {
        const parts = line.substring(p + 2).trim().split(/\s+/);
        const x = +parts[0], y = +parts[1], z = +parts[2];
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          pushVertex(x, y, z);
        }
      } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {
        // 'f' + space → face
        faceIdx.length = 0;
        const parts = line.substring(p + 2).trim().split(/\s+/);
        for (const tok of parts) {
          const slash = tok.indexOf("/");
          const n = parseInt(slash === -1 ? tok : tok.substring(0, slash), 10);
          if (Number.isFinite(n)) faceIdx.push(n < 0 ? vCount + n + 1 : n);
        }
        for (let k = 1; k < faceIdx.length - 1; k++) {
          pushTri(faceIdx[0], faceIdx[k], faceIdx[k + 1]);
        }
      }
    }
    lineStart = i + 1;
  }

  if (vCount === 0 || tCount === 0) {
    throw new Error("OBJ has no usable vertices or faces.");
  }

  // Allocate binary STL: 80 header + 4 count + 50 per tri.
  const out = new Uint8Array(84 + tCount * 50);
  const dv = new DataView(out.buffer);
  dv.setUint32(80, tCount, true);
  let off = 84;
  for (let t = 0; t < tCount; t++) {
    const o = t * 3;
    const ai = tris[o] - 1, bi = tris[o + 1] - 1, ci = tris[o + 2] - 1;
    if (ai < 0 || bi < 0 || ci < 0 || ai >= vCount || bi >= vCount || ci >= vCount) {
      // Skip malformed; still need to write a placeholder to keep count consistent.
      // Easier: zero triangle (degenerate) — repair will drop it.
      off += 50;
      continue;
    }
    const ax = vx[ai], ay = vy[ai], az = vz[ai];
    const bx = vx[bi], by = vy[bi], bz_ = vz[bi];
    const cx = vx[ci], cy = vy[ci], cz = vz[ci];
    const ux = bx - ax, uy = by - ay, uz = bz_ - az;
    const vvx = cx - ax, vvy = cy - ay, vvz = cz - az;
    let nx = uy * vvz - uz * vvy;
    let ny = uz * vvx - ux * vvz;
    let nz = ux * vvy - uy * vvx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
    dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz_, true);
    dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
    // attribute byte count (uint16) at off+48 stays 0
    off += 50;
  }
  return out;
}
