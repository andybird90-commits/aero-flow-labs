/**
 * subtract-aero-kit
 *
 * Builds the printable aero kit by isolating the parts of the displaced mesh
 * that moved meaningfully outward from the stock STL.
 *
 * Uses a per-vertex distance-to-stock test:
 *   1. Load displaced.stl AND repaired stock STL.
 *   2. Build a coarse spatial hash of the stock vertices.
 *   3. For each displaced vertex, compute distance to nearest stock vertex.
 *      Vertices > 2mm from stock = "kit".
 *   4. Keep triangles with ≥2 kit vertices.
 *   5. Weld, upload combined kit STL, insert a single concept_part row.
 *
 * Skips connected-component splitting to stay within edge worker memory.
 *
 * Body: { concept_id: string }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseStl, writeBinaryStl, weldMesh, type Mesh } from "../_shared/stl-io.ts";
import { reorientMesh, type ForwardAxis } from "../_shared/stl-render-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOLERANCE_MM = 2;
const MAX_INPUT_TRIS = 50_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { concept_id?: string };
    if (!body.concept_id) return json({ error: "concept_id required" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as any;

    const { data: concept, error: cErr } = await admin
      .from("concepts").select("*").eq("id", body.concept_id).maybeSingle();
    if (cErr || !concept) return json({ error: "concept not found" }, 404);
    if (concept.user_id !== userRes.user.id) return json({ error: "Forbidden" }, 403);

    const { data: project } = await admin
      .from("projects").select("*, car:cars(template_id)").eq("id", concept.project_id).maybeSingle();
    const templateId = (project as any)?.car?.template_id;
    if (!templateId) return json({ error: "Project car has no template" }, 400);

    const { data: stlRow } = await admin
      .from("car_stls").select("*").eq("car_template_id", templateId).maybeSingle();
    if (!stlRow?.repaired_stl_path) return json({ error: "Hero STL not repaired" }, 400);

    await admin.from("concepts")
      .update({ aero_kit_status: "subtracting", aero_kit_error: null })
      .eq("id", concept.id);

    // 1. Load stock + displaced.
    const stockPath = stlRow.repaired_stl_path;
    const dispPath = `displaced/${concept.id}.stl`;
    const [stockBlob, dispBlob] = await Promise.all([
      admin.storage.from("car-stls").download(stockPath),
      admin.storage.from("car-stls").download(dispPath),
    ]);
    if (stockBlob.error || !stockBlob.data) return fail(admin, concept.id, `Stock load failed: ${stockBlob.error?.message ?? "unknown"}`);
    if (dispBlob.error || !dispBlob.data) return fail(admin, concept.id, `Displaced load failed: ${dispBlob.error?.message ?? "unknown"}`);

    let stockMesh = parseStl(new Uint8Array(await stockBlob.data.arrayBuffer()));
    let displacedMesh = parseStl(new Uint8Array(await dispBlob.data.arrayBuffer()));
    if (stockMesh.positions.length === 0 || displacedMesh.positions.length === 0) {
      return fail(admin, concept.id, "Empty stock or displaced mesh");
    }
    stockMesh = reorientMesh(stockMesh, (stlRow.forward_axis as ForwardAxis) ?? "-z");

    // Decimate if too dense.
    displacedMesh = decimateIfTooBig(displacedMesh, MAX_INPUT_TRIS);
    stockMesh = decimateIfTooBig(stockMesh, MAX_INPUT_TRIS);

    // 2. Spatial hash of stock vertices.
    const CELL = 100;
    const stockHash = new Map<string, number[]>();
    const sp = stockMesh.positions;
    for (let i = 0; i < sp.length; i += 3) {
      const cx = Math.floor(sp[i] / CELL), cy = Math.floor(sp[i + 1] / CELL), cz = Math.floor(sp[i + 2] / CELL);
      const k = `${cx},${cy},${cz}`;
      const arr = stockHash.get(k);
      if (arr) arr.push(i); else stockHash.set(k, [i]);
    }

    const distToStockSq = (x: number, y: number, z: number): number => {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
      let best = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const arr = stockHash.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!arr) continue;
            for (const idx of arr) {
              const dxv = sp[idx] - x, dyv = sp[idx + 1] - y, dzv = sp[idx + 2] - z;
              const d2 = dxv * dxv + dyv * dyv + dzv * dzv;
              if (d2 < best) best = d2;
            }
          }
        }
      }
      return best;
    };

    // Free stock mesh memory now that the hash is built.
    stockMesh = null as any;

    // 3. Mark displaced vertices > tolerance from stock.
    const dp = displacedMesh.positions;
    const vCount = dp.length / 3;
    const isKit = new Uint8Array(vCount);
    const tolSq = TOLERANCE_MM * TOLERANCE_MM;
    let kitVerts = 0;
    for (let v = 0; v < vCount; v++) {
      if (distToStockSq(dp[v * 3], dp[v * 3 + 1], dp[v * 3 + 2]) > tolSq) {
        isKit[v] = 1;
        kitVerts++;
      }
    }

    if (kitVerts === 0) {
      return fail(admin, concept.id, "Displaced mesh sits entirely within tolerance of stock — nothing to subtract.");
    }

    // 4. Keep triangles with ≥2 kit vertices.
    const di = displacedMesh.indices;
    const triCount = di.length / 3;
    const keptTris: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const k = (isKit[di[t * 3]] | 0) + (isKit[di[t * 3 + 1]] | 0) + (isKit[di[t * 3 + 2]] | 0);
      if (k >= 2) keptTris.push(t);
    }
    if (keptTris.length === 0) {
      return fail(admin, concept.id, "No kit triangles after subtraction");
    }

    // Re-index into a fresh mesh.
    const remap = new Map<number, number>();
    const newPos: number[] = [];
    const newIdx = new Uint32Array(keptTris.length * 3);
    for (let i = 0; i < keptTris.length; i++) {
      const t = keptTris[i];
      for (let k = 0; k < 3; k++) {
        const old = di[t * 3 + k];
        let nid = remap.get(old);
        if (nid === undefined) {
          nid = newPos.length / 3;
          newPos.push(dp[old * 3], dp[old * 3 + 1], dp[old * 3 + 2]);
          remap.set(old, nid);
        }
        newIdx[i * 3 + k] = nid;
      }
    }
    let kitMesh: Mesh = { positions: new Float32Array(newPos), indices: newIdx };
    kitMesh = weldMesh(kitMesh, 0.5);

    // 5. Upload combined kit STL (no component splitting).
    const combinedBytes = writeBinaryStl(kitMesh);
    const kitPath = `aero-kits/${concept.id}/kit.stl`;
    const { error: kitUpErr } = await admin.storage.from("car-stls")
      .upload(kitPath, combinedBytes, { contentType: "model/stl", upsert: true });
    if (kitUpErr) return fail(admin, concept.id, `Upload kit STL failed: ${kitUpErr.message}`);
    const { data: kitSigned } = await admin.storage.from("car-stls").createSignedUrl(kitPath, 60 * 60 * 24 * 365);

    // Clear prior boolean-source parts, insert single combined part.
    await admin.from("concept_parts")
      .delete().eq("concept_id", concept.id).eq("source", "boolean");

    await admin.from("concept_parts").insert({
      user_id: userRes.user.id,
      project_id: concept.project_id,
      concept_id: concept.id,
      kind: "full_kit",
      label: "Aero Kit",
      glb_url: kitSigned?.signedUrl ?? null,
      render_urls: [],
      source: "boolean",
    });

    await admin.from("concepts").update({
      aero_kit_status: "ready",
      aero_kit_url: kitSigned?.signedUrl ?? null,
      aero_kit_error: null,
    }).eq("id", concept.id);

    return json({
      ok: true,
      kit_url: kitSigned?.signedUrl ?? null,
      triangles: kitMesh.indices.length / 3,
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

async function fail(admin: any, conceptId: string, message: string) {
  await admin.from("concepts").update({ aero_kit_status: "failed", aero_kit_error: message }).eq("id", conceptId);
  return json({ error: message }, 500);
}

/** Cheap uniform triangle decimation to stay under worker memory. */
function decimateIfTooBig(mesh: Mesh, maxTris: number): Mesh {
  const triCount = mesh.indices.length / 3;
  if (triCount <= maxTris) return mesh;
  const stride = Math.ceil(triCount / maxTris);
  const keptCount = Math.floor(triCount / stride);
  const keptIdx = new Uint32Array(keptCount * 3);
  const remap = new Map<number, number>();
  const newPos: number[] = [];
  for (let i = 0; i < keptCount; i++) {
    const t = i * stride;
    for (let k = 0; k < 3; k++) {
      const old = mesh.indices[t * 3 + k];
      let nid = remap.get(old);
      if (nid === undefined) {
        nid = newPos.length / 3;
        newPos.push(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2]);
        remap.set(old, nid);
      }
      keptIdx[i * 3 + k] = nid;
    }
  }
  return { positions: new Float32Array(newPos), indices: keptIdx };
}
