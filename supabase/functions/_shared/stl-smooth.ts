/**
 * Laplacian smoothing pass on an ASCII or binary STL.
 *
 * Why: Meshy's image-to-3d output has high-frequency vertex noise (tiny
 * lumps/bumps on what should be flat panels). A few iterations of Laplacian
 * smoothing — moving each vertex toward the average of its neighbours —
 * removes the noise while preserving overall shape.
 *
 * We:
 *   1. Parse the STL (binary or ASCII) into triangles.
 *   2. Weld near-coincident vertices so neighbours are actually shared.
 *   3. Build a vertex-adjacency map.
 *   4. Run N iterations of weighted Laplacian smoothing.
 *   5. Re-emit as binary STL (smaller + faster than ASCII).
 *
 * lambda controls how aggressively each vertex moves toward its neighbour
 * centroid (0 = no move, 1 = jump fully). 0.5 with 3 iterations is a sweet
 * spot for AI-generated meshes.
 */

const WELD_EPSILON = 1e-4; // metres-equivalent; STL units are arbitrary so this is in mesh space

export function smoothStl(
  stlBytes: Uint8Array,
  { iterations = 3, lambda = 0.5 }: { iterations?: number; lambda?: number } = {},
): Uint8Array {
  const tris = parseStl(stlBytes);
  if (tris.length === 0) return stlBytes;

  // Weld vertices: map raw coords → canonical index.
  const verts: number[] = []; // flat x,y,z
  const indexMap = new Map<string, number>();
  const triIdx: number[] = []; // 3 indices per triangle

  const key = (x: number, y: number, z: number) => {
    // Snap to WELD_EPSILON grid so near-coincident verts collapse.
    const k = (v: number) => Math.round(v / WELD_EPSILON);
    return `${k(x)},${k(y)},${k(z)}`;
  };

  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const x = t.v[i * 3];
      const y = t.v[i * 3 + 1];
      const z = t.v[i * 3 + 2];
      const k = key(x, y, z);
      let idx = indexMap.get(k);
      if (idx === undefined) {
        idx = verts.length / 3;
        verts.push(x, y, z);
        indexMap.set(k, idx);
      }
      triIdx.push(idx);
    }
  }

  const vCount = verts.length / 3;

  // Build adjacency (set of neighbour indices per vertex).
  const adj: Set<number>[] = Array.from({ length: vCount }, () => new Set<number>());
  for (let i = 0; i < triIdx.length; i += 3) {
    const a = triIdx[i], b = triIdx[i + 1], c = triIdx[i + 2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }

  // Iterate Laplacian smoothing.
  let cur = verts.slice();
  const next = new Float64Array(verts.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < vCount; i++) {
      const ns = adj[i];
      if (ns.size === 0) {
        next[i * 3] = cur[i * 3];
        next[i * 3 + 1] = cur[i * 3 + 1];
        next[i * 3 + 2] = cur[i * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const n of ns) {
        sx += cur[n * 3];
        sy += cur[n * 3 + 1];
        sz += cur[n * 3 + 2];
      }
      const inv = 1 / ns.size;
      const cx = sx * inv, cy = sy * inv, cz = sz * inv;
      const x = cur[i * 3], y = cur[i * 3 + 1], z = cur[i * 3 + 2];
      next[i * 3]     = x + lambda * (cx - x);
      next[i * 3 + 1] = y + lambda * (cy - y);
      next[i * 3 + 2] = z + lambda * (cz - z);
    }
    cur = Array.from(next);
  }

  // Rebuild triangles with smoothed positions and write binary STL.
  const smoothed: Tri[] = [];
  for (let i = 0; i < triIdx.length; i += 3) {
    const a = triIdx[i], b = triIdx[i + 1], c = triIdx[i + 2];
    const v = [
      cur[a * 3], cur[a * 3 + 1], cur[a * 3 + 2],
      cur[b * 3], cur[b * 3 + 1], cur[b * 3 + 2],
      cur[c * 3], cur[c * 3 + 1], cur[c * 3 + 2],
    ];
    smoothed.push({ v, n: faceNormal(v) });
  }
  return writeBinaryStl(smoothed);
}

interface Tri { v: number[]; n: [number, number, number]; }

function faceNormal(v: number[]): [number, number, number] {
  const ax = v[3] - v[0], ay = v[4] - v[1], az = v[5] - v[2];
  const bx = v[6] - v[0], by = v[7] - v[1], bz = v[8] - v[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function parseStl(bytes: Uint8Array): Tri[] {
  // Detect ASCII: starts with "solid" AND contains "facet" within first 256 bytes.
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
  // 80-byte header (zero) + uint32 count.
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
