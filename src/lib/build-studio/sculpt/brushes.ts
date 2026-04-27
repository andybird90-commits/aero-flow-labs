/**
 * Sculpt brush kernels.
 *
 * Each kernel is a pure function operating on a contiguous patch of vertex
 * data. They mutate `positions` in place and trust the caller to manage
 * snapshots, normal recompute, and BVH invalidation.
 *
 * Falloff: smoothstep-ish `(1 - r/R)^2`. r >= R -> 0 contribution.
 */
import * as THREE from "three";

export type BrushKind = "push" | "pull" | "smooth" | "inflate" | "pinch" | "flatten";

export interface BrushParams {
  /** World-space brush centre (typically the raycast hit point). */
  centre: THREE.Vector3;
  /** Surface normal at brush centre (used by push/pull/flatten). */
  surfaceNormal: THREE.Vector3;
  /** Brush radius in world units. */
  radius: number;
  /** 0..1 strength multiplier. Caller scales by dt for time-based strokes. */
  strength: number;
  brush: BrushKind;
}

/** Falloff in [0,1]. r is distance from centre, R is brush radius. */
export function falloff(r: number, R: number): number {
  if (r >= R) return 0;
  const t = 1 - r / R;
  return t * t; // quadratic — soft edges, no hard ring
}

/**
 * Apply a brush stroke to a subset of vertices (already filtered by the BVH
 * to lie within the brush sphere).
 *
 * - `positions` is the live `BufferAttribute.array` (Float32Array, xyz triplets).
 * - `vertexNormals` is the matching normals array (also xyz triplets).
 * - `affectedIdx` is the list of vertex indices to consider.
 * - For `smooth` we also need `neighbours[v] = number[]` adjacency.
 */
export function applyBrush(
  positions: Float32Array,
  vertexNormals: Float32Array,
  affectedIdx: Iterable<number>,
  params: BrushParams,
  neighbours?: Map<number, number[]>,
): Set<number> {
  const { centre, surfaceNormal, radius, strength, brush } = params;
  const touched = new Set<number>();
  const tmp = new THREE.Vector3();
  const meanV = new THREE.Vector3();

  for (const i of affectedIdx) {
    const o = i * 3;
    tmp.set(positions[o], positions[o + 1], positions[o + 2]);
    const r = tmp.distanceTo(centre);
    const w = falloff(r, radius);
    if (w === 0) continue;

    let dx = 0, dy = 0, dz = 0;

    switch (brush) {
      case "push":
      case "pull": {
        const sign = brush === "push" ? -1 : 1;
        const k = strength * w * sign;
        dx = surfaceNormal.x * k;
        dy = surfaceNormal.y * k;
        dz = surfaceNormal.z * k;
        break;
      }
      case "inflate": {
        const k = strength * w;
        dx = vertexNormals[o] * k;
        dy = vertexNormals[o + 1] * k;
        dz = vertexNormals[o + 2] * k;
        break;
      }
      case "pinch": {
        const k = strength * w;
        dx = (centre.x - tmp.x) * k;
        dy = (centre.y - tmp.y) * k;
        dz = (centre.z - tmp.z) * k;
        break;
      }
      case "flatten": {
        // Project vertex onto plane (centre, surfaceNormal): subtract its
        // signed distance along the normal direction.
        const d =
          (tmp.x - centre.x) * surfaceNormal.x +
          (tmp.y - centre.y) * surfaceNormal.y +
          (tmp.z - centre.z) * surfaceNormal.z;
        const k = strength * w;
        dx = -surfaceNormal.x * d * k;
        dy = -surfaceNormal.y * d * k;
        dz = -surfaceNormal.z * d * k;
        break;
      }
      case "smooth": {
        const ns = neighbours?.get(i);
        if (!ns || ns.length === 0) continue;
        meanV.set(0, 0, 0);
        for (const n of ns) {
          const no = n * 3;
          meanV.x += positions[no];
          meanV.y += positions[no + 1];
          meanV.z += positions[no + 2];
        }
        meanV.multiplyScalar(1 / ns.length);
        const k = strength * w;
        dx = (meanV.x - tmp.x) * k;
        dy = (meanV.y - tmp.y) * k;
        dz = (meanV.z - tmp.z) * k;
        break;
      }
    }

    if (dx === 0 && dy === 0 && dz === 0) continue;
    positions[o] += dx;
    positions[o + 1] += dy;
    positions[o + 2] += dz;
    touched.add(i);
  }

  return touched;
}

/**
 * Build the 1-ring vertex adjacency map from an indexed BufferGeometry.
 * Used by the smooth brush. O(triangles) one-time.
 */
export function buildVertexNeighbours(geometry: THREE.BufferGeometry): Map<number, number[]> {
  const neighbours = new Map<number, number[]>();
  const idx = geometry.index?.array;
  const triCount = idx ? idx.length / 3 : (geometry.attributes.position?.count ?? 0) / 3;

  const add = (a: number, b: number) => {
    let arr = neighbours.get(a);
    if (!arr) { arr = []; neighbours.set(a, arr); }
    if (!arr.includes(b)) arr.push(b);
  };

  if (idx) {
    for (let t = 0; t < triCount; t++) {
      const a = idx[t * 3] as number;
      const b = idx[t * 3 + 1] as number;
      const c = idx[t * 3 + 2] as number;
      add(a, b); add(a, c);
      add(b, a); add(b, c);
      add(c, a); add(c, b);
    }
  } else {
    for (let t = 0; t < triCount; t++) {
      const a = t * 3, b = t * 3 + 1, c = t * 3 + 2;
      add(a, b); add(a, c);
      add(b, a); add(b, c);
      add(c, a); add(c, b);
    }
  }
  return neighbours;
}
