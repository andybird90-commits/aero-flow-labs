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

    // If OBJ, convert to ASCII STL bytes first so repairStl can parse it.
    const isObj = /\.obj$/i.test(row.stl_path);
    if (isObj) {
      const objText = new TextDecoder().decode(inputBytes);
      const stlText = objToAsciiStl(objText);
      inputBytes = new TextEncoder().encode(stlText);
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
 * Minimal Wavefront OBJ → ASCII STL converter.
 *
 * Handles `v` (vertex) and `f` (face) lines, including faces that reference
 * vertex/normal/texture indices in the `v/vt/vn` form. Faces with more than
 * 3 vertices are fan-triangulated. Per-face normals are computed from the
 * triangle geometry — we don't read the OBJ's `vn` lines because the repair
 * pass re-orients normals anyway.
 */
function objToAsciiStl(objText: string): string {
  const verts: [number, number, number][] = [];
  const tris: [number, number, number][] = []; // 1-based vertex indices

  const lines = objText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        verts.push([x, y, z]);
      }
    } else if (line.startsWith("f ")) {
      const parts = line.split(/\s+/).slice(1);
      // Each token is "v", "v/vt", "v//vn", or "v/vt/vn". Resolve negative indices.
      const idx = parts.map((p) => {
        const n = parseInt(p.split("/")[0], 10);
        if (!Number.isFinite(n)) return NaN;
        return n < 0 ? verts.length + n + 1 : n;
      });
      // Fan-triangulate.
      for (let i = 1; i < idx.length - 1; i++) {
        const a = idx[0], b = idx[i], c = idx[i + 1];
        if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
          tris.push([a, b, c]);
        }
      }
    }
  }

  if (verts.length === 0 || tris.length === 0) {
    throw new Error("OBJ has no usable vertices or faces.");
  }

  const out: string[] = ["solid converted"];
  for (const [a, b, c] of tris) {
    const va = verts[a - 1], vb = verts[b - 1], vc = verts[c - 1];
    if (!va || !vb || !vc) continue;
    // Face normal via cross product.
    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2];
    const vx = vc[0] - va[0], vy = vc[1] - va[1], vz = vc[2] - va[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    out.push(`facet normal ${nx} ${ny} ${nz}`);
    out.push("  outer loop");
    out.push(`    vertex ${va[0]} ${va[1]} ${va[2]}`);
    out.push(`    vertex ${vb[0]} ${vb[1]} ${vb[2]}`);
    out.push(`    vertex ${vc[0]} ${vc[1]} ${vc[2]}`);
    out.push("  endloop");
    out.push("endfacet");
  }
  out.push("endsolid converted");
  return out.join("\n");
}
