import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import {
  getCarObject,
  getPlacedPartObject,
} from "@/lib/build-studio/scene-registry";

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type AutofitPartKind =
  | "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser";

export interface AutofitPlacedPartInput {
  placed_part_id: string;
  part_kind: AutofitPartKind;
  project_id: string;
  car_url?: string;
  part_url?: string;
  part: PlacedPart;
}

export interface AutofitPlacedPartResult {
  ok: boolean;
  placed_part_id: string;
  result_url: string;
  part_kind?: string;
  processing_ms: number | null;
}

function bakeLiveWorldGeometry(liveRoot: THREE.Object3D): THREE.BufferGeometry {
  liveRoot.updateWorldMatrix(true, true);
  const geometries: THREE.BufferGeometry[] = [];
  liveRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    const g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    if (g.index) {
      const nonIndexed = g.toNonIndexed();
      g.dispose();
      nonIndexed.applyMatrix4(mesh.matrixWorld);
      if (!nonIndexed.attributes.normal) nonIndexed.computeVertexNormals();
      geometries.push(nonIndexed);
      return;
    }
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    geometries.push(g);
  });
  if (geometries.length === 0) throw new Error("No meshes found under live root");
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

let cachedEvaluator: Evaluator | null = null;
function getEvaluator(): Evaluator {
  if (cachedEvaluator) return cachedEvaluator;
  const ev = new Evaluator();
  ev.attributes = ["position", "normal"];
  ev.useGroups = false;
  cachedEvaluator = ev;
  return ev;
}

function keepLargestComponents(inputGeom: THREE.BufferGeometry): THREE.BufferGeometry {
  const welded = mergeVertices(inputGeom, 1e-5);
  if (!welded.index) return inputGeom;
  const indexAttr = welded.index;
  const indexArr = indexAttr.array as ArrayLike<number>;
  const triCount = indexArr.length / 3;
  const vertCount = welded.attributes.position.count;
  const vertToTris: number[][] = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) vertToTris[i] = [];
  for (let t = 0; t < triCount; t++) {
    vertToTris[indexArr[t * 3] as number].push(t);
    vertToTris[indexArr[t * 3 + 1] as number].push(t);
    vertToTris[indexArr[t * 3 + 2] as number].push(t);
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
      for (const k of [0, 1, 2]) {
        const vi = indexArr[t * 3 + k] as number;
        for (const nt of vertToTris[vi]) {
          if (compOf[nt] === -1) { compOf[nt] = compId; stack.push(nt); }
        }
      }
    }
    components.push(tris);
  }
  components.sort((a, b) => b.length - a.length);
  const kept = components.slice(0, 1);
  const posAttr = welded.attributes.position;
  const normAttr = welded.attributes.normal;
  const keptTriCount = kept[0].length;
  const positions = new Float32Array(keptTriCount * 9);
  const normals = normAttr ? new Float32Array(keptTriCount * 9) : null;
  let w = 0;
  for (const t of kept[0]) {
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
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (normals) out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  welded.dispose();
  return out;
}

async function clientCsgRefit(input: AutofitPlacedPartInput): Promise<Blob> {
  const partMesh = getPlacedPartObject(input.placed_part_id);
  const carMesh = getCarObject();
  if (!partMesh) throw new Error(`Autofit: no live scene object for placed_part_id=${input.placed_part_id}`);
  if (!carMesh) throw new Error("Autofit: no live car mesh registered in scene");

  const partGeom = bakeLiveWorldGeometry(partMesh);
  const carGeom = bakeLiveWorldGeometry(carMesh);

  const partBrush = new Brush(partGeom);
  partBrush.updateMatrixWorld();
  const carBrush = new Brush(carGeom);
  carBrush.updateMatrixWorld();

  const evaluator = getEvaluator();
  const result = evaluator.evaluate(partBrush, carBrush, SUBTRACTION) as Brush;

  const rawResultGeom = result.geometry.clone();

  // Sanity check: if CSG returned nearly nothing (or vastly less than the
  // input part), the car mesh is non-manifold and the inside/outside test
  // flipped — fall back to a per-triangle inside-test trim that only drops
  // part triangles whose centroid lies inside the car volume.
  const inputTris = partGeom.attributes.position.count / 3;
  const outputTris = rawResultGeom.attributes.position.count / 3;
  const survivalRatio = inputTris > 0 ? outputTris / inputTris : 0;
  // eslint-disable-next-line no-console
  console.log("[autofit] CSG survival", { inputTris, outputTris, survivalRatio });

  let trimmedGeom: THREE.BufferGeometry;
  if (survivalRatio < 0.3) {
    // eslint-disable-next-line no-console
    console.warn("[autofit] CSG result too small — falling back to per-triangle inside-test trim");
    rawResultGeom.dispose();
    trimmedGeom = trimTrianglesInsideCar(partGeom, carGeom);
  } else {
    trimmedGeom = keepLargestComponents(rawResultGeom);
    rawResultGeom.dispose();
  }

  const welded = mergeVertices(trimmedGeom, 1e-4);
  if (welded !== trimmedGeom) trimmedGeom.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new THREE.Mesh(welded, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const blob = await exportGlb(scene);
  partGeom.dispose();
  carGeom.dispose();
  return blob;
}

/**
 * Per-triangle trim using BVH raycast parity. Drops part triangles whose
 * centroid lies inside the car volume; keeps everything else untouched.
 * Robust against non-manifold car meshes that break CSG SUBTRACTION.
 */
function trimTrianglesInsideCar(
  partGeom: THREE.BufferGeometry,
  carGeom: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const carMesh = new THREE.Mesh(carGeom);
  carMesh.geometry.boundsTree = new MeshBVH(carGeom);

  const pos = partGeom.attributes.position;
  const triCount = pos.count / 3;

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = false as unknown as boolean; // we want all hits for parity
  const dir = new THREE.Vector3(1, 0.0001, 0.0001).normalize();

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  const keptPositions: number[] = [];
  let dropped = 0;

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);

    ray.set(centroid, dir);
    const hits = ray.intersectObject(carMesh, false);
    // Odd number of hits along outward ray => point is inside the car volume.
    const inside = hits.length % 2 === 1;

    if (inside) {
      dropped++;
      continue;
    }
    keptPositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  // eslint-disable-next-line no-console
  console.log("[autofit] per-triangle trim", { triCount, dropped, kept: triCount - dropped });

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(keptPositions), 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

async function uploadResultGlb(input: AutofitPlacedPartInput, blob: Blob): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? "anon";
  const path = `${userId}/${input.project_id}/autofit/${input.placed_part_id}-${Date.now()}.glb`;
  const { error: upErr } = await supabase.storage
    .from("frozen-parts")
    .upload(path, blob, { contentType: "model/gltf-binary", upsert: false });
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
      return { ok: true, placed_part_id: input.placed_part_id, result_url, part_kind: input.part_kind, processing_ms };
    },
    onSuccess: async (data, vars) => {
      const queryKey = ["placed_parts", vars.project_id];
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
