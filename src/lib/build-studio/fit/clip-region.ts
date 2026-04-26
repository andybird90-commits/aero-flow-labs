/**
 * clip-region — extract a small subset of a large base body geometry that's
 * near a part, so the BVH / CSG evaluator only has to chew on a few thousand
 * triangles instead of the whole car.
 *
 * Why this exists:
 *   The full body STL can be 80–500 k triangles. Passing the entire mesh to
 *   `three-bvh-csg`'s SUBTRACTION evaluator allocates an O(partTris × bodyTris)
 *   intermediate buffer — easily blowing past 4 GB and crashing the worker
 *   with `Invalid typed array length`. By clipping the base to a small AABB
 *   around the part we keep CSG cost bounded (~5–20 k tris max).
 *
 * Pure helper — no THREE.Mesh wrappers, just BufferGeometry in / out.
 */
import * as THREE from "three";

export interface ClipOptions {
  /** Extra padding around the part AABB, in metres. Default 0.15 m. */
  paddingM?: number;
  /** Hard cap on returned triangles. If exceeded, we still return — but the
   *  caller should treat that as "skip CSG, snap-only". */
  maxTris?: number;
}

export interface ClippedRegion {
  geometry: THREE.BufferGeometry;
  triCount: number;
  /** True if we hit `maxTris` and the result is potentially incomplete. */
  truncated: boolean;
}

/**
 * Returns a new (un-indexed) BufferGeometry containing only the triangles of
 * `base` whose centroid lies inside `aabb` (expanded by `paddingM`).
 */
export function clipGeometryToAabb(
  base: THREE.BufferGeometry,
  aabb: THREE.Box3,
  opts: ClipOptions = {},
): ClippedRegion {
  const padding = opts.paddingM ?? 0.15;
  const maxTris = opts.maxTris ?? 25_000;

  const region = aabb.clone().expandByScalar(padding);
  const pos = base.attributes.position.array as Float32Array;
  const idx = base.index ? (base.index.array as ArrayLike<number>) : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;

  // Worst case allocation = full input. We trim with subarray() at the end.
  const out = new Float32Array(Math.min(triCount, maxTris) * 9);
  let written = 0;
  let truncated = false;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3 + 0] * 3 : t * 9;
    const i1 = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3;
    const i2 = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
    b.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
    c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (!region.containsPoint(centroid)) continue;

    if (written / 9 >= maxTris) {
      truncated = true;
      break;
    }
    out[written + 0] = a.x; out[written + 1] = a.y; out[written + 2] = a.z;
    out[written + 3] = b.x; out[written + 4] = b.y; out[written + 5] = b.z;
    out[written + 6] = c.x; out[written + 7] = c.y; out[written + 8] = c.z;
    written += 9;
  }

  const trimmed = out.subarray(0, written);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(trimmed.slice(), 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return { geometry: g, triCount: written / 9, truncated };
}

/** Build the AABB of a part's positions (assumed already in world frame). */
export function partAabb(part: THREE.BufferGeometry): THREE.Box3 {
  const pos = part.attributes.position;
  const box = new THREE.Box3();
  if (!pos) return box;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
    box.expandByPoint(v);
  }
  return box;
}
