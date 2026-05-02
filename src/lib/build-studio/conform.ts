/**
 * conformKitToBody — surface projection conforming.
 *
 * Works entirely on deep-cloned geometry. Never touches the live scene mesh.
 * Returns a new THREE.BufferGeometry in world space that has been conformed
 * to the donor car surface. This geometry is passed directly into the CSG
 * evaluator, bypassing bakeLiveWorldGeometry.
 */
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { supabase } from "@/integrations/supabase/client";
import {
  getCarObject,
  getPlacedPartObject,
} from "@/lib/build-studio/scene-registry";
import type { AutofitPlacedPartInput, AutofitPlacedPartResult } from "@/lib/build-studio/autofit";

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface ConformOptions {
  proximityThreshold?: number; // metres, default 0.02
  gapM?: number;               // metres, default 0.008
  maxProjectionM?: number;     // metres, default 0.04
}

/** Bake world-space positions only (for BVH donor). */
function bakePositionsWorld(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) {
      if (k !== "position") g.deleteAttribute(k);
    }
    if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
    g.applyMatrix4(mesh.matrixWorld);
    parts.push(g);
  });
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return out;
}

/** Bake world-space positions + normals (for kit conform). */
function bakeFullWorld(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);
  const parts: THREE.BufferGeometry[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) {
      if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    }
    if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    parts.push(g);
  });
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    nor.set(g.attributes.normal.array as Float32Array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

/**
 * Returns a new world-space BufferGeometry of the kit with inner vertices
 * projected onto the car surface. The live scene is never touched.
 */
function buildConformedGeometry(
  kitRoot: THREE.Object3D,
  carRoot: THREE.Object3D,
  options: ConformOptions,
): THREE.BufferGeometry {
  const { proximityThreshold = 0.02, gapM = 0.008, maxProjectionM = 0.04 } = options;

  const carGeo = bakePositionsWorld(carRoot);
  const bvhMesh = new THREE.Mesh(carGeo);
  bvhMesh.geometry.boundsTree = new MeshBVH(carGeo);

  const kitGeo = bakeFullWorld(kitRoot);
  const posAttr = kitGeo.attributes.position as THREE.BufferAttribute;
  const normAttr = kitGeo.attributes.normal as THREE.BufferAttribute;
  const count = posAttr.count;

  const raycaster = new THREE.Raycaster();
  raycaster.far = maxProjectionM * 3;

  let projected = 0, skippedProx = 0, skippedDist = 0, skippedHit = 0;

  for (let i = 0; i < count; i++) {
    const vWorld = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    const nWorld = new THREE.Vector3().fromBufferAttribute(normAttr, i).normalize();

    // Proximity check.
    const hitInfo = bvhMesh.geometry.boundsTree!.closestPointToPoint(vWorld);
    if (!hitInfo || hitInfo.distance > proximityThreshold) { skippedProx++; continue; }

    // Cast inward along flipped normal.
    const origin = vWorld.clone().addScaledVector(nWorld, 0.005);
    raycaster.set(origin, nWorld.clone().negate());
    const hits = raycaster.intersectObject(bvhMesh);
    if (!hits.length) { skippedHit++; continue; }
    if (hits[0].distance > maxProjectionM) { skippedDist++; continue; }

    // Project to hit point + standoff outward along normal.
    const newPos = hits[0].point.clone().addScaledVector(nWorld, gapM);
    posAttr.setXYZ(i, newPos.x, newPos.y, newPos.z);
    projected++;
  }

  posAttr.needsUpdate = true;
  kitGeo.computeVertexNormals();
  kitGeo.computeBoundingBox();
  kitGeo.computeBoundingSphere();
  carGeo.dispose();

  console.log("[conform]", { projected, skippedProx, skippedDist, skippedHit });
  return kitGeo; // world-space, ready for CSG
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
      (err) => reject(new Error(`GLTFExporter: ${(err as any)?.message ?? err}`)),
      { binary: true, embedImages: false, onlyVisible: true } as Record<string, unknown>,
    );
  });
}

/**
 * Full conform + CSG pipeline. Completely self-contained.
 * Does NOT use bakeLiveWorldGeometry or touch the live scene.
 */
export async function conformAndFit(
  input: AutofitPlacedPartInput,
  options: ConformOptions = {},
): Promise<AutofitPlacedPartResult> {
  const start = performance.now();

  const kitRoot = getPlacedPartObject(input.placed_part_id);
  const carRoot = getCarObject();
  if (!kitRoot) throw new Error(`conform: no scene object for ${input.placed_part_id}`);
  if (!carRoot) throw new Error("conform: no car mesh in scene");

  // 1. Build conformed kit geometry in world space (clone — live mesh untouched).
  const kitGeo = buildConformedGeometry(kitRoot, carRoot, options);

  // 2. Build car geometry in world space.
  const carGeoForCsg = bakePositionsWorld(carRoot);
  carGeoForCsg.computeBoundingBox();
  if (!carGeoForCsg.attributes.normal) carGeoForCsg.computeVertexNormals();

  // 3. CSG: conformed kit minus car.
  const kitBrush = new Brush(kitGeo);
  kitBrush.updateMatrixWorld();
  const carBrush = new Brush(carGeoForCsg);
  carBrush.updateMatrixWorld();

  const evaluator = new Evaluator();
  evaluator.attributes = ["position", "normal"];
  evaluator.useGroups = false;
  const result = evaluator.evaluate(kitBrush, carBrush, SUBTRACTION) as Brush;

  // 4. Weld + clean normals.
  let resultGeo = result.geometry.clone();
  const welded = mergeVertices(resultGeo, 1e-4);
  if (welded !== resultGeo) resultGeo.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();

  kitGeo.dispose();
  carGeoForCsg.dispose();

  // 5. Export GLB.
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new THREE.Mesh(welded, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const blob = await exportGlb(scene);

  // 6. Upload to Supabase.
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? "anon";
  const path = `${userId}/${input.project_id}/autofit/${input.placed_part_id}-conform-${Date.now()}.glb`;
  const { error: upErr } = await supabase.storage
    .from("frozen-parts")
    .upload(path, blob, { contentType: "model/gltf-binary", upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const { data: urlData } = supabase.storage.from("frozen-parts").getPublicUrl(path);
  if (!urlData?.publicUrl) throw new Error("Failed to get public URL");

  // 7. Persist metadata.
  const processing_ms = Math.round(performance.now() - start);
  const nextMetadata = {
    ...((input.part.metadata as Record<string, unknown> | null) ?? {}),
    autofit_glb_url: urlData.publicUrl,
    autofit_part_kind: input.part_kind,
    autofit_processing_ms: processing_ms,
    autofit_at: new Date().toISOString(),
    autofit_frame: "world",
    autofit_source: "client-conform-csg",
  };
  const { error: dbErr } = await (supabase as any)
    .from("placed_parts")
    .update({ metadata: nextMetadata })
    .eq("id", input.placed_part_id);
  if (dbErr) throw new Error(`Failed to save metadata: ${dbErr.message}`);

  return {
    ok: true,
    placed_part_id: input.placed_part_id,
    result_url: urlData.publicUrl,
    part_kind: input.part_kind,
    processing_ms,
  };
}
