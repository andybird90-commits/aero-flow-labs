/**
 * Classify a mesh fragment into an aero-kit `kind` based on where its bounding
 * box sits relative to the parent (whole-car) bounding box.
 *
 * Coordinates assume canonical -Z forward / +Y up — the same frame used by the
 * silhouette renderer. Components that don't fall cleanly into a known zone
 * are tagged "custom" so the user can rename them in the Library.
 */
import type { Mesh } from "./stl-io.ts";

export type PartKind =
  | "splitter" | "diffuser" | "side_skirt" | "wide_arch"
  | "wing"     | "ducktail" | "bonnet_vent" | "custom";

export interface BBox { min: [number, number, number]; max: [number, number, number] }

export function meshBboxOf(mesh: Mesh): BBox {
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

export function classifyByZone(part: BBox, car: BBox): PartKind {
  const sx = car.max[0] - car.min[0] || 1;
  const sy = car.max[1] - car.min[1] || 1;
  const sz = car.max[2] - car.min[2] || 1;
  const cx = (part.min[0] + part.max[0]) / 2;
  const cy = (part.min[1] + part.max[1]) / 2;
  const cz = (part.min[2] + part.max[2]) / 2;
  const nx = (cx - car.min[0]) / sx; // 0..1 left→right
  const ny = (cy - car.min[1]) / sy; // 0..1 bottom→top
  const nz = (cz - car.min[2]) / sz; // 0..1 front→rear

  // Front-low → splitter
  if (nz < 0.25 && ny < 0.35) return "splitter";
  // Rear-low → diffuser
  if (nz > 0.75 && ny < 0.35) return "diffuser";
  // Rear-high → wing
  if (nz > 0.70 && ny > 0.70) return "wing";
  // Mid-rear, mid-y → ducktail
  if (nz > 0.65 && ny >= 0.40 && ny <= 0.70) return "ducktail";
  // Side-low strips → side_skirt
  if ((nx < 0.18 || nx > 0.82) && ny < 0.35 && nz >= 0.20 && nz <= 0.80) return "side_skirt";
  // Over wheel zones (front/rear axle-ish, mid-y) → wide_arch
  if ((nx < 0.20 || nx > 0.80) && ny < 0.55 && (nz < 0.30 || nz > 0.70)) return "wide_arch";
  // Bonnet area → bonnet_vent
  if (nz < 0.40 && ny > 0.55) return "bonnet_vent";
  return "custom";
}

/**
 * Split a mesh into connected components using vertex-shared edges.
 * Returns an array of new meshes (with positions filtered to the component).
 */
export function splitConnectedComponents(mesh: Mesh): Mesh[] {
  const triCount = mesh.indices.length / 3;
  if (triCount === 0) return [];
  const vCount = mesh.positions.length / 3;

  // Vertex → triangles map.
  const vTris: number[][] = Array.from({ length: vCount }, () => []);
  for (let t = 0; t < triCount; t++) {
    vTris[mesh.indices[t * 3]].push(t);
    vTris[mesh.indices[t * 3 + 1]].push(t);
    vTris[mesh.indices[t * 3 + 2]].push(t);
  }

  const triComp = new Int32Array(triCount).fill(-1);
  const components: number[][] = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (triComp[seed] !== -1) continue;
    const compIdx = components.length;
    const queue = [seed];
    triComp[seed] = compIdx;
    const tris: number[] = [];
    while (queue.length) {
      const t = queue.pop()!;
      tris.push(t);
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k];
        for (const t2 of vTris[v]) {
          if (triComp[t2] === -1) {
            triComp[t2] = compIdx;
            queue.push(t2);
          }
        }
      }
    }
    components.push(tris);
  }

  // Build a Mesh per component with re-indexed positions.
  return components.map((tris) => {
    const remap = new Map<number, number>();
    const newPos: number[] = [];
    const newIdx = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      for (let k = 0; k < 3; k++) {
        const old = mesh.indices[t * 3 + k];
        let nid = remap.get(old);
        if (nid === undefined) {
          nid = newPos.length / 3;
          newPos.push(
            mesh.positions[old * 3],
            mesh.positions[old * 3 + 1],
            mesh.positions[old * 3 + 2],
          );
          remap.set(old, nid);
        }
        newIdx[i * 3 + k] = nid;
      }
    }
    return { positions: new Float32Array(newPos), indices: newIdx };
  });
}

/** Approximate volume from a triangle soup (signed tetrahedra w/ origin). */
export function approxVolume(mesh: Mesh): number {
  let v = 0;
  const triCount = mesh.indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    const a = mesh.indices[t * 3]     * 3;
    const b = mesh.indices[t * 3 + 1] * 3;
    const c = mesh.indices[t * 3 + 2] * 3;
    const ax = mesh.positions[a], ay = mesh.positions[a + 1], az = mesh.positions[a + 2];
    const bx = mesh.positions[b], by = mesh.positions[b + 1], bz = mesh.positions[b + 2];
    const cx = mesh.positions[c], cy = mesh.positions[c + 1], cz = mesh.positions[c + 2];
    v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}
