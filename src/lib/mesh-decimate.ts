/**
 * Client-side mesh decimation for hero-car uploads.
 *
 * Strategy: vertex-clustering.
 *   1. Parse OBJ or STL → flat triangle vertex list.
 *   2. Compute bounding box.
 *   3. Quantize each vertex onto a 3D grid sized so the expected unique-cell
 *      count ≈ targetVertexCount.
 *   4. Weld each cell to the centroid of vertices that landed in it.
 *   5. Drop degenerate (collapsed) triangles.
 *   6. Emit binary STL.
 *
 * O(n) in vertices/triangles, runs comfortably in a Web Worker on a 56 MB OBJ.
 * Loses fine surface detail but preserves silhouette — exactly what the
 * boolean aero-kit pipeline needs.
 */

export interface DecimateResult {
  bytes: Uint8Array;
  triCountIn: number;
  triCountOut: number;
  vertCountOut: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

export function decimateMeshFile(
  input: Uint8Array,
  filename: string,
  targetTriangles = 200_000,
): DecimateResult {
  const isObj = /\.obj$/i.test(filename);
  const tris = isObj ? parseObjTriangles(input) : parseStlTriangles(input);
  const triCountIn = tris.length / 9;
  if (triCountIn === 0) throw new Error("Mesh has no triangles.");

  // Bounds for grid sizing.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = Math.max(maxX - minX, 1e-6);
  const dy = Math.max(maxY - minY, 1e-6);
  const dz = Math.max(maxZ - minZ, 1e-6);

  // Choose a uniform grid resolution. Target vertex count ~ targetTriangles/2
  // (Euler-ish estimate for closed meshes). Cells along each axis ∝ extent^(1/3).
  const targetVerts = Math.max(1024, Math.floor(targetTriangles / 2));
  const vol = dx * dy * dz;
  const cellSize = Math.cbrt(vol / targetVerts);
  const inv = 1 / cellSize;

  // Welding: pack quantised (qx, qy, qz) into a BigInt key, accumulate
  // centroids, then build a vertex pool.
  const accum = new Map<bigint, { x: number; y: number; z: number; n: number; id: number }>();
  const BIAS = 1n << 21n;
  const SHIFT = 22n;

  const cellId = (x: number, y: number, z: number) => {
    const qx = BigInt(Math.round(x * inv)) + BIAS;
    const qy = BigInt(Math.round(y * inv)) + BIAS;
    const qz = BigInt(Math.round(z * inv)) + BIAS;
    return (qx << (SHIFT * 2n)) | (qy << SHIFT) | qz;
  };

  const triIdx = new Int32Array(triCountIn * 3);
  let nextId = 0;

  for (let t = 0; t < triCountIn; t++) {
    const o = t * 9;
    for (let i = 0; i < 3; i++) {
      const x = tris[o + i * 3];
      const y = tris[o + i * 3 + 1];
      const z = tris[o + i * 3 + 2];
      const key = cellId(x, y, z);
      let cell = accum.get(key);
      if (!cell) {
        cell = { x: 0, y: 0, z: 0, n: 0, id: nextId++ };
        accum.set(key, cell);
      }
      cell.x += x; cell.y += y; cell.z += z; cell.n++;
      triIdx[t * 3 + i] = cell.id;
    }
  }

  // Build pos pool from cell centroids.
  const vCount = nextId;
  const pos = new Float32Array(vCount * 3);
  for (const cell of accum.values()) {
    pos[cell.id * 3] = cell.x / cell.n;
    pos[cell.id * 3 + 1] = cell.y / cell.n;
    pos[cell.id * 3 + 2] = cell.z / cell.n;
  }
  accum.clear();

  // Drop degenerate triangles + dedupe identical (a,b,c) sets.
  const seenTri = new Set<bigint>();
  const TBITS = 32n;
  const outIdx = new Int32Array(triCountIn * 3);
  let triOut = 0;
  for (let i = 0; i < triCountIn; i++) {
    const a = triIdx[i * 3], b = triIdx[i * 3 + 1], c = triIdx[i * 3 + 2];
    if (a === b || b === c || a === c) continue;
    // Sort indices for dedup key only.
    const s = [a, b, c].sort((p, q) => p - q);
    const key = (BigInt(s[0]) << (TBITS * 2n)) | (BigInt(s[1]) << TBITS) | BigInt(s[2]);
    if (seenTri.has(key)) continue;
    seenTri.add(key);
    outIdx[triOut * 3] = a;
    outIdx[triOut * 3 + 1] = b;
    outIdx[triOut * 3 + 2] = c;
    triOut++;
  }
  seenTri.clear();

  // Emit binary STL.
  const buf = new ArrayBuffer(84 + triOut * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triOut, true);
  let off = 84;
  for (let i = 0; i < triOut; i++) {
    const a = outIdx[i * 3] * 3;
    const b = outIdx[i * 3 + 1] * 3;
    const c = outIdx[i * 3 + 2] * 3;
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

  return {
    bytes: new Uint8Array(buf),
    triCountIn,
    triCountOut: triOut,
    vertCountOut: vCount,
    bboxMin: [minX, minY, minZ],
    bboxMax: [maxX, maxY, maxZ],
  };
}

/* ─── Parsers (return Float32Array of flat triangle vertices, 9 per tri). ─── */

function parseStlTriangles(bytes: Uint8Array): Float32Array {
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(256, bytes.length)));
  if (head.trim().startsWith("solid") && head.includes("facet")) {
    return parseAsciiStl(bytes);
  }
  if (bytes.length < 84) return new Float32Array(0);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
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

function parseAsciiStl(bytes: Uint8Array): Float32Array {
  const decoder = new TextDecoder();
  let cap = Math.max(1024, Math.ceil(bytes.length / 200) * 9);
  let out = new Float32Array(cap);
  let off = 0;
  let lineStart = 0;
  const len = bytes.length;
  const triBuf = new Float32Array(9);
  let triOff = 0;
  for (let i = 0; i <= len; i++) {
    const b = i < len ? bytes[i] : 10;
    if (b !== 10 && b !== 13) continue;
    if (i > lineStart) {
      const line = decoder.decode(bytes.subarray(lineStart, i));
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

function parseObjTriangles(bytes: Uint8Array): Float32Array {
  // First pass: collect vertex pool.
  let vCap = 1 << 16;
  let vCount = 0;
  let vx = new Float32Array(vCap);
  let vy = new Float32Array(vCap);
  let vz = new Float32Array(vCap);

  const pushVertex = (x: number, y: number, z: number) => {
    if (vCount === vCap) {
      vCap *= 2;
      const nx = new Float32Array(vCap); nx.set(vx); vx = nx;
      const ny = new Float32Array(vCap); ny.set(vy); vy = ny;
      const nz = new Float32Array(vCap); nz.set(vz); vz = nz;
    }
    vx[vCount] = x; vy[vCount] = y; vz[vCount] = z;
    vCount++;
  };

  // We collect face indices first, then expand triangles.
  let fCap = 1 << 16;
  let fCount = 0;
  let faceIdx = new Int32Array(fCap * 3);
  const pushTri = (a: number, b: number, c: number) => {
    if (fCount === fCap) {
      fCap *= 2;
      const nf = new Int32Array(fCap * 3); nf.set(faceIdx); faceIdx = nf;
    }
    const o = fCount * 3;
    faceIdx[o] = a; faceIdx[o + 1] = b; faceIdx[o + 2] = c;
    fCount++;
  };

  const decoder = new TextDecoder();
  const polyIdx: number[] = [];
  let lineStart = 0;
  const len = bytes.length;
  for (let i = 0; i <= len; i++) {
    const b = i < len ? bytes[i] : 10;
    if (b !== 10 && b !== 13) continue;
    if (i > lineStart) {
      const line = decoder.decode(bytes.subarray(lineStart, i));
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
        polyIdx.length = 0;
        const parts = line.substring(p + 2).trim().split(/\s+/);
        for (const tok of parts) {
          const slash = tok.indexOf("/");
          const n = parseInt(slash === -1 ? tok : tok.substring(0, slash), 10);
          if (!Number.isFinite(n)) continue;
          const vi = n < 0 ? vCount + n : n - 1;
          if (vi >= 0 && vi < vCount) polyIdx.push(vi);
        }
        for (let k = 1; k < polyIdx.length - 1; k++) {
          pushTri(polyIdx[0], polyIdx[k], polyIdx[k + 1]);
        }
      }
    }
    lineStart = i + 1;
  }

  if (vCount === 0 || fCount === 0) return new Float32Array(0);

  // Expand to flat per-triangle vertex floats.
  const out = new Float32Array(fCount * 9);
  for (let i = 0; i < fCount; i++) {
    const a = faceIdx[i * 3];
    const b = faceIdx[i * 3 + 1];
    const c = faceIdx[i * 3 + 2];
    out[i * 9]     = vx[a]; out[i * 9 + 1] = vy[a]; out[i * 9 + 2] = vz[a];
    out[i * 9 + 3] = vx[b]; out[i * 9 + 4] = vy[b]; out[i * 9 + 5] = vz[b];
    out[i * 9 + 6] = vx[c]; out[i * 9 + 7] = vy[c]; out[i * 9 + 8] = vz[c];
  }
  return out;
}
