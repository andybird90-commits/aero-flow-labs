/**
 * conformKitToBody — surface projection conforming.
 *
 * For each vertex on the kit mesh that is within `proximityThreshold` metres
 * of the donor car surface, cast a ray inward toward the kit bounding-box
 * centre. If the ray hits the car, move that vertex to the hit point plus a
 * small standoff gap. Vertices further away than the threshold (outer styling
 * surface detail) are left untouched so the kit's design is preserved.
 *
 * This runs entirely client-side using three-mesh-bvh — same dependency
 * already used by three-bvh-csg, so no new packages are needed.
 */
import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import {
  getCarObject,
  getPlacedPartObject,
} from "@/lib/build-studio/scene-registry";

// Patch Three.js Mesh.raycast so BVH acceleration is used automatically.
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface ConformOptions {
  /** Vertices closer than this (metres) to the car surface will be projected. Default 0.05 (5 cm). */
  proximityThreshold?: number;
  /** Standoff gap between projected vertex and car surface (metres). Default 0.002 (2 mm). */
  gapM?: number;
}

/**
 * Bake world matrix into a single merged non-indexed BufferGeometry.
 * Strips all attributes except position so the BVH is lean.
 */
function bakeWorldPositions(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);
  const geometries: THREE.BufferGeometry[] = [];

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
    // Keep only position for the BVH donor mesh.
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position") g.deleteAttribute(name);
    }
    if (g.index) {
      const ni = g.toNonIndexed();
      g.dispose();
      g = ni;
    }
    g.applyMatrix4(mesh.matrixWorld);
    geometries.push(g);
  });

  if (geometries.length === 0) throw new Error("conform: no meshes under root");

  let totalVerts = 0;
  for (const g of geometries) totalVerts += g.attributes.position.count;
  const positions = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of geometries) {
    positions.set(g.attributes.position.array as Float32Array, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return out;
}

/**
 * Main conform function. Mutates the kit mesh geometry in place.
 * Returns the number of vertices that were projected.
 */
export function conformKitToBody(
  kitRoot: THREE.Object3D,
  carRoot: THREE.Object3D,
  options: ConformOptions = {},
): number {
  const { proximityThreshold = 0.05, gapM = 0.002 } = options;

  // Build a BVH over the donor car in world space.
  const carGeo = bakeWorldPositions(carRoot);
  carGeo.computeBoundingBox();
  const bvhMesh = new THREE.Mesh(carGeo);
  (bvhMesh.geometry as any).boundsTree = new MeshBVH(carGeo);

  // Kit bounding box centre — used as the inward ray target.
  kitRoot.updateWorldMatrix(true, true);
  const kitBox = new THREE.Box3().setFromObject(kitRoot);
  const kitCentre = kitBox.getCenter(new THREE.Vector3());

  let projectedCount = 0;
  const raycaster = new THREE.Raycaster();
  // Extend ray range well beyond any car dimension.
  raycaster.far = 20;

  // Walk every mesh under the kit root and deform matching vertices.
  kitRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;

    mesh.updateWorldMatrix(true, false);
    const worldInv = mesh.matrixWorld.clone().invert();
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < posAttr.count; i++) {
      // Vertex in world space.
      const vWorld = new THREE.Vector3()
        .fromBufferAttribute(posAttr, i)
        .applyMatrix4(mesh.matrixWorld);

      // Quick proximity pre-check using BVH's closestPointToPoint.
      const closest = new THREE.Vector3();
      const closestResult = (bvhMesh.geometry as any).boundsTree.closestPointToPoint(
        vWorld,
        { point: closest },
      );
      const dist = closestResult ? closestResult.distance : vWorld.distanceTo(closest);
      if (dist > proximityThreshold) continue; // outer surface — leave it

      // Ray from vertex toward kit centre (inward).
      const dir = kitCentre.clone().sub(vWorld).normalize();
      raycaster.set(vWorld, dir);
      const hits = raycaster.intersectObject(bvhMesh);
      if (hits.length === 0) continue;

      // Project vertex to hit point + standoff gap (away from car surface).
      const newWorld = hits[0].point.clone().addScaledVector(dir, -gapM);

      // Convert back to mesh local space.
      const newLocal = newWorld.applyMatrix4(worldInv);
      posAttr.setXYZ(i, newLocal.x, newLocal.y, newLocal.z);
      projectedCount++;
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });

  carGeo.dispose();
  console.log(`[conform] projected ${projectedCount} vertices`);
  return projectedCount;
}

/**
 * Hook-friendly wrapper that resolves the live scene objects by ID,
 * runs conform, then returns the mutated kitRoot ready for autofit.
 * Throws if either object is not registered.
 */
export function conformPlacedPartToBody(
  placedPartId: string,
  options: ConformOptions = {},
): THREE.Object3D {
  const kitRoot = getPlacedPartObject(placedPartId);
  const carRoot = getCarObject();
  if (!kitRoot) throw new Error(`conform: no scene object for placed_part_id=${placedPartId}`);
  if (!carRoot) throw new Error("conform: no car mesh registered in scene");
  conformKitToBody(kitRoot, carRoot, options);
  return kitRoot;
}
