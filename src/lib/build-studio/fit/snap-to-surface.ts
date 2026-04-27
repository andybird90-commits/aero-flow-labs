/**
 * Snap a part's vertices onto the base body surface along the inward normal,
 * with a configurable offset.
 *
 * Pipeline:
 *   1. Find the closest body point for each vertex (surface-only; no manifold
 *      or watertight assumptions).
 *   2. Treat only the nearest/contact-side band as deformable.
 *   3. Move the rest of the mesh by the average contact displacement so the
 *      part keeps its thickness instead of collapsing every vertex to the car.
 *   4. If no hit within `maxDistance`, leave the vertex untouched.
 *
 * This is a *visual* fit, not a manifold guarantee. For a printable result the
 * worker still does the proper Blender solidify + manifold pass.
 *
 * Pure function — safe to call from the main thread or a web worker.
 */
import * as THREE from "three";
import { MeshBVH, getTriangleHitPointInfo } from "three-mesh-bvh";

export interface SnapOptions {
  /** Body offset in metres (positive = pushed away from body surface). */
  offsetM: number;
  /**
   * Max ray distance in metres. Vertices with no hit inside this radius
   * are left in their original position (prevents wild stretches).
   */
  maxDistance?: number;
  /**
   * Optional axis-aligned mask (e.g. only project +X side). Vertices whose
   * `position.dot(maskAxis) < maskMin` are skipped.
   */
  maskAxis?: THREE.Vector3;
  maskMin?: number;
}

export interface SnapInputs {
  /** Part geometry in the same world frame as the base BVH. */
  partGeometry: THREE.BufferGeometry;
  /** Base body BVH (must be in the same world frame as partGeometry). */
  baseBVH: MeshBVH;
}

/**
 * Returns a *new* BufferGeometry with snapped positions. The original is left
 * untouched so the caller can revert (e.g. toggling Live Fit off).
 */
export function snapToSurface(
  { partGeometry, baseBVH }: SnapInputs,
  opts: SnapOptions,
): THREE.BufferGeometry {
  const out = partGeometry.clone();
  const positions = out.attributes.position as THREE.BufferAttribute;
  const normals = out.attributes.normal as THREE.BufferAttribute | undefined;
  if (!normals) {
    out.computeVertexNormals();
  }
  const norm = out.attributes.normal as THREE.BufferAttribute;

  const maxDist = opts.maxDistance ?? 0.25;
  const offset = opts.offsetM;

  const v = new THREE.Vector3();
  const closest: any = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const triInfo: any = { face: { normal: new THREE.Vector3() }, uv: new THREE.Vector2() };

  out.computeBoundingBox();
  const size = new THREE.Vector3();
  out.boundingBox?.getSize(size);
  const longest = Math.max(size.x, size.y, size.z, 0.05);
  const contactBand = THREE.MathUtils.clamp(longest * 0.18, 0.025, 0.12);
  const falloffBand = contactBand * 1.6;
  const maxMove = Math.min(maxDist, Math.max(0.08, longest * 0.7));

  const hits: Array<{
    hit: boolean;
    distance: number;
    target: THREE.Vector3;
    delta: THREE.Vector3;
  }> = [];
  const hitDistances: number[] = [];
  let minDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);

    if (opts.maskAxis && typeof opts.maskMin === "number") {
      if (v.dot(opts.maskAxis) < opts.maskMin) {
        hits.push({ hit: false, distance: Number.POSITIVE_INFINITY, target: v.clone(), delta: new THREE.Vector3() });
        continue;
      }
    }

    const best = baseBVH.closestPointToPoint(v, closest, 0, maxDist) as any;

    if (best) {
      getTriangleHitPointInfo(best.point, baseBVH.geometry, best.faceIndex, triInfo);
      const surfaceNormal = triInfo.face.normal as THREE.Vector3;
      surfaceNormal.normalize();

      // Non-manifold GLBs often contain open panels, separate trim pieces, or
      // inconsistent winding. Orient the offset normal toward the vertex itself
      // instead of trusting mesh winding, then move mostly along that normal.
      // This avoids tangential "nearest point" pulls that create saw-tooth
      // spikes on arches and split body panels.
      const toVertex = v.clone().sub(best.point);
      if (toVertex.lengthSq() > 1e-12 && surfaceNormal.dot(toVertex) < 0) {
        surfaceNormal.multiplyScalar(-1);
      }
      const signedSeparation = toVertex.dot(surfaceNormal);
      const delta = surfaceNormal.clone().multiplyScalar(offset - signedSeparation);
      const newPos = v.clone().add(delta);
      const distance = typeof best.distance === "number" ? best.distance : delta.length();
      minDistance = Math.min(minDistance, distance);
      hitDistances.push(distance);
      hits.push({ hit: true, distance, target: newPos, delta });
    } else {
      hits.push({ hit: false, distance: Number.POSITIVE_INFINITY, target: v.clone(), delta: new THREE.Vector3() });
    }
  }

  if (!Number.isFinite(minDistance)) {
    return out;
  }

  const contactLimit = minDistance + contactBand;
  const averageDelta = new THREE.Vector3();
  let contactCount = 0;
  for (const h of hits) {
    if (h.hit && h.distance <= contactLimit) {
      averageDelta.add(h.delta);
      contactCount++;
    }
  }
  if (contactCount > 0) averageDelta.multiplyScalar(1 / contactCount);
  if (averageDelta.length() > maxMove) averageDelta.setLength(maxMove);

  const snapped = new Float32Array(positions.array.length);
  const blendedDelta = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    const h = hits[i];

    if (h.hit) {
      const conformWeight = 1 - smoothstep(contactLimit, contactLimit + falloffBand, h.distance);
      blendedDelta.copy(averageDelta).lerp(h.delta, conformWeight);
      if (blendedDelta.length() > maxMove) blendedDelta.setLength(maxMove);
      v.add(blendedDelta);
    } else if (contactCount > 0 && (!opts.maskAxis || typeof opts.maskMin !== "number" || v.dot(opts.maskAxis) >= opts.maskMin)) {
      v.add(averageDelta);
    }

    snapped[i * 3 + 0] = v.x;
    snapped[i * 3 + 1] = v.y;
    snapped[i * 3 + 2] = v.z;
  }

  out.setAttribute("position", new THREE.BufferAttribute(snapped, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
