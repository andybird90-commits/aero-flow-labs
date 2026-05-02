/**
 * useAutofitPlacedPart — client-side CSG re-fit for a placed part.
 *
 * Previously this called the `bake-bodykit-from-shell` edge function, which
 * exported the live car + part as GLBs and ran a server-side boolean. That
 * round-trip is gone: the boolean now runs in the browser using
 * `three-bvh-csg`, which is purpose-built for Three.js meshes.
 *
 * Flow:
 *   1. Pull the *live* part + car Object3D from the scene registry.
 *   2. Bake their world transforms into geometry (so both sit in the same
 *      world frame as the viewport — exactly where the user dragged them).
 *   3. Run `Evaluator.evaluate(partBrush, carBrush, SUBTRACTION)` to trim
 *      the part where it intersects the car body.
 *   4. Export the result as a binary GLB.
 *   5. Upload to the public `frozen-parts` storage bucket.
 *   6. Persist the public URL onto `placed_parts.metadata.autofit_glb_url`
 *      so PartMesh swaps the rendered mesh on the next render.
 *
 * The viewport already strips the parent group's TRS when an autofit URL is
 * present (see PartMesh + BuildStudioViewport), so vertices baked into world
 * space land in the correct visual position with no further transform.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import {
  getCarObject,
  getPlacedPartObject,
} from "@/lib/build-studio/scene-registry";

export type AutofitPartKind =
  | "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser";

export interface AutofitPlacedPartInput {
  placed_part_id: string;
  part_kind: AutofitPartKind;
  /** project_id is used to invalidate the placed_parts query cache. */
  project_id: string;
  /** Donor car mesh URL — kept for API compatibility, no longer used. */
  car_url?: string;
  /** Library part GLB URL — kept for API compatibility, no longer used. */
  part_url?: string;
  /** Current placed part — read for transform/metadata logging. */
  part: PlacedPart;
}

export interface AutofitPlacedPartResult {
  ok: boolean;
  placed_part_id: string;
  result_url: string;
  part_kind?: string;
  processing_ms: number | null;
}

/**
 * Bake the live world matrix of every mesh under `liveRoot` into a single
 * merged BufferGeometry expressed in world coordinates. We merge so the CSG
 * evaluator sees one closed brush per side (it operates per-Mesh).
 */
function bakeLiveWorldGeometry(liveRoot: THREE.Object3D): THREE.BufferGeometry {
  liveRoot.updateWorldMatrix(true, true);

  const geometries: THREE.BufferGeometry[] = [];
  liveRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    const g = mesh.geometry.clone();
    // three-bvh-csg only needs position + normal; strip everything else so
    // attribute lists between brushes line up.
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    if (g.index) {
      // Convert to non-indexed so all geometries can be concatenated uniformly.
      const nonIndexed = g.toNonIndexed();
      g.dispose();
      // re-bind onto `g`'s slot via reassignment below
      const gn = nonIndexed;
      gn.applyMatrix4(mesh.matrixWorld);
      if (!gn.attributes.normal) gn.computeVertexNormals();
      geometries.push(gn);
      return;
    }
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    geometries.push(g);
  });

  if (geometries.length === 0) {
    throw new Error("No meshes found under live root");
  }

  // Manual concat (avoid pulling in BufferGeometryUtils): all geometries
  // are non-indexed with matching position + normal attributes.
  let totalVerts = 0;
  for (const g of geometries) totalVerts += g.attributes.position.count;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of geometries) {
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal.array as ArrayLike<number>;
    positions.set(p as any, offset * 3);
    normals.set(n as any, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function exportGlb(root: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: "model/gltf-binary" }));
        } else {
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) => reject(new Error(`GLTFExporter failed: ${(err as any)?.message ?? String(err)}`)),
      { binary: true, embedImages: false, onlyVisible: true } as Record<string, unknown>,
    );
  });
}

function logBbox(label: string, geom: THREE.BufferGeometry, extra: Record<string, unknown> = {}) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  // eslint-disable-next-line no-console
  console.log(label, {
    ...extra,
    vertexCount: geom.attributes.position.count,
    bbox: {
      min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
      max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
    },
  });
}

let cachedEvaluator: Evaluator | null = null;
function getEvaluator(): Evaluator {
  if (cachedEvaluator) return cachedEvaluator;
  const ev = new Evaluator();
  ev.attributes = ["position", "normal"];
  ev.useGroups = false;
  cachedEvaluator = ev;
  return ev;
}

/**
 * Keep only the largest connected component of `geom` (by triangle count),
 * plus any other components with >= `minRatio` of that triangle count.
 * This drops floating splinters left behind by CSG without removing
 * legitimate disjoint pieces (e.g. a multi-shell kit).
 *
 * Algorithm:
 *   1. mergeVertices() to weld coincident verts so faces share indices.
 *   2. Build adjacency: vertex -> triangles using it.
 *   3. Flood-fill triangles into components via shared vertices.
 *   4. Sort components by triangle count, keep those above threshold.
 *   5. Rebuild a non-indexed BufferGeometry from kept triangles.
 */
function keepLargestComponents(
  inputGeom: THREE.BufferGeometry,
  minRatio = 0.05,
): THREE.BufferGeometry {
  // Weld so connectivity reflects topology, not duplicated verts at seams.
  const welded = mergeVertices(inputGeom, 1e-5);
  if (!welded.index) {
    // mergeVertices should always produce an index; guard anyway.
    return inputGeom;
  }
  const indexAttr = welded.index;
  const indexArr = indexAttr.array as ArrayLike<number>;
  const triCount = indexArr.length / 3;
  const vertCount = welded.attributes.position.count;

  // vertex -> list of triangle indices
  const vertToTris: number[][] = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) vertToTris[i] = [];
  for (let t = 0; t < triCount; t++) {
    const a = indexArr[t * 3] as number;
    const b = indexArr[t * 3 + 1] as number;
    const c = indexArr[t * 3 + 2] as number;
    vertToTris[a].push(t);
    vertToTris[b].push(t);
    vertToTris[c].push(t);
  }

  const compOf = new Int32Array(triCount).fill(-1);
  const components: number[][] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (compOf[seed] !== -1) continue;
    const compId = components.length;
    const tris: number[] = [];
    stack.length = 0;
    stack.push(seed);
    compOf[seed] = compId;
    while (stack.length > 0) {
      const t = stack.pop() as number;
      tris.push(t);
      const a = indexArr[t * 3] as number;
      const b = indexArr[t * 3 + 1] as number;
      const c = indexArr[t * 3 + 2] as number;
      const neigh = [vertToTris[a], vertToTris[b], vertToTris[c]];
      for (const list of neigh) {
        for (let i = 0; i < list.length; i++) {
          const nt = list[i];
          if (compOf[nt] === -1) {
            compOf[nt] = compId;
            stack.push(nt);
          }
        }
      }
    }
    components.push(tris);
  }

  components.sort((a, b) => b.length - a.length);
  const largest = components[0]?.length ?? 0;
  if (largest === 0) return inputGeom;
  const threshold = Math.max(1, Math.floor(largest * minRatio));
  const kept = components.filter((c) => c.length >= threshold);

  const droppedTris = triCount - kept.reduce((s, c) => s + c.length, 0);
  // eslint-disable-next-line no-console
  console.log("[autofit] component cleanup", {
    components: components.length,
    kept: kept.length,
    largestTris: largest,
    threshold,
    droppedTris,
    totalTris: triCount,
  });

  if (kept.length === components.length && components.length === 1) {
    // Nothing to drop — return welded geom as-is (still cheaper downstream).
    return welded;
  }

  // Rebuild as non-indexed for the exporter / downstream simplicity.
  const posAttr = welded.attributes.position;
  const normAttr = welded.attributes.normal;
  const keptTriCount = kept.reduce((s, c) => s + c.length, 0);
  const positions = new Float32Array(keptTriCount * 9);
  const normals = normAttr ? new Float32Array(keptTriCount * 9) : null;
  let w = 0;
  for (const comp of kept) {
    for (const t of comp) {
      for (let k = 0; k < 3; k++) {
        const vi = indexArr[t * 3 + k] as number;
        positions[w] = posAttr.getX(vi);
        positions[w + 1] = posAttr.getY(vi);
        positions[w + 2] = posAttr.getZ(vi);
        if (normals && normAttr) {
          normals[w] = normAttr.getX(vi);
          normals[w + 1] = normAttr.getY(vi);
          normals[w + 2] = normAttr.getZ(vi);
        }
        w += 3;
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (normals) out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  welded.dispose();
  return out;
}

/**
 * Run the part − car boolean entirely client-side.
 * Returns a binary GLB blob whose vertices are in world coordinates.
 */
async function clientCsgRefit(input: AutofitPlacedPartInput): Promise<Blob> {
  const partMesh = getPlacedPartObject(input.placed_part_id);
  const carMesh = getCarObject();
  if (!partMesh) {
    throw new Error(
      `Autofit: no live scene object registered for placed_part_id=${input.placed_part_id}`,
    );
  }
  if (!carMesh) {
    throw new Error("Autofit: no live car mesh registered in the scene");
  }

  const partGeom = bakeLiveWorldGeometry(partMesh);
  const carGeom = bakeLiveWorldGeometry(carMesh);

  logBbox("[autofit] part baked (world)", partGeom, { placed_part_id: input.placed_part_id });
  logBbox("[autofit] car baked (world)", carGeom);

  // three-bvh-csg expects Brushes built from BufferGeometry. They share the
  // same world frame, so both brushes use identity matrices.
  const partBrush = new Brush(partGeom);
  partBrush.updateMatrixWorld();
  const carBrush = new Brush(carGeom);
  carBrush.updateMatrixWorld();

  const evaluator = getEvaluator();
  const result = evaluator.evaluate(partBrush, carBrush, SUBTRACTION) as Brush;

  const rawResultGeom = result.geometry.clone();
  rawResultGeom.computeBoundingBox();
  logBbox("[autofit] CSG raw result (world)", rawResultGeom);

  // Strip floating splinters left by the boolean.
  const resultGeom = keepLargestComponents(rawResultGeom, 0.05);
  rawResultGeom.dispose();
  resultGeom.computeVertexNormals();
  resultGeom.computeBoundingBox();
  resultGeom.computeBoundingSphere();
  logBbox("[autofit] CSG cleaned result (world)", resultGeom);

  // Wrap in a fresh Mesh + Scene for the exporter — vertices already encode
  // world position, so identity TRS is correct.
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new THREE.Mesh(resultGeom, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const blob = await exportGlb(scene);

  // Free CSG-side allocations.
  partGeom.dispose();
  carGeom.dispose();
  return blob;
}

async function uploadResultGlb(input: AutofitPlacedPartInput, blob: Blob): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? "anon";
  const path = `${userId}/${input.project_id}/autofit/${input.placed_part_id}-${Date.now()}.glb`;

  // `frozen-parts` is a public bucket, so the returned URL is directly
  // loadable by GLTFLoader without re-signing.
  const { error: upErr } = await supabase.storage
    .from("frozen-parts")
    .upload(path, blob, {
      contentType: "model/gltf-binary",
      upsert: false,
    });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data } = supabase.storage.from("frozen-parts").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Failed to resolve public URL for autofit result");
  return data.publicUrl;
}

export function useAutofitPlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AutofitPlacedPartInput): Promise<AutofitPlacedPartResult> => {
      const start = performance.now();
      const blob = await clientCsgRefit(input);
      const result_url = await uploadResultGlb(input, blob);
      const processing_ms = Math.round(performance.now() - start);

      // Persist on the placed_parts row so the metadata survives a reload.
      const nextMetadata = {
        ...((input.part.metadata as Record<string, unknown> | null) ?? {}),
        autofit_glb_url: result_url,
        autofit_part_kind: input.part_kind,
        autofit_processing_ms: processing_ms,
        autofit_at: new Date().toISOString(),
        autofit_frame: "world",
        autofit_source: "client-bvh-csg",
      };
      const { error: dbErr } = await (supabase as any)
        .from("placed_parts")
        .update({ metadata: nextMetadata })
        .eq("id", input.placed_part_id);
      if (dbErr) throw new Error(`Failed to save autofit metadata: ${dbErr.message}`);

      return {
        ok: true,
        placed_part_id: input.placed_part_id,
        result_url,
        part_kind: input.part_kind,
        processing_ms,
      };
    },
    onSuccess: async (data, vars) => {
      const queryKey = ["placed_parts", vars.project_id];

      // Optimistic cache patch so the viewport sees the new GLB immediately.
      qc.setQueryData<PlacedPart[]>(queryKey, (current) => {
        if (!current) return current;
        return current.map((part) => {
          if (part.id !== vars.placed_part_id) return part;
          return {
            ...part,
            metadata: {
              ...(part.metadata ?? {}),
              autofit_glb_url: data.result_url,
              autofit_part_kind: data.part_kind ?? vars.part_kind,
              autofit_processing_ms: data.processing_ms ?? null,
              autofit_at: new Date().toISOString(),
              autofit_frame: "world",
              autofit_source: "client-bvh-csg",
            },
          };
        });
      });

      await qc.invalidateQueries({ queryKey });
      await qc.refetchQueries({ queryKey, type: "active" });
    },
  });
}
