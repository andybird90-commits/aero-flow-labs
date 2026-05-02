import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import {
  getCarObject,
  getPlacedPartObject,
} from "@/lib/build-studio/scene-registry";

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface ConformOptions {
  /** Only project vertices within this distance of the car surface (metres). Default 0.02. */
  proximityThreshold?: number;
  /** Standoff gap from car surface (metres). Default 0.002. */
  gapM?: number;
  /** Skip projection if the hit point is further than this from the vertex (metres). Default 0.04. */
  maxProjectionM?: number;
}

function bakeWorldPositions(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);
  const geometries: THREE.BufferGeometry[] = [];

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
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

function bakeWorldGeometryFull(root: THREE.Object3D): THREE.BufferGeometry {
  // Same as above but also preserves normals — needed for ray direction.
  root.updateWorldMatrix(true, true);
  const geometries: THREE.BufferGeometry[] = [];

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    let g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    if (g.index) {
      const ni = g.toNonIndexed();
      g.dispose();
      g = ni;
    }
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    geometries.push(g);
  });

  if (geometries.length === 0) throw new Error("conform: no meshes under root");

  let totalVerts = 0;
  for (const g of geometries) totalVerts += g.attributes.position.count;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of geometries) {
    positions.set(g.attributes.position.array as Float32Array, offset * 3);
    normals.set(g.attributes.normal.array as Float32Array, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return out;
}

export function conformKitToBody(
  kitRoot: THREE.Object3D,
  carRoot: THREE.Object3D,
  options: ConformOptions = {},
): number {
  const {
    proximityThreshold = 0.02,
    gapM = 0.002,
    maxProjectionM = 0.04,
  } = options;

  // Build BVH over donor car in world space.
  const carGeo = bakeWorldPositions(carRoot);
  carGeo.computeBoundingBox();
  const bvhMesh = new THREE.Mesh(carGeo);
  bvhMesh.geometry.boundsTree = new MeshBVH(carGeo);

  // Bake kit geometry including normals for ray direction.
  const kitGeoWorld = bakeWorldGeometryFull(kitRoot);
  const kitPosAttr = kitGeoWorld.attributes.position as THREE.BufferAttribute;
  const kitNormAttr = kitGeoWorld.attributes.normal as THREE.BufferAttribute;

  let projectedCount = 0;
  let skippedProximity = 0;
  let skippedDistance = 0;
  let skippedNoHit = 0;

  const raycaster = new THREE.Raycaster();
  raycaster.far = maxProjectionM * 3;

  // We operate on the baked world-space geometry vertex by vertex,
  // then write back into the kit's local geometry.
  // Since kitRoot may have child meshes, we need to track vertex offset.
  let vertexOffset = 0;

  kitRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;

    mesh.updateWorldMatrix(true, false);
    const meshWorldInv = mesh.matrixWorld.clone().invert();
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const normAttr = geo.attributes.normal as THREE.BufferAttribute;
    const vertCount = posAttr.count;

    for (let i = 0; i < vertCount; i++) {
      const wi = vertexOffset + i;

      const vWorld = new THREE.Vector3(
        kitPosAttr.getX(wi),
        kitPosAttr.getY(wi),
        kitPosAttr.getZ(wi),
      );

      // Proximity check — skip outer surface vertices.
      const hitInfo = bvhMesh.geometry.boundsTree!.closestPointToPoint(vWorld);
      if (!hitInfo) {
        skippedProximity++;
        continue;
      }
      const dist = hitInfo.distance;
      if (dist > proximityThreshold) {
        skippedProximity++;
        continue;
      }

      // Ray direction: flip the world-space vertex normal to point inward.
      const nWorld = new THREE.Vector3(
        kitNormAttr.getX(wi),
        kitNormAttr.getY(wi),
        kitNormAttr.getZ(wi),
      ).normalize();
      // Inward = negative normal direction (toward car body).
      const dir = nWorld.clone().negate();

      // Offset ray origin slightly outward so it doesn't self-intersect.
      const origin = vWorld.clone().addScaledVector(nWorld, 0.005);
      raycaster.set(origin, dir);

      const hits = raycaster.intersectObject(bvhMesh);
      if (hits.length === 0) {
        skippedNoHit++;
        continue;
      }

      const hitDist = hits[0].distance;
      if (hitDist > maxProjectionM) {
        skippedDistance++;
        continue;
      }

      // Project to hit point + standoff gap outward along normal.
      const newWorld = hits[0].point.clone().addScaledVector(nWorld, gapM);

      // Write back into mesh local space.
      const newLocal = newWorld.applyMatrix4(meshWorldInv);
      posAttr.setXYZ(i, newLocal.x, newLocal.y, newLocal.z);
      projectedCount++;
    }

    posAttr.needsUpdate = true;
    if (normAttr) normAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    vertexOffset += vertCount;
  });

  carGeo.dispose();
  kitGeoWorld.dispose();

  console.log("[conform] done", {
    projected: projectedCount,
    skippedProximity,
    skippedDistance,
    skippedNoHit,
  });

  return projectedCount;
}

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
