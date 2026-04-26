/**
 * Shared STL parse/write helpers used across the aero-kit edge functions.
 *
 * Kept tiny and dependency-free so each edge function pulls only what it needs.
 * Coordinates are whatever units the input STL uses (typically millimetres for
 * the hero-car library — see `bbox_min_mm` / `bbox_max_mm` on `car_stls`).
 */

export interface Mesh {
  /** Flat vertex array, length = vCount * 3. */
  positions: Float32Array;
  /** Triangle indices into `positions / 3`, length = triCount * 3. */
  indices: Uint32Array;
}

export function parseStl(bytes: Uint8Array): Mesh {
  const head = new TextDecoder().decode(bytes.slice(0, Math.min(256, bytes.length)));
  if (head.trim().startsWith("solid") && head.includes("facet")) {
    return parseAsciiStl(new TextDecoder().decode(bytes));
  }
  return parseBinaryStl(bytes);
}

/**
 * Edge functions run with a ~150 MB heap. A binary STL with N triangles
 * needs N * 9 * 4 bytes (positions) ≈ 36 B/tri just for vertex data, and
 * downstream callers (e.g. classify-car-materials) allocate several more
 * Float32/Int32 arrays per triangle for centroids, normals, adjacency,
 * component ids and a vertex-weld Map. In practice we need to stay under
 * ~120 B/tri end-to-end, so cap parsed triangles at 250k and uniformly
 * downsample anything larger. The classifier only needs an indicative tag
 * map per triangle, so a uniform sample preserves accuracy.
 */
const MAX_PARSED_TRIANGLES = 250_000;

function parseBinaryStl(bytes: Uint8Array): Mesh {
  if (bytes.length < 84) return emptyMesh();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = dv.getUint32(80, true);
  // Stride > 1 means "keep every Nth triangle" — uniform decimation.
  const stride = total > MAX_PARSED_TRIANGLES
    ? Math.ceil(total / MAX_PARSED_TRIANGLES)
    : 1;
  const count = Math.ceil(total / stride);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let vi = 0;
  let written = 0;
  for (let i = 0; i < total && written < count; i++) {
    if (i % stride !== 0) continue;
    const off = 84 + i * 50;
    if (off + 50 > bytes.length) break;
    for (let k = 0; k < 9; k++) {
      positions[written * 9 + k] = dv.getFloat32(off + 12 + k * 4, true);
    }
    indices[written * 3]     = vi++;
    indices[written * 3 + 1] = vi++;
    indices[written * 3 + 2] = vi++;
    written++;
  }
  // Trim unused tail if early-exit triggered.
  if (written < count) {
    return {
      positions: positions.slice(0, written * 9),
      indices: indices.slice(0, written * 3),
    };
  }
  return { positions, indices };
}

function parseAsciiStl(text: string): Mesh {
  const re = /facet\s+normal\s+[-\d.eE+]+\s+[-\d.eE+]+\s+[-\d.eE+]+\s+outer\s+loop\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const verts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (let k = 1; k <= 9; k++) verts.push(parseFloat(m[k]));
  }
  const triCount = verts.length / 9;
  const positions = new Float32Array(verts);
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount * 3; i++) indices[i] = i;
  return { positions, indices };
}

function emptyMesh(): Mesh {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

/** Write a binary STL from indexed positions + indices. */
export function writeBinaryStl(mesh: Mesh): Uint8Array {
  const triCount = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let i = 0; i < triCount; i++) {
    const a = mesh.indices[i * 3] * 3;
    const b = mesh.indices[i * 3 + 1] * 3;
    const c = mesh.indices[i * 3 + 2] * 3;
    const ax = mesh.positions[a],     ay = mesh.positions[a + 1], az = mesh.positions[a + 2];
    const bx = mesh.positions[b],     by = mesh.positions[b + 1], bz = mesh.positions[b + 2];
    const cx = mesh.positions[c],     cy = mesh.positions[c + 1], cz = mesh.positions[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(off,      nx, true);
    dv.setFloat32(off + 4,  ny, true);
    dv.setFloat32(off + 8,  nz, true);
    dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
    dv.setUint16(off + 48, 0, true);
    off += 50;
  }
  return new Uint8Array(buf);
}

/** Index-weld a mesh (collapse coincident vertices on a coarse grid). */
export function weldMesh(mesh: Mesh, eps = 0.05): Mesh {
  const map = new Map<string, number>();
  const newPos: number[] = [];
  const newIdx = new Uint32Array(mesh.indices.length);
  const k = (v: number) => Math.round(v / eps);

  for (let i = 0; i < mesh.indices.length; i++) {
    const vi = mesh.indices[i] * 3;
    const x = mesh.positions[vi];
    const y = mesh.positions[vi + 1];
    const z = mesh.positions[vi + 2];
    const key = `${k(x)},${k(y)},${k(z)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = newPos.length / 3;
      newPos.push(x, y, z);
      map.set(key, id);
    }
    newIdx[i] = id;
  }

  return { positions: new Float32Array(newPos), indices: newIdx };
}

/** Compute bbox in mesh space. */
export function bbox(mesh: Mesh): { min: [number, number, number]; max: [number, number, number] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
