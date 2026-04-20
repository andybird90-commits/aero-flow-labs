/**
 * Zone-targeted subdivision for hero-car STLs prior to displacement.
 *
 * The displacement step pushes vertices outward where the concept silhouette
 * extends past the stock body. Per-vertex displacement only resolves features
 * as fine as the underlying tessellation, so any triangle that lives in a
 * "kit zone" (front bumper, rear bumper, arches, underfloor) is split into
 * 4 smaller triangles by midpoint subdivision until it's below ~5 mm spacing.
 *
 * Triangles outside kit zones are left alone — splitting the roof or doors
 * costs memory without helping the result.
 */
import type { Mesh } from "./stl-io.ts";

export interface BBox { min: [number, number, number]; max: [number, number, number] }

/** Generate the 6 zone bboxes from the overall mesh bbox (canonical -Z forward). */
export function kitZones(bb: BBox): BBox[] {
  const [minX, minY, minZ] = bb.min;
  const [maxX, maxY, maxZ] = bb.max;
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
  return [
    // front bumper
    { min: [minX, minY, minZ],                 max: [maxX, minY + sy * 0.45, minZ + sz * 0.20] },
    // rear bumper
    { min: [minX, minY, minZ + sz * 0.80],     max: [maxX, minY + sy * 0.55, maxZ] },
    // wing zone (rear top)
    { min: [minX, minY + sy * 0.55, minZ + sz * 0.70], max: [maxX, maxY, maxZ] },
    // side skirts (low side strips)
    { min: [minX, minY, minZ + sz * 0.20],     max: [minX + sx * 0.10, minY + sy * 0.35, minZ + sz * 0.80] },
    { min: [maxX - sx * 0.10, minY, minZ + sz * 0.20], max: [maxX, minY + sy * 0.35, minZ + sz * 0.80] },
    // underfloor / diffuser zone
    { min: [minX, minY, minZ + sz * 0.10],     max: [maxX, minY + sy * 0.15, maxZ - sz * 0.05] },
  ];
}

function pointInZones(x: number, y: number, z: number, zones: BBox[]): boolean {
  for (const z2 of zones) {
    if (x >= z2.min[0] && x <= z2.max[0] &&
        y >= z2.min[1] && y <= z2.max[1] &&
        z >= z2.min[2] && z <= z2.max[2]) return true;
  }
  return false;
}

/** Subdivide triangles whose centroid is inside any kit zone until edge < targetMm. */
export function subdivideZones(mesh: Mesh, zones: BBox[], targetMm: number): Mesh {
  const positions: number[] = Array.from(mesh.positions);
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    triangles.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
  }

  const midpointCache = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const mx = (positions[a * 3]     + positions[b * 3])     / 2;
    const my = (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2;
    const mz = (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2;
    const id = positions.length / 3;
    positions.push(mx, my, mz);
    midpointCache.set(key, id);
    return id;
  };

  // Iterative subdivide: at each pass, split any zone-triangle whose longest edge > target.
  // Cap iterations so degenerate inputs can't blow up.
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let any = false;
    const next: [number, number, number][] = [];
    for (const [a, b, c] of triangles) {
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
      const ccx = (ax + bx + cx) / 3, ccy = (ay + by + cy) / 3, ccz = (az + bz + cz) / 3;
      if (!pointInZones(ccx, ccy, ccz, zones)) {
        next.push([a, b, c]);
        continue;
      }
      const e0 = Math.hypot(bx - ax, by - ay, bz - az);
      const e1 = Math.hypot(cx - bx, cy - by, cz - bz);
      const e2 = Math.hypot(ax - cx, ay - cy, az - cz);
      const longest = Math.max(e0, e1, e2);
      if (longest <= targetMm) {
        next.push([a, b, c]);
        continue;
      }
      const m0 = midpoint(a, b);
      const m1 = midpoint(b, c);
      const m2 = midpoint(c, a);
      next.push([a, m0, m2], [m0, b, m1], [m2, m1, c], [m0, m1, m2]);
      any = true;
    }
    triangles.length = 0;
    triangles.push(...next);
    if (!any) break;
  }

  const idxArr = new Uint32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    idxArr[i * 3]     = triangles[i][0];
    idxArr[i * 3 + 1] = triangles[i][1];
    idxArr[i * 3 + 2] = triangles[i][2];
  }
  return { positions: new Float32Array(positions), indices: idxArr };
}
