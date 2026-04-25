/**
 * paint-map-edit — pure helpers used by the admin Paint Map editor.
 *
 * The map is a Uint8Array of length = triCount, one byte per triangle:
 *   0 = body, 1 = glass, 2 = wheel, 3 = tyre.
 */
import * as THREE from "three";

export const TAG_BODY = 0;
export const TAG_GLASS = 1;
export const TAG_WHEEL = 2;
export const TAG_TYRE = 3;
export type Tag = 0 | 1 | 2 | 3;

export const TAG_LABELS: Record<Tag, string> = {
  0: "Body",
  1: "Glass",
  2: "Wheel",
  3: "Tyre",
};

/** Vivid debug colours (HSL kept consistent with semantic tokens conceptually). */
export const TAG_COLORS: Record<Tag, string> = {
  0: "#94a3b8", // body — slate
  1: "#22d3ee", // glass — cyan
  2: "#3b82f6", // wheel — blue
  3: "#f97316", // tyre — orange
};

/** Encode tags to base64 (browser-safe, chunked for big meshes). */
export function encodeTagsB64(tags: Uint8Array): string {
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < tags.length; i += CHUNK) {
    const slice = tags.subarray(i, Math.min(i + CHUNK, tags.length));
    s += String.fromCharCode(...slice);
  }
  return btoa(s);
}

export function computeStats(tags: Uint8Array) {
  const c = [0, 0, 0, 0];
  for (let i = 0; i < tags.length; i++) c[tags[i]]++;
  return { body: c[0], glass: c[1], wheel: c[2], tyre: c[3], total: tags.length };
}

/* ───── Undo/Redo ──────────────────────────────────────────── */

export class TagHistory {
  private stack: Uint8Array[] = [];
  private cursor = -1;
  private cap: number;
  constructor(cap = 30) { this.cap = cap; }

  push(tags: Uint8Array) {
    // Drop redo tail.
    this.stack = this.stack.slice(0, this.cursor + 1);
    this.stack.push(new Uint8Array(tags));
    if (this.stack.length > this.cap) this.stack.shift();
    this.cursor = this.stack.length - 1;
  }
  canUndo() { return this.cursor > 0; }
  canRedo() { return this.cursor < this.stack.length - 1; }
  undo(): Uint8Array | null {
    if (!this.canUndo()) return null;
    this.cursor--;
    return new Uint8Array(this.stack[this.cursor]);
  }
  redo(): Uint8Array | null {
    if (!this.canRedo()) return null;
    this.cursor++;
    return new Uint8Array(this.stack[this.cursor]);
  }
  reset(initial: Uint8Array) {
    this.stack = [new Uint8Array(initial)];
    this.cursor = 0;
  }
}

/* ───── Geometry helpers ───────────────────────────────────── */

export interface TriCentroids {
  centroids: Float32Array; // length = triCount * 3
  triCount: number;
}

/** Pre-compute world-space centroids for fast spatial queries. */
export function computeCentroids(geom: THREE.BufferGeometry): TriCentroids {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const out = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    out[t * 3]     = (ax + bx + cx) / 3;
    out[t * 3 + 1] = (ay + by + cy) / 3;
    out[t * 3 + 2] = (az + bz + cz) / 3;
  }
  return { centroids: out, triCount };
}

/** Project triangle centroids to NDC and run a callback per triangle. */
export function forEachVisibleCentroid(
  centroids: Float32Array,
  matrix: THREE.Matrix4, // viewProj * world
  cb: (t: number, ndcX: number, ndcY: number) => void,
) {
  const v = new THREE.Vector3();
  const triCount = centroids.length / 3;
  for (let t = 0; t < triCount; t++) {
    v.set(centroids[t * 3], centroids[t * 3 + 1], centroids[t * 3 + 2]);
    v.applyMatrix4(matrix);
    if (v.z < -1 || v.z > 1) continue;
    cb(t, v.x, v.y);
  }
}

/** Point-in-polygon in NDC space (polygon vertices in NDC). */
export function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Apply a tag to triangles whose centroid falls inside an NDC polygon and faces the camera. */
export function paintByPolygon(
  tags: Uint8Array,
  centroids: Float32Array,
  geom: THREE.BufferGeometry,
  cameraMatrix: THREE.Matrix4,
  cameraDir: THREE.Vector3,
  poly: Array<[number, number]>,
  tag: Tag,
): number {
  let painted = 0;
  // Pre-compute per-triangle normals (face culling).
  const normalAttr = geom.attributes.normal as THREE.BufferAttribute | undefined;
  const idx = geom.index;
  forEachVisibleCentroid(centroids, cameraMatrix, (t, x, y) => {
    if (!pointInPolygon(x, y, poly)) return;
    if (normalAttr && idx) {
      const a = idx.getX(t * 3);
      const nx = normalAttr.getX(a), ny = normalAttr.getY(a), nz = normalAttr.getZ(a);
      // Skip back-faces (normal pointing away from camera).
      const dot = nx * cameraDir.x + ny * cameraDir.y + nz * cameraDir.z;
      if (dot > 0.1) return;
    }
    if (tags[t] !== tag) {
      tags[t] = tag;
      painted++;
    }
  });
  return painted;
}

/** Apply a tag to triangles inside a 3D world-space sphere (used for wheel circle tool). */
export function paintBySphere(
  tags: Uint8Array,
  centroids: Float32Array,
  centerWorld: THREE.Vector3,
  radius: number,
  tag: Tag,
  innerRadius?: number, // optional: only paint where dist >= innerRadius (ring)
): number {
  const r2 = radius * radius;
  const ir2 = innerRadius != null ? innerRadius * innerRadius : -1;
  let painted = 0;
  const triCount = centroids.length / 3;
  for (let t = 0; t < triCount; t++) {
    const dx = centroids[t * 3] - centerWorld.x;
    const dy = centroids[t * 3 + 1] - centerWorld.y;
    const dz = centroids[t * 3 + 2] - centerWorld.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    if (ir2 > 0 && d2 < ir2) continue;
    if (tags[t] !== tag) {
      tags[t] = tag;
      painted++;
    }
  }
  return painted;
}

/**
 * Mirror-paint helper: for each triangle painted, also paint the triangle
 * whose centroid is closest to the X-mirrored centroid (for left/right pairs).
 * Naive O(n) per query — fine for occasional admin use on ≤500k tris.
 */
export function mirrorPaint(
  tags: Uint8Array,
  centroids: Float32Array,
  axis: "x" | "y" = "y", // "y" = mirror across the car's centerline (Y in our convention)
): number {
  const triCount = centroids.length / 3;
  let painted = 0;
  // Build a simple grid lookup so this isn't O(n²)
  const cellSize = 50; // mm
  const grid = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const x = centroids[t * 3];
    const y = centroids[t * 3 + 1];
    const z = centroids[t * 3 + 2];
    const key = `${Math.round(x / cellSize)}|${Math.round(y / cellSize)}|${Math.round(z / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key)!.push(t);
  }
  const snapshot = new Uint8Array(tags);
  for (let t = 0; t < triCount; t++) {
    if (snapshot[t] === 0) continue; // body = nothing to mirror (default)
    const x = centroids[t * 3];
    const y = centroids[t * 3 + 1];
    const z = centroids[t * 3 + 2];
    const mx = axis === "x" ? -x : x;
    const my = axis === "y" ? -y : y;
    const mz = z;
    // Search nearby cells
    let bestT = -1;
    let bestD2 = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${Math.round(mx / cellSize) + dx}|${Math.round(my / cellSize) + dy}|${Math.round(mz / cellSize) + dz}`;
          const arr = grid.get(key);
          if (!arr) continue;
          for (const u of arr) {
            const ux = centroids[u * 3], uy = centroids[u * 3 + 1], uz = centroids[u * 3 + 2];
            const ddx = ux - mx, ddy = uy - my, ddz = uz - mz;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < bestD2) { bestD2 = d2; bestT = u; }
          }
        }
      }
    }
    if (bestT >= 0 && bestT !== t && tags[bestT] !== snapshot[t]) {
      tags[bestT] = snapshot[t];
      painted++;
    }
  }
  return painted;
}
