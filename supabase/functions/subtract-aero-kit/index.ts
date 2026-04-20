/**
 * subtract-aero-kit
 *
 * Builds the printable aero kit by isolating the parts of the displaced mesh
 * that moved meaningfully outward from the stock STL.
 *
 * Why not a true CSG boolean? `manifold-3d` in Deno is fragile (WASM cold
 * start, intolerant of non-manifold inputs even after the repair pass), and
 * we already know exactly which vertices moved during displacement. So we
 * use a per-vertex distance-to-stock test instead:
 *
 *   1. Load `displaced.stl` AND repaired stock STL.
 *   2. Build a coarse spatial hash of the stock vertices (bucketed by 100mm).
 *   3. For each displaced vertex, compute distance to nearest stock vertex.
 *      Vertices > 2mm (the dilation tolerance) from stock = "kit".
 *   4. A triangle is "kit" if all 3 of its vertices are kit. Triangles where
 *      0 or 1 vertices are kit = stock surface; we drop them.
 *      For mixed triangles (2 kit verts), we keep them — they form the
 *      mating face that wraps onto the body.
 *   5. Drop tiny components, weld, smooth, split connected components, and
 *      classify each by bbox zone.
 *   6. Upload combined kit + per-part STLs and insert `concept_parts` rows.
 *
 * Body: { concept_id: string }
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseStl, writeBinaryStl, weldMesh, type Mesh } from "../_shared/stl-io.ts";
import { reorientMesh, type ForwardAxis } from "../_shared/stl-render-server.ts";
import {
  splitConnectedComponents, classifyByZone, meshBboxOf, approxVolume,
  type PartKind,
} from "../_shared/stl-classify.ts";

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
const MIN_COMPONENT_VOLUME_MM3 = 50_000; // 50 cm³
// Hard cap on triangles we'll process. Hero STLs from scrape sources can be
// 500k+ tris; running the per-vertex distance test + connected-component split
// on that scale blows the edge worker's 256 MB / 400ms budget.
const MAX_DISPLACED_TRIS = 60_000;
const MAX_KIT_TRIS_FOR_SPLIT = 40_000;

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
    // Displaced was already in canonical space when written by the displacement step.

    // Decimate inputs uniformly if they're too dense. Stride-sample triangles
    // — coarser than a real edge-collapse pass, but keeps the worker alive
    // and the kit shell only needs to be approximate (we re-weld below).
    displacedMesh = decimateIfTooBig(displacedMesh, MAX_DISPLACED_TRIS);
    stockMesh = decimateIfTooBig(stockMesh, MAX_DISPLACED_TRIS);

    // 2. Spatial hash of stock vertices for fast nearest-neighbour (~O(1) per query).
    const CELL = 100; // mm
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

    // 3. Mark displaced vertices that are > tolerance away from stock.
    const dp = displacedMesh.positions;
    const vCount = dp.length / 3;
    const isKit = new Uint8Array(vCount);
    const tolSq = TOLERANCE_MM * TOLERANCE_MM;
    let kitVerts = 0;
    for (let v = 0; v < vCount; v++) {
      const d2 = distToStockSq(dp[v * 3], dp[v * 3 + 1], dp[v * 3 + 2]);
      if (d2 > tolSq) { isKit[v] = 1; kitVerts++; }
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

    // Re-index kit triangles into a fresh mesh.
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
    kitMesh = decimateIfTooBig(kitMesh, MAX_KIT_TRIS_FOR_SPLIT);

    await admin.from("concepts")
      .update({ aero_kit_status: "splitting" })
      .eq("id", concept.id);

    // 5. Split into connected components, drop tiny ones, classify each.
    const allComponents = splitConnectedComponents(kitMesh);
    const components = allComponents
      .map((m) => ({ mesh: m, vol: approxVolume(m) }))
      .filter((c) => c.vol >= MIN_COMPONENT_VOLUME_MM3)
      .sort((a, b) => b.vol - a.vol);

    if (components.length === 0) {
      return fail(admin, concept.id, "All kit fragments below minimum volume — try a stronger concept silhouette.");
    }

    const carBb = meshBboxOf(stockMesh);

    // 6. Upload combined kit STL. Skip Laplacian smoothing — its full
    //    weld + adjacency-Set pass is the single biggest memory hog and
    //    consistently trips WORKER_RESOURCE_LIMIT on dense meshes.
    const combinedSmoothed = writeBinaryStl(kitMesh);
    const kitPath = `aero-kits/${concept.id}/kit.stl`;
    const { error: kitUpErr } = await admin.storage.from("car-stls")
      .upload(kitPath, combinedSmoothed, { contentType: "model/stl", upsert: true });
    if (kitUpErr) return fail(admin, concept.id, `Upload kit STL failed: ${kitUpErr.message}`);
    const { data: kitSigned } = await admin.storage.from("car-stls").createSignedUrl(kitPath, 60 * 60 * 24 * 365);

    // Clear any prior boolean-source parts so re-runs replace them.
    await admin.from("concept_parts")
      .delete().eq("concept_id", concept.id).eq("source", "boolean");

    // 7. Upload + insert per-component parts. Use kind+index for uniqueness.
    const kindCounts: Record<string, number> = {};
    const uploaded: { kind: PartKind; signed_url: string; volume_mm3: number; label: string }[] = [];
    for (const { mesh, vol } of components) {
      const partBb = meshBboxOf(mesh);
      const kind = classifyByZone(partBb, carBb);
      kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;
      const idx = kindCounts[kind];
      const partBytes = writeBinaryStl(mesh);
      const partPath = `aero-kits/${concept.id}/${kind}-${idx}.stl`;
      const { error: pErr } = await admin.storage.from("car-stls")
        .upload(partPath, partBytes, { contentType: "model/stl", upsert: true });
      if (pErr) {
        console.error(`upload part ${kind}-${idx} failed:`, pErr.message);
        continue;
      }
      const { data: signed } = await admin.storage.from("car-stls")
        .createSignedUrl(partPath, 60 * 60 * 24 * 365);
      const label = `${prettyKind(kind)} ${idx > 1 ? `(${idx})` : ""}`.trim();
      uploaded.push({ kind, signed_url: signed?.signedUrl ?? "", volume_mm3: vol, label });

      await admin.from("concept_parts").insert({
        user_id: userRes.user.id,
        project_id: concept.project_id,
        concept_id: concept.id,
        kind,
        label,
        glb_url: signed?.signedUrl ?? null,
        render_urls: [],
        source: "boolean",
      });
    }

    await admin.from("concepts").update({
      aero_kit_status: "ready",
      aero_kit_url: kitSigned?.signedUrl ?? null,
      aero_kit_error: null,
    }).eq("id", concept.id);

    return json({
      ok: true,
      kit_url: kitSigned?.signedUrl ?? null,
      part_count: uploaded.length,
      parts: uploaded,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function prettyKind(k: PartKind): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fail(admin: ReturnType<typeof createClient>, conceptId: string, message: string) {
  await admin.from("concepts").update({ aero_kit_status: "failed", aero_kit_error: message }).eq("id", conceptId);
  return json({ error: message }, 500);
}

/**
 * Cheap uniform triangle decimation: keep every Nth triangle until we're
 * under `maxTris`. Loses some shell quality but avoids edge-runtime OOM.
 * Vertices not referenced by kept triangles are pruned.
 */
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
