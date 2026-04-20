/**
 * STL repair pass for hero-car reference meshes.
 *
 * Memory-efficient rewrite: uses typed arrays end-to-end and an integer
 * hash for vertex welding so it can handle 50+ MB inputs inside the
 * 256 MB edge-worker cap.
 *
 *   1. Parse ASCII or binary STL into Float32Array of triangle vertices.
 *   2. Weld near-coincident vertices using a quantised int hash (no string keys).
 *   3. Drop degenerate triangles.
 *   4. Re-orient normals to face outward from the mesh centroid.
 *   5. Manifold check via undirected edge counting (Map<bigint,int>).
 *   6. Re-emit as binary STL.
 */

const DEFAULT_WELD_EPS = 0.05;

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

export function repairStl(
  input: Uint8Array,
  { weldEpsilon = DEFAULT_WELD_EPS }: { weldEpsilon?: number } = {},
): RepairResult {
  // 1. Parse → flat Float32Array of triangle vertex positions (9 floats per tri).
  const rawVerts = parseStlToFloats(input);
  const triCountIn = rawVerts.length / 9;

  // 2. Weld with integer hash. Quantise each coord to int via Math.round(v/eps).
  // Pack (qx, qy, qz) into a BigInt key — avoids string allocation per vertex.
  const inv = 1 / weldEpsilon;
  // Pre-allocate vertex pool at upper bound (rawVerts.length / 3 unique vertices).
  const maxV = (rawVerts.length / 3) | 0;
  const posPool = new Float32Array(maxV * 3);
  const triIdx = new Int32Array(triCountIn * 3);
  const map = new Map<bigint, number>();
  let vCount = 0;
  let triKept = 0;

  // Bias to keep BigInts positive-friendly (assumes meshes within ±2^20 mm = 1km).
  const BIAS = 1n << 21n;
  const SHIFT = 22n; // 2^22 > 2*BIAS

  for (let t = 0; t < triCountIn; t++) {
    const o = t * 9;
    const ids = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const x = rawVerts[o + i * 3];
      const y = rawVerts[o + i * 3 + 1];
      const z = rawVerts[o + i * 3 + 2];
      const qx = BigInt(Math.round(x * inv)) + BIAS;
      const qy = BigInt(Math.round(y * inv)) + BIAS;
      const qz = BigInt(Math.round(z * inv)) + BIAS;
      const key = (qx << (SHIFT * 2n)) | (qy << SHIFT) | qz;
      let id = map.get(key);
      if (id === undefined) {
        id = vCount;
        posPool[vCount * 3] = x;
        posPool[vCount * 3 + 1] = y;
        posPool[vCount * 3 + 2] = z;
        vCount++;
        map.set(key, id);
      }
      ids[i] = id;
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    triIdx[triKept * 3] = ids[0];
    triIdx[triKept * 3 + 1] = ids[1];
    triIdx[triKept * 3 + 2] = ids[2];
    triKept++;
  }
  map.clear();
  // rawVerts no longer needed — drop reference so GC can reclaim ~9 floats/tri.
  // (Caller holds no reference; assignment to undefined inside func is enough.)

  // 3. Bounding box + centroid.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const x = posPool[i * 3], y = posPool[i * 3 + 1], z = posPool[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // 4. Re-orient: flip windings whose normal points inward (toward centroid).
  let triOut = 0;
  // Re-use triIdx in place; track output count separately (always ≤ input).
  for (let i = 0; i < triKept; i++) {
    const a = triIdx[i * 3], b = triIdx[i * 3 + 1], c = triIdx[i * 3 + 2];
    const ax = posPool[a * 3],     ay = posPool[a * 3 + 1], az = posPool[a * 3 + 2];
    const bx = posPool[b * 3],     by = posPool[b * 3 + 1], bz = posPool[b * 3 + 2];
    const cx2 = posPool[c * 3],    cy2 = posPool[c * 3 + 1], cz2 = posPool[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx2 - ax, vy = cy2 - ay, vz = cz2 - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len2 = nx * nx + ny * ny + nz * nz;
    if (len2 < 1e-24) continue;
    const fx = (ax + bx + cx2) / 3;
    const fy = (ay + by + cy2) / 3;
    const fz = (az + bz + cz2) / 3;
    const dot = nx * (fx - cx) + ny * (fy - cy) + nz * (fz - cz);
    triIdx[triOut * 3] = a;
    if (dot < 0) {
      triIdx[triOut * 3 + 1] = c;
      triIdx[triOut * 3 + 2] = b;
    } else {
      triIdx[triOut * 3 + 1] = b;
      triIdx[triOut * 3 + 2] = c;
    }
    triOut++;
  }

  // 5. Manifold check: undirected edge counts via packed BigInt key.
  const edgeCount = new Map<bigint, number>();
  const VBITS = 32n;
  for (let i = 0; i < triOut; i++) {
    const a = triIdx[i * 3], b = triIdx[i * 3 + 1], c = triIdx[i * 3 + 2];
    addEdge(edgeCount, a, b, VBITS);
    addEdge(edgeCount, b, c, VBITS);
    addEdge(edgeCount, c, a, VBITS);
  }
  let openEdges = 0, dupEdges = 0;
  for (const c of edgeCount.values()) {
    if (c === 1) openEdges++;
    else if (c > 2) dupEdges++;
  }
  edgeCount.clear();
  const manifold = openEdges === 0 && dupEdges === 0;

  // 6. Write binary STL directly from posPool + triIdx[0..triOut*3].
  const out = writeBinaryStlIndexed(posPool, vCount, triIdx, triOut);

  return {
    bytes: out,
    stats: {
      triangle_count_in: triCountIn,
      triangle_count_out: triOut,
      vertex_count_out: vCount,
      manifold,
      open_edges: openEdges,
      duplicate_edges: dupEdges,
      bbox_min: [minX, minY, minZ],
      bbox_max: [maxX, maxY, maxZ],
    },
  };
}

function addEdge(m: Map<bigint, number>, i: number, j: number, vbits: bigint) {
  const lo = i < j ? i : j;
  const hi = i < j ? j : i;
  const key = (BigInt(lo) << vbits) | BigInt(hi);
  m.set(key, (m.get(key) ?? 0) + 1);
}

/** Parse STL (ascii or binary) into a flat Float32Array of triangle vertex floats. */
function parseStlToFloats(bytes: Uint8Array): Float32Array {
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(256, bytes.length)));
  if (head.trim().startsWith("solid") && head.includes("facet")) {
    return parseAsciiStl(bytes);
  }
  return parseBinaryStl(bytes);
}

function parseBinaryStl(bytes: Uint8Array): Float32Array {
  if (bytes.length < 84) return new Float32Array(0);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  // Cap at what the file actually contains.
  const maxByLen = Math.floor((bytes.length - 84) / 50);
  const n = Math.min(count, maxByLen);
  const out = new Float32Array(n * 9);
  let off = 84;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 9; k++) {
      out[i * 9 + k] = dv.getFloat32(off + 12 + k * 4, true);
    }
    off += 50;
  }
  return out;
}

/** Stream-parse ASCII STL line-by-line; avoids huge string splits. */
function parseAsciiStl(bytes: Uint8Array): Float32Array {
  const decoder = new TextDecoder();
  // Estimate triangle count from byte size; ~250 bytes/tri average → roomy.
  let cap = Math.max(1024, Math.ceil(bytes.length / 200) * 9);
  let out = new Float32Array(cap);
  let off = 0;

  let lineStart = 0;
  const len = bytes.length;
  // We accumulate 3 vertices, then commit as a triangle.
  const triBuf = new Float32Array(9);
  let triOff = 0;
  for (let i = 0; i <= len; i++) {
    const b = i < len ? bytes[i] : 10;
    if (b !== 10 && b !== 13) continue;
    if (i > lineStart) {
      const line = decoder.decode(bytes.subarray(lineStart, i));
      // Find "vertex" prefix (skip whitespace).
      let p = 0;
      while (p < line.length && (line.charCodeAt(p) === 32 || line.charCodeAt(p) === 9)) p++;
      if (line.startsWith("vertex", p)) {
        const parts = line.substring(p + 6).trim().split(/\s+/);
        const x = +parts[0], y = +parts[1], z = +parts[2];
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          triBuf[triOff++] = x;
          triBuf[triOff++] = y;
          triBuf[triOff++] = z;
          if (triOff === 9) {
            if (off + 9 > cap) {
              cap *= 2;
              const grown = new Float32Array(cap);
              grown.set(out);
              out = grown;
            }
            out.set(triBuf, off);
            off += 9;
            triOff = 0;
          }
        }
      }
    }
    lineStart = i + 1;
  }
  return out.subarray(0, off);
}

function writeBinaryStlIndexed(
  pos: Float32Array,
  vCount: number,
  idx: Int32Array,
  triCount: number,
): Uint8Array {
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    const a = idx[i * 3] * 3, b = idx[i * 3 + 1] * 3, c = idx[i * 3 + 2] * 3;
    if (a < 0 || b < 0 || c < 0 || a >= vCount * 3 || b >= vCount * 3 || c >= vCount * 3) {
      off += 50;
      continue;
    }
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
    dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
    off += 50;
  }
  return new Uint8Array(buf);
}
