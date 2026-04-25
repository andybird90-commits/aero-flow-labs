/**
 * Build / cache a BVH for a base car BufferGeometry.
 *
 * Building a BVH on a typical 80k-tri car body takes ~80–250ms. We do it
 * exactly once per geometry instance using a WeakMap; subsequent fit ops
 * (snap, trim, mirror) reuse the same accelerator.
 *
 * NOTE: this only runs in the *main thread* path (LiveFitPreview snap loop).
 * Inside the web worker we (re)build a transient BVH from transferred
 * positions because BVH instances aren't transferable.
 */
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

const cache = new WeakMap<THREE.BufferGeometry, MeshBVH>();

/**
 * Returns a cached BVH for the geometry, building one if missing.
 * The geometry must be indexed-or-not, with a `position` attribute.
 */
export function getOrBuildBVH(geometry: THREE.BufferGeometry): MeshBVH {
  const cached = cache.get(geometry);
  if (cached) return cached;
  const bvh = new MeshBVH(geometry, { strategy: 0, maxLeafTris: 10 });
  cache.set(geometry, bvh);
  // Also assign so three-mesh-bvh's accelerated raycast picks it up if
  // the user ever does mesh.raycast() against the base.
  (geometry as any).boundsTree = bvh;
  return bvh;
}

/** Drop the cache entry for a geometry (e.g. when its source URL changes). */
export function clearBVH(geometry: THREE.BufferGeometry) {
  cache.delete(geometry);
  (geometry as any).boundsTree = undefined;
}
