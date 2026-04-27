/**
 * Snap a part's vertices onto the base body surface along the inward normal,
 * with a configurable offset.
 *
 * Pipeline per vertex:
 *   1. Cast a ray from the vertex along its outward normal (both + and -).
 *   2. Take the closer hit on the base BVH.
 *   3. Move the vertex to `hit.point + hit.normal * offsetMm`.
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
  const n = new THREE.Vector3();
  const closest: any = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const triInfo: any = { face: { normal: new THREE.Vector3() }, uv: new THREE.Vector2() };

  const snapped = new Float32Array(positions.array.length);
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    n.fromBufferAttribute(norm, i).normalize();

    if (opts.maskAxis && typeof opts.maskMin === "number") {
      if (v.dot(opts.maskAxis) < opts.maskMin) {
        snapped[i * 3 + 0] = v.x;
        snapped[i * 3 + 1] = v.y;
        snapped[i * 3 + 2] = v.z;
        continue;
      }
    }

    const best = baseBVH.closestPointToPoint(v, closest, 0, maxDist) as any;

    if (best) {
      getTriangleHitPointInfo(best.point, baseBVH.geometry, best.faceIndex, triInfo);
      const surfaceNormal = triInfo.face.normal as THREE.Vector3;
      // Use nearest-surface projection rather than normal ray hits. Ray snaps
      // only move a subset of vertices on curved / imported GLBs, stretching
      // triangles into visible spikes. Nearest-point keeps neighbouring
      // vertices coherent and leaves distant vertices unchanged.
      const newPos = best.point.clone().add(surfaceNormal.clone().normalize().multiplyScalar(offset));
      snapped[i * 3 + 0] = newPos.x;
      snapped[i * 3 + 1] = newPos.y;
      snapped[i * 3 + 2] = newPos.z;
    } else {
      snapped[i * 3 + 0] = v.x;
      snapped[i * 3 + 1] = v.y;
      snapped[i * 3 + 2] = v.z;
    }
  }

  out.setAttribute("position", new THREE.BufferAttribute(snapped, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
