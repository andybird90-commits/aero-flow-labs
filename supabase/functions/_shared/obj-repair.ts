/**
 * Memory-efficient OBJ repair path for large hero-car meshes.
 *
 * Parses Wavefront OBJ line-by-line into typed arrays, welds vertices,
 * drops degenerates, re-orients triangle winding, checks manifold-ness,
 * and emits binary STL.
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

export function repairObj(
  objBytes: Uint8Array,
  { weldEpsilon = DEFAULT_WELD_EPS }: { weldEpsilon?: number } = {},
): RepairResult {
  let vCap = 1 << 16;
  let vCount = 0;
  let vx = new Float32Array(vCap);
  let vy = new Float32Array(vCap);
  let vz = new Float32Array(vCap);

  let tCap = 1 << 16;
  let tCount = 0;
  let tris = new Int32Array(tCap * 3);

  const pushVertex = (x: number, y: number, z: number) => {
    if (vCount === vCap) {
      vCap *= 2;
      const nx = new Float32Array(vCap); nx.set(vx); vx = nx;
      const ny = new Float32Array(vCap); ny.set(vy); vy = ny;
      const nz = new Float32Array(vCap); nz.set(vz); vz = nz;
    }
    vx[vCount] = x;
    vy[vCount] = y;
    vz[vCount] = z;
    vCount++;
  };

  const pushTri = (a: number, b: number, c: number) => {
    if (tCount === tCap) {
      tCap *= 2;
      const next = new Int32Array(tCap * 3);
      next.set(tris);
      tris = next;
    }
    const o = tCount * 3;
    tris[o] = a;
    tris[o + 1] = b;
    tris[o + 2] = c;
    tCount++;
  };

  const decoder = new TextDecoder();
  const faceIdx: number[] = [];
  let lineStart = 0;
  const len = objBytes.length;

  for (let i = 0; i <= len; i++) {
    const b = i < len ? objBytes[i] : 10;
    if (b !== 10 && b !== 13) continue;
    if (i > lineStart) {
      const line = decoder.decode(objBytes.subarray(lineStart, i));
      let p = 0;
      while (p < line.length && (line.charCodeAt(p) === 32 || line.charCodeAt(p) === 9)) p++;
      const c0 = line.charCodeAt(p);
      const c1 = line.charCodeAt(p + 1);

      if (c0 === 118 && (c1 === 32 || c1 === 9)) {
        const parts = line.substring(p + 2).trim().split(/\s+/);
        const x = +parts[0], y = +parts[1], z = +parts[2];
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          pushVertex(x, y, z);
        }
      } else if (c0 === 102 && (c1 === 32 || c1 === 9)) {
        faceIdx.length = 0;
        const parts = line.substring(p + 2).trim().split(/\s+/);
        for (const tok of parts) {
          const slash = tok.indexOf("/");
          const n = parseInt(slash === -1 ? tok : tok.substring(0, slash), 10);
          if (!Number.isFinite(n)) continue;
          const vi = n < 0 ? vCount + n : n - 1;
          if (vi >= 0 && vi < vCount) faceIdx.push(vi);
        }
        for (let k = 1; k < faceIdx.length - 1; k++) {
          pushTri(faceIdx[0], faceIdx[k], faceIdx[k + 1]);
        }
      }
    }
    lineStart = i + 1;
  }

  if (vCount === 0 || tCount === 0) {
    throw new Error("OBJ has no usable vertices or faces.");
  }

  const result = repairIndexedMesh(vx, vy, vz, vCount, tris, tCount, weldEpsilon);

  vx = new Float32Array(0);
  vy = new Float32Array(0);
  vz = new Float32Array(0);
  tris = new Int32Array(0);

  return result;
}

function repairIndexedMesh(
  vx: Float32Array,
  vy: Float32Array,
  vz: Float32Array,
  vCountIn: number,
  tris: Int32Array,
  triCountIn: number,
  weldEpsilon: number,
): RepairResult {
  const inv = 1 / weldEpsilon;
  const maxV = vCountIn;
  const posPool = new Float32Array(maxV * 3);
  const triIdx = new Int32Array(triCountIn * 3);
  const map = new Map<bigint, number>();
  let vCount = 0;
  let triKept = 0;

  const BIAS = 1n << 21n;
  const SHIFT = 22n;

  for (let t = 0; t < triCountIn; t++) {
    const o = t * 3;
    const ids = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const src = tris[o + i];
      const x = vx[src];
      const y = vy[src];
      const z = vz[src];
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

  let triOut = 0;
  for (let i = 0; i < triKept; i++) {
    const a = triIdx[i * 3], b = triIdx[i * 3 + 1], c = triIdx[i * 3 + 2];
    const ax = posPool[a * 3], ay = posPool[a * 3 + 1], az = posPool[a * 3 + 2];
    const bx = posPool[b * 3], by = posPool[b * 3 + 1], bz = posPool[b * 3 + 2];
    const cx2 = posPool[c * 3], cy2 = posPool[c * 3 + 1], cz2 = posPool[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx2 = cx2 - ax, vy2 = cy2 - ay, vz2 = cz2 - az;
    const nx = uy * vz2 - uz * vy2;
    const ny = uz * vx2 - ux * vz2;
    const nz = ux * vy2 - uy * vx2;
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

  const edgeCount = new Map<bigint, number>();
  const VBITS = 32n;
  for (let i = 0; i < triOut; i++) {
    const a = triIdx[i * 3], b = triIdx[i * 3 + 1], c = triIdx[i * 3 + 2];
    addEdge(edgeCount, a, b, VBITS);
    addEdge(edgeCount, b, c, VBITS);
    addEdge(edgeCount, c, a, VBITS);
  }

  let openEdges = 0;
  let dupEdges = 0;
  for (const count of edgeCount.values()) {
    if (count === 1) openEdges++;
    else if (count > 2) dupEdges++;
  }
  edgeCount.clear();

  return {
    bytes: writeBinaryStlIndexed(posPool, vCount, triIdx, triOut),
    stats: {
      triangle_count_in: triCountIn,
      triangle_count_out: triOut,
      vertex_count_out: vCount,
      manifold: openEdges === 0 && dupEdges === 0,
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
    const a = idx[i * 3] * 3;
    const b = idx[i * 3 + 1] * 3;
    const c = idx[i * 3 + 2] * 3;
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
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    dv.setFloat32(off, nx, true);
    dv.setFloat32(off + 4, ny, true);
    dv.setFloat32(off + 8, nz, true);
    dv.setFloat32(off + 12, ax, true);
    dv.setFloat32(off + 16, ay, true);
    dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true);
    dv.setFloat32(off + 28, by, true);
    dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true);
    dv.setFloat32(off + 40, cy, true);
    dv.setFloat32(off + 44, cz, true);
    off += 50;
  }
  return new Uint8Array(buf);
}
