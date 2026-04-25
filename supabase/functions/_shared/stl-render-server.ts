/**
 * Server-side silhouette rasteriser for STL meshes — Deno-compatible, no WebGL.
 *
 * Produces a binary occupancy mask per camera angle that mirrors the framing
 * of the concept generator's 4 fixed cameras. The output is a `size × size`
 * `Uint8Array` (1 = body covers pixel, 0 = empty) plus the projection matrix
 * we used, so the displacement step can back-project pixel-space deltas into
 * 3D vertex offsets.
 *
 * We rasterise via a simple z-buffer over projected triangles. No shading,
 * no textures, no MSAA — just "is this pixel inside any front-facing
 * triangle". 1024² runs in ~500ms for a 200k-tri mesh in Deno.
 */
import type { Mesh } from "./stl-io.ts";

export type AngleKey =
  | "front_three_quarter"
  | "side"
  | "rear_three_quarter"
  | "rear";

export type ForwardAxis = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export interface RenderedView {
  /** size×size binary mask. 1 = covered, 0 = empty. */
  mask: Uint8Array;
  /** Per-pixel depth in world units (Infinity where no triangle hit). */
  depth: Float32Array;
  /** Per-pixel triangle index (-1 where no hit). Length = size*size. Optional. */
  triIndex?: Int32Array;
  /** Per-pixel shaded grayscale (0–255). Optional. Only present when shaded=true. */
  shade?: Uint8Array;
  /** Combined view-projection matrix (4x4, column-major) we used. */
  viewProj: Float32Array;
  /** Inverse view matrix — camera basis in world space (cam→world). */
  camToWorld: Float32Array;
  size: number;
  /** Half-FOV in radians (vertical) for back-projection arithmetic. */
  halfFovY: number;
  /** Camera position in world. */
  eye: [number, number, number];
}

const ANGLES: Record<AngleKey, { dir: [number, number, number]; distMul: number; yOffset: number }> = {
  front_three_quarter: { dir: [-0.85, 0.25, -1.0], distMul: 1.6, yOffset: 0.45 },
  side:                { dir: [0,     0.05, -1.6], distMul: 1.55, yOffset: 0.4 },
  rear_three_quarter:  { dir: [0.85,  0.25,  1.0], distMul: 1.6, yOffset: 0.45 },
  rear:                { dir: [0,     0.10,  1.6], distMul: 1.5, yOffset: 0.4 },
};

/** Apply the forward-axis correction in place to a mesh copy. */
export function reorientMesh(mesh: Mesh, axis: ForwardAxis): Mesh {
  const out = new Float32Array(mesh.positions);
  // Same axis convention as src/lib/stl-render.ts (-z = canonical forward).
  const xform = (x: number, y: number, z: number): [number, number, number] => {
    switch (axis) {
      case "-z": return [x, y, z];
      case "+z": return [-x, y, -z];
      case "+x": return [-z, y, x];
      case "-x": return [z, y, -x];
      case "-y": return [x, -z, y];
      case "+y": return [x, z, -y];
    }
  };
  for (let i = 0; i < out.length; i += 3) {
    const [nx, ny, nz] = xform(out[i], out[i + 1], out[i + 2]);
    out[i] = nx; out[i + 1] = ny; out[i + 2] = nz;
  }
  return { positions: out, indices: mesh.indices };
}

export function meshBbox(mesh: Mesh): { min: [number, number, number]; max: [number, number, number]; centre: [number, number, number]; longest: number; height: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], centre: [cx, cy, cz], longest: Math.max(sx, sy, sz, 1), height: sy || 1 };
}

/** 4×4 multiply (column-major). */
function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  }
  return o;
}

/** Build a perspective projection (column-major). */
function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

/** Build a look-at view matrix (column-major). */
function lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): { view: Float32Array; camToWorld: Float32Array } {
  const fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = [fx / fl, fy / fl, fz / fl];
  // s = normalise(cross(f, up))
  let sx = f[1] * up[2] - f[2] * up[1];
  let sy = f[2] * up[0] - f[0] * up[2];
  let sz = f[0] * up[1] - f[1] * up[0];
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl; sy /= sl; sz /= sl;
  // u = cross(s, f)
  const ux = sy * f[2] - sz * f[1];
  const uy = sz * f[0] - sx * f[2];
  const uz = sx * f[1] - sy * f[0];

  const view = new Float32Array(16);
  view[0] = sx; view[4] = sy; view[8]  = sz; view[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
  view[1] = ux; view[5] = uy; view[9]  = uz; view[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  view[2] = -f[0]; view[6] = -f[1]; view[10] = -f[2]; view[14] = (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]);
  view[15] = 1;

  const camToWorld = new Float32Array(16);
  camToWorld[0] = sx;  camToWorld[1] = ux;  camToWorld[2]  = -f[0];
  camToWorld[4] = sy;  camToWorld[5] = uy;  camToWorld[6]  = -f[1];
  camToWorld[8] = sz;  camToWorld[9] = uz;  camToWorld[10] = -f[2];
  camToWorld[12] = eye[0]; camToWorld[13] = eye[1]; camToWorld[14] = eye[2]; camToWorld[15] = 1;

  return { view, camToWorld };
}

export function renderAngle(
  mesh: Mesh,
  angle: AngleKey,
  size = 512,
  fovYDeg = 28,
  opts: { shaded?: boolean; triIndex?: boolean } = {},
): RenderedView {
  const bb = meshBbox(mesh);
  const cx = bb.centre[0], cy = bb.centre[1], cz = bb.centre[2];

  const cfg = ANGLES[angle];
  const dl = Math.hypot(...cfg.dir) || 1;
  const dist = bb.longest * cfg.distMul;
  const eye: [number, number, number] = [
    (cfg.dir[0] / dl) * dist + cx,
    bb.height * cfg.yOffset + (cy - bb.height / 2) + cy,
    (cfg.dir[2] / dl) * dist + cz,
  ];
  eye[1] = cy + bb.height * cfg.yOffset;

  const target: [number, number, number] = [cx, cy, cz];
  const fovY = (fovYDeg * Math.PI) / 180;
  const near = bb.longest * 0.05;
  const far  = bb.longest * 20;

  const { view, camToWorld } = lookAt(eye, target, [0, 1, 0]);
  const proj = perspective(fovY, 1, near, far);
  const viewProj = mat4Mul(proj, view);

  const mask = new Uint8Array(size * size);
  const depth = new Float32Array(size * size);
  for (let i = 0; i < depth.length; i++) depth[i] = Infinity;
  const wantIdx = opts.triIndex || opts.shaded;
  const triIndex = wantIdx ? new Int32Array(size * size).fill(-1) : undefined;

  const triCount = mesh.indices.length / 3;
  const sx = [0, 0, 0], sy = [0, 0, 0], sz = [0, 0, 0];

  for (let t = 0; t < triCount; t++) {
    const ia = mesh.indices[t * 3]     * 3;
    const ib = mesh.indices[t * 3 + 1] * 3;
    const ic = mesh.indices[t * 3 + 2] * 3;

    const verts: number[] = [
      mesh.positions[ia], mesh.positions[ia + 1], mesh.positions[ia + 2],
      mesh.positions[ib], mesh.positions[ib + 1], mesh.positions[ib + 2],
      mesh.positions[ic], mesh.positions[ic + 1], mesh.positions[ic + 2],
    ];

    let behindNear = false;
    for (let k = 0; k < 3; k++) {
      const wx = verts[k * 3], wy = verts[k * 3 + 1], wz = verts[k * 3 + 2];
      const cx_ = viewProj[0] * wx + viewProj[4] * wy + viewProj[8]  * wz + viewProj[12];
      const cy_ = viewProj[1] * wx + viewProj[5] * wy + viewProj[9]  * wz + viewProj[13];
      const cz_ = viewProj[2] * wx + viewProj[6] * wy + viewProj[10] * wz + viewProj[14];
      const cw_ = viewProj[3] * wx + viewProj[7] * wy + viewProj[11] * wz + viewProj[15];
      if (cw_ <= 0) { behindNear = true; break; }
      const ndcX = cx_ / cw_;
      const ndcY = cy_ / cw_;
      sx[k] = (ndcX * 0.5 + 0.5) * size;
      sy[k] = (1 - (ndcY * 0.5 + 0.5)) * size;
      sz[k] = cz_ / cw_;
    }
    if (behindNear) continue;

    rasteriseTri(sx[0], sy[0], sz[0], sx[1], sy[1], sz[1], sx[2], sy[2], sz[2], size, mask, depth, t, triIndex);
  }

  // Optional shading pass: derive grayscale per-pixel from the triangle's
  // face normal (Lambert with two fixed lights). Cheap because we have
  // triIndex already.
  let shade: Uint8Array | undefined;
  if (opts.shaded && triIndex) {
    shade = new Uint8Array(size * size);
    // Light dirs in world space
    const L1 = normalize3(0.5, 1.0, 0.6);
    const L2 = normalize3(-0.4, 0.7, -0.5);
    for (let i = 0; i < triIndex.length; i++) {
      const t = triIndex[i];
      if (t < 0) { shade[i] = 16; continue; } // dark background
      const ia = mesh.indices[t * 3]     * 3;
      const ib = mesh.indices[t * 3 + 1] * 3;
      const ic = mesh.indices[t * 3 + 2] * 3;
      const ax = mesh.positions[ia], ay = mesh.positions[ia + 1], az = mesh.positions[ia + 2];
      const bx = mesh.positions[ib], by = mesh.positions[ib + 1], bz = mesh.positions[ib + 2];
      const cxv = mesh.positions[ic], cyv = mesh.positions[ic + 1], czv = mesh.positions[ic + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cxv - ax, vy = cyv - ay, vz = czv - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const ln = Math.hypot(nx, ny, nz) || 1;
      nx /= ln; ny /= ln; nz /= ln;
      const d1 = Math.max(0, nx * L1[0] + ny * L1[1] + nz * L1[2]);
      const d2 = Math.max(0, nx * L2[0] + ny * L2[1] + nz * L2[2]);
      const v = 28 + 180 * d1 + 50 * d2;
      shade[i] = Math.min(255, Math.max(0, Math.round(v)));
    }
  }

  return {
    mask, depth, viewProj, camToWorld, size,
    halfFovY: fovY / 2,
    eye,
    triIndex,
    shade,
  };
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function rasteriseTri(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  size: number, mask: Uint8Array, depth: Float32Array,
  triId?: number, triIndex?: Int32Array,
): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (maxX < minX || maxY < minY) return;

  const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(denom) < 1e-9) return;
  const invDenom = 1 / denom;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const w0 = ((y1 - y2) * (px + 0.5 - x2) + (x2 - x1) * (py + 0.5 - y2)) * invDenom;
      const w1 = ((y2 - y0) * (px + 0.5 - x2) + (x0 - x2) * (py + 0.5 - y2)) * invDenom;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * z0 + w1 * z1 + w2 * z2;
      const idx = py * size + px;
      if (z < depth[idx]) {
        depth[idx] = z;
        mask[idx] = 1;
        if (triIndex && triId !== undefined) triIndex[idx] = triId;
      }
    }
  }
}

/** Project a single world point to pixel space using the cached viewProj. */
export function projectPoint(viewProj: Float32Array, size: number, x: number, y: number, z: number): { px: number; py: number; depth: number; w: number } {
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8]  * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9]  * z + viewProj[13];
  const cz = viewProj[2] * x + viewProj[6] * y + viewProj[10] * z + viewProj[14];
  const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (cw <= 0) return { px: -1, py: -1, depth: 0, w: 0 };
  const ndcX = cx / cw, ndcY = cy / cw;
  return {
    px: (ndcX * 0.5 + 0.5) * size,
    py: (1 - (ndcY * 0.5 + 0.5)) * size,
    depth: cz / cw,
    w: cw,
  };
}

export const ANGLE_KEYS: AngleKey[] = ["front_three_quarter", "side", "rear_three_quarter", "rear"];
