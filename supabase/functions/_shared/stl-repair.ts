/**
 * STL repair pass for hero-car reference meshes.
 *
 * "Messy but full" inputs typically suffer from:
 *   - duplicate vertices (verts not shared across triangles)
 *   - inconsistent winding (some normals flipped)
 *   - tiny gaps where edges nearly meet
 *   - degenerate triangles (zero area)
 *
 * This module:
 *   1. Parses ASCII or binary STL.
 *   2. Welds near-coincident vertices on a configurable epsilon grid.
 *   3. Drops degenerate triangles.
 *   4. Re-orients normals to face outward from the mesh centroid (heuristic
 *      that works well for closed bodywork).
 *   5. Computes manifold-ness via the "every edge appears in exactly 2 faces"
 *      test. We don't try to *make* it manifold — boolean ops will refuse
 *      to run on non-manifold inputs and the UI surfaces that.
 *   6. Re-emits as binary STL.
 *
 * Returns the repaired bytes plus diagnostic stats.
 */

const DEFAULT_WELD_EPS = 0.05; // mm-scale — adjust if your STL is in metres

export interface RepairStats {
  triangle_count_in: number;
  triangle_count_out: number;
  vertex_count_out: number;
  manifold: boolean;
  open_edges: number;
  duplicate_edges: number;
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
}

export interface RepairResult {
  bytes: Uint8Array;
  stats: RepairStats;
}

interface Tri { v: number[]; n: [number, number, number]; }

export function repairStl(
  input: Uint8Array,
  { weldEpsilon = DEFAULT_WELD_EPS }: { weldEpsilon?: number } = {},
): RepairResult {
  const tris = parseStl(input);
  const triCountIn = tris.length;

  // Weld vertices.
  const verts: number[] = [];
  const indexMap = new Map<string, number>();
  const triIdx: number[] = [];

  const key = (x: number, y: number, z: number) => {
    const k = (v: number) => Math.round(v / weldEpsilon);
    return `${k(x)},${k(y)},${k(z)}`;
  };

  for (const t of tris) {
    const idx: number[] = [];
    for (let i = 0; i < 3; i++) {
      const x = t.v[i * 3];
      const y = t.v[i * 3 + 1];
      const z = t.v[i * 3 + 2];
      const k = key(x, y, z);
      let id = indexMap.get(k);
      if (id === undefined) {
        id = verts.length / 3;
        verts.push(x, y, z);
        indexMap.set(k, id);
      }
      idx.push(id);
    }
    // Skip degenerate (two indices identical).
    if (idx[0] === idx[1] || idx[1] === idx[2] || idx[0] === idx[2]) continue;
    triIdx.push(idx[0], idx[1], idx[2]);
  }

  const vCount = verts.length / 3;

  // Bounding box + centroid (for normal re-orientation).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // Re-emit triangles. Flip winding if the face normal points inward (toward
  // centroid). This is a heuristic — convex parts always work, slight concavity
  // (door cuts, wheel arches) usually still works because the local outward
  // direction agrees with global outward at most face centres.
  const outTris: Tri[] = [];
  for (let i = 0; i < triIdx.length; i += 3) {
    const a = triIdx[i], b = triIdx[i + 1], c = triIdx[i + 2];
    const v = [
      verts[a * 3], verts[a * 3 + 1], verts[a * 3 + 2],
      verts[b * 3], verts[b * 3 + 1], verts[b * 3 + 2],
      verts[c * 3], verts[c * 3 + 1], verts[c * 3 + 2],
    ];
    const n = faceNormal(v);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue;

    const fx = (v[0] + v[3] + v[6]) / 3;
    const fy = (v[1] + v[4] + v[7]) / 3;
    const fz = (v[2] + v[5] + v[8]) / 3;
    const dx = fx - cx, dy = fy - cy, dz = fz - cz;
    const dot = n[0] * dx + n[1] * dy + n[2] * dz;
    if (dot < 0) {
      // Flip winding: swap vertices b and c.
      const tx = v[3], ty = v[4], tz = v[5];
      v[3] = v[6]; v[4] = v[7]; v[5] = v[8];
      v[6] = tx;   v[7] = ty;   v[8] = tz;
      n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2];
    }
    outTris.push({ v, n });
  }

  // Manifold check: count occurrences of each undirected edge.
  // Manifold = every edge appears exactly twice.
  const edgeCount = new Map<string, number>();
  const edgeKey = (i: number, j: number) => i < j ? `${i}-${j}` : `${j}-${i}`;
  // Rebuild index list from outTris (winding may have changed but topology hasn't).
  // We need indices again — re-weld outTris vertices.
  const idx2: number[] = [];
  const map2 = new Map<string, number>();
  const verts2: number[] = [];
  for (const t of outTris) {
    for (let i = 0; i < 3; i++) {
      const x = t.v[i * 3], y = t.v[i * 3 + 1], z = t.v[i * 3 + 2];
      const k = key(x, y, z);
      let id = map2.get(k);
      if (id === undefined) {
        id = verts2.length / 3;
        verts2.push(x, y, z);
        map2.set(k, id);
      }
      idx2.push(id);
    }
  }
  for (let i = 0; i < idx2.length; i += 3) {
    const a = idx2[i], b = idx2[i + 1], c = idx2[i + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = edgeKey(u, v);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  let dupEdges = 0;
  for (const c of edgeCount.values()) {
    if (c === 1) openEdges++;
    else if (c > 2) dupEdges++;
  }
  const manifold = openEdges === 0 && dupEdges === 0;

  return {
    bytes: writeBinaryStl(outTris),
    stats: {
      triangle_count_in: triCountIn,
      triangle_count_out: outTris.length,
      vertex_count_out: verts2.length / 3,
      manifold,
      open_edges: openEdges,
      duplicate_edges: dupEdges,
      bbox_min: [minX, minY, minZ],
      bbox_max: [maxX, maxY, maxZ],
    },
  };
}

function faceNormal(v: number[]): [number, number, number] {
  const ax = v[3] - v[0], ay = v[4] - v[1], az = v[5] - v[2];
  const bx = v[6] - v[0], by = v[7] - v[1], bz = v[8] - v[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

function parseStl(bytes: Uint8Array): Tri[] {
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(256, bytes.length)));
  if (head.trim().startsWith("solid") && head.includes("facet")) {
    return parseAsciiStl(new TextDecoder().decode(bytes));
  }
  return parseBinaryStl(bytes);
}

function parseBinaryStl(bytes: Uint8Array): Tri[] {
  if (bytes.length < 84) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  const tris: Tri[] = [];
  let off = 84;
  for (let i = 0; i < count; i++) {
    if (off + 50 > bytes.length) break;
    const nx = dv.getFloat32(off, true);
    const ny = dv.getFloat32(off + 4, true);
    const nz = dv.getFloat32(off + 8, true);
    const v: number[] = [];
    for (let k = 0; k < 9; k++) v.push(dv.getFloat32(off + 12 + k * 4, true));
    tris.push({ v, n: [nx, ny, nz] });
    off += 50;
  }
  return tris;
}

function parseAsciiStl(text: string): Tri[] {
  const tris: Tri[] = [];
  const re = /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+outer\s+loop\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tris.push({
      n: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
      v: m.slice(4, 13).map(parseFloat),
    });
  }
  return tris;
}

function writeBinaryStl(tris: Tri[]): Uint8Array {
  const size = 84 + tris.length * 50;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let off = 84;
  for (const t of tris) {
    dv.setFloat32(off, t.n[0], true);
    dv.setFloat32(off + 4, t.n[1], true);
    dv.setFloat32(off + 8, t.n[2], true);
    for (let k = 0; k < 9; k++) dv.setFloat32(off + 12 + k * 4, t.v[k], true);
    dv.setUint16(off + 48, 0, true);
    off += 50;
  }
  return new Uint8Array(buf);
}
