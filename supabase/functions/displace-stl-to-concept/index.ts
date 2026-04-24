/**
 * displace-stl-to-concept
 *
 * Pushes the hero-car STL outward wherever the approved concept silhouette
 * extends past the stock body, and uploads the result as `displaced.stl`.
 *
 * Strategy:
 *   1. Load repaired hero STL + reorient to canonical -Z forward / +Y up.
 *   2. Subdivide kit zones (front/rear bumpers, arches, underfloor) so wings
 *      and lips have surface to push into.
 *   3. For each of 4 fixed cameras:
 *      a. Rasterise the stock silhouette mask.
 *      b. Fetch the concept render and threshold it into a silhouette mask.
 *      c. Compute the "delta" mask = concept ∧ ¬stock (concept covers, stock doesn't).
 *      d. For every vertex whose camera-space projection falls inside the delta
 *         mask, accumulate an outward displacement along the camera ray
 *         direction, capped to 120 mm.
 *   4. Apply the max accumulated displacement to each vertex.
 *   5. Upload the displaced mesh and update `concepts.aero_kit_status`.
 *
 * Body: { concept_id: string }
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { parseStl, writeBinaryStl, type Mesh } from "../_shared/stl-io.ts";
import {
  ANGLE_KEYS, renderAngle, reorientMesh, projectPoint, meshBbox,
  type AngleKey, type ForwardAxis,
} from "../_shared/stl-render-server.ts";
import { kitZones, subdivideZones } from "../_shared/stl-subdivide.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RENDER_SIZE = 512;
const DISPLACEMENT_CAP_MM = 120;
const SUBDIV_TARGET_MM = 25; // 5mm is ideal but explodes triangle count; 25mm is a safe baseline.
// Cap input triangles before subdivision so the worker stays inside its
// 256 MB / 400ms budget on dense scraped meshes.
const MAX_INPUT_TRIS = 80_000;
const MAX_AFTER_SUBDIV_TRIS = 200_000;

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

    // 1. Load concept + project + car_template + car_stl row.
    const { data: concept, error: cErr } = await admin
      .from("concepts").select("*").eq("id", body.concept_id).maybeSingle();
    if (cErr || !concept) return json({ error: "concept not found" }, 404);
    if (concept.user_id !== userRes.user.id) return json({ error: "Forbidden" }, 403);

    const { data: project, error: pErr } = await admin
      .from("projects").select("*, car:cars(template_id)").eq("id", concept.project_id).maybeSingle();
    if (pErr || !project) return json({ error: "project not found" }, 404);
    const templateId = (project as any).car?.template_id;
    if (!templateId) return json({ error: "Project car has no template" }, 400);

    const { data: stlRow, error: sErr } = await admin
      .from("car_stls").select("*").eq("car_template_id", templateId).maybeSingle();
    if (sErr || !stlRow) return json({ error: "Hero STL not uploaded for this car" }, 400);
    if (!stlRow.repaired_stl_path) return json({ error: "Hero STL not repaired yet" }, 400);

    await admin.from("concepts").update({ aero_kit_status: "displacing", aero_kit_error: null }).eq("id", concept.id);

    // 2. Download stock STL, parse, reorient, subdivide kit zones.
    const { data: stlBlob, error: dlErr } = await admin.storage
      .from("car-stls").download(stlRow.repaired_stl_path);
    if (dlErr || !stlBlob) return fail(admin, concept.id, `Stock STL download failed: ${dlErr?.message ?? "unknown"}`);
    const stockBytes = new Uint8Array(await stlBlob.arrayBuffer());
    let stockMesh: Mesh = parseStl(stockBytes);
    if (stockMesh.positions.length === 0) return fail(admin, concept.id, "Stock STL parsed empty");
    stockMesh = reorientMesh(stockMesh, (stlRow.forward_axis as ForwardAxis) ?? "-z");
    stockMesh = decimateIfTooBig(stockMesh, MAX_INPUT_TRIS);

    const stockBb = meshBbox(stockMesh);
    const zones = kitZones({ min: stockBb.min, max: stockBb.max });
    // Skip subdivision if even the un-subdivided mesh is already dense; the
    // displacement still works, just with coarser kit detail.
    const subdivided = stockMesh.indices.length / 3 > MAX_AFTER_SUBDIV_TRIS / 4
      ? stockMesh
      : subdivideZones(stockMesh, zones, SUBDIV_TARGET_MM);

    // 3. Rasterise stock silhouette per angle + fetch concept silhouette.
    const conceptUrls: Partial<Record<AngleKey, string | null>> = {
      front_three_quarter: concept.render_front_url,
      side: concept.render_side_url,
      rear_three_quarter: (concept as any).render_rear34_url ?? null,
      rear: concept.render_rear_url,
    };

    const views: { angle: AngleKey; deltaMask: Uint8Array; viewProj: Float32Array; eye: [number, number, number] }[] = [];
    for (const angle of ANGLE_KEYS) {
      const url = conceptUrls[angle];
      if (!url) continue;
      const stockView = renderAngle(subdivided, angle, RENDER_SIZE);
      let conceptMask: Uint8Array;
      try {
        conceptMask = await fetchConceptSilhouette(url, RENDER_SIZE);
      } catch (e) {
        console.error(`concept silhouette fetch failed (${angle}):`, e);
        continue;
      }
      // delta = concept covers ∧ stock doesn't.
      const delta = new Uint8Array(stockView.mask.length);
      for (let i = 0; i < delta.length; i++) {
        delta[i] = (conceptMask[i] === 1 && stockView.mask[i] === 0) ? 1 : 0;
      }
      views.push({ angle, deltaMask: delta, viewProj: stockView.viewProj, eye: stockView.eye });
    }

    if (views.length === 0) {
      return fail(admin, concept.id, "No usable concept renders to compare against");
    }

    // 4. Per-vertex displacement accumulator: for each vertex, find its
    //    projected pixel in each view; if that pixel lies in the delta mask,
    //    move the vertex outward (away from the camera, along its outward
    //    direction = vertex − bbox_centre projected onto the camera ray).
    const positions = new Float32Array(subdivided.positions); // mutable copy
    const cx = stockBb.centre[0], cy = stockBb.centre[1], cz = stockBb.centre[2];
    const vCount = positions.length / 3;
    const accumDx = new Float32Array(vCount);
    const accumDy = new Float32Array(vCount);
    const accumDz = new Float32Array(vCount);

    for (const view of views) {
      const { deltaMask, viewProj, eye } = view;
      // Distance ramp inside the delta mask: pixels deepest inside the mask
      // get the strongest push. Compute by chebyshev-ish distance to nearest
      // mask=0 pixel using a single 8-pass pseudo-distance approximation.
      const dist = approxInsideDistance(deltaMask, RENDER_SIZE);

      for (let vi = 0; vi < vCount; vi++) {
        const x = positions[vi * 3], y = positions[vi * 3 + 1], z = positions[vi * 3 + 2];
        const proj = projectPoint(viewProj, RENDER_SIZE, x, y, z);
        if (proj.px < 0 || proj.py < 0 || proj.px >= RENDER_SIZE || proj.py >= RENDER_SIZE) continue;
        const px = Math.floor(proj.px), py = Math.floor(proj.py);
        const idx = py * RENDER_SIZE + px;
        if (deltaMask[idx] === 0) continue;
        const strength = Math.min(1, dist[idx] / 12); // 12px ≈ saturate
        if (strength <= 0) continue;

        // Outward direction: away from bbox centre AND away from camera eye
        // (so vertices on the far side of the car aren't pushed by a
        // near-side delta). Use centre→vertex direction as the primary push;
        // if it points toward the camera, skip.
        let dx = x - cx, dy = y - cy, dz = z - cz;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        // Reject back-facing vertices: their outward dir points away from camera.
        const camDx = eye[0] - x, camDy = eye[1] - y, camDz = eye[2] - z;
        const camLen = Math.hypot(camDx, camDy, camDz) || 1;
        const facing = (dx * camDx + dy * camDy + dz * camDz) / camLen;
        if (facing < 0.05) continue; // vertex is on the back side of the car relative to this camera

        const push = strength * DISPLACEMENT_CAP_MM;
        // Accumulate the maximum, not the sum, so multiple cameras don't blow up.
        const cur = Math.hypot(accumDx[vi], accumDy[vi], accumDz[vi]);
        if (push > cur) {
          accumDx[vi] = dx * push;
          accumDy[vi] = dy * push;
          accumDz[vi] = dz * push;
        }
      }
    }

    for (let vi = 0; vi < vCount; vi++) {
      positions[vi * 3]     += accumDx[vi];
      positions[vi * 3 + 1] += accumDy[vi];
      positions[vi * 3 + 2] += accumDz[vi];
    }

    const displacedMesh: Mesh = { positions, indices: subdivided.indices };
    const displacedBytes = writeBinaryStl(displacedMesh);

    const displacedPath = `displaced/${concept.id}.stl`;
    const { error: upErr } = await admin.storage.from("car-stls")
      .upload(displacedPath, displacedBytes, { contentType: "model/stl", upsert: true });
    if (upErr) return fail(admin, concept.id, `Upload displaced STL failed: ${upErr.message}`);

    await admin.from("concepts").update({ aero_kit_status: "displaced", aero_kit_error: null }).eq("id", concept.id);

    return json({
      ok: true,
      displaced_path: displacedPath,
      stats: {
        triangle_count: displacedMesh.indices.length / 3,
        vertex_count: vCount,
        views_used: views.map((v) => v.angle),
        displacement_cap_mm: DISPLACEMENT_CAP_MM,
      },
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

/**
 * Fetch a concept render PNG/JPEG and return a binary silhouette mask the same
 * size as the stock-render output. We use ImageScript (pure-Deno PNG/JPEG) so
 * we don't need native canvas.
 */
async function fetchConceptSilhouette(url: string, size: number): Promise<Uint8Array> {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  const img = await Image.decode(buf);
  img.resize(size, size);

  // Threshold: anything darker than its corner background = body. We sample the
  // 4 corners as the assumed background colour (concept renders use a clean BG)
  // and treat any pixel whose luminance differs by > 18% as body.
  const data = img.bitmap; // Uint8Array RGBA
  const w = img.width, h = img.height;
  const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  const corners = [
    lum(0),
    lum((w - 1) * 4),
    lum((h - 1) * w * 4),
    lum(((h - 1) * w + (w - 1)) * 4),
  ];
  const bg = corners.reduce((a, b) => a + b, 0) / corners.length;

  const mask = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * w + px) * 4;
      const l = lum(i);
      if (Math.abs(l - bg) > 46) mask[py * size + px] = 1;
    }
  }
  return mask;
}

/**
 * Approximate "distance to nearest 0" inside a binary mask via 2 chamfer
 * passes. Returns a Float32 buffer (0 outside the mask, ~px inside it).
 */
function approxInsideDistance(mask: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] === 0 ? 0 : 1e6;
  // Forward pass.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (out[i] === 0) continue;
      let v = out[i];
      if (x > 0)              v = Math.min(v, out[i - 1] + 1);
      if (y > 0)              v = Math.min(v, out[i - size] + 1);
      if (x > 0 && y > 0)     v = Math.min(v, out[i - size - 1] + 1.4);
      if (x < size - 1 && y > 0) v = Math.min(v, out[i - size + 1] + 1.4);
      out[i] = v;
    }
  }
  // Backward pass.
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (out[i] === 0) continue;
      let v = out[i];
      if (x < size - 1)            v = Math.min(v, out[i + 1] + 1);
      if (y < size - 1)            v = Math.min(v, out[i + size] + 1);
      if (x < size - 1 && y < size - 1) v = Math.min(v, out[i + size + 1] + 1.4);
      if (x > 0 && y < size - 1)   v = Math.min(v, out[i + size - 1] + 1.4);
      out[i] = v;
    }
  }
  return out;
}
