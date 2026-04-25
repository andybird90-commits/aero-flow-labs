/**
 * Shut-line aware mesh splitter.
 *
 * Splits a welded STL into geometric components by treating sharp dihedral
 * edges as walls that the flood-fill cannot cross. Targets clean CAD /
 * game-ready car meshes where panel boundaries are 60-90° creases — the
 * default 45° threshold separates panels reliably without fragmenting
 * smooth body curvature.
 *
 * Returns components with the data needed downstream:
 *   - triangleIndices into the input mesh
 *   - bbox + area for slot classification
 *   - boundaryLoops (vertices where the component touches a neighbour)
 *     used to auto-place hardpoints at mating surfaces.
 */
import type { Mesh } from "./stl-io.ts";
import { weldMesh } from "./stl-io.ts";

export interface SplitComponent {
  triangleIndices: number[];
  triangleCount: number;
  vertexCount: number;
  areaM2: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  centroid: [number, number, number];
  /** Avg unit normal of all triangles in the component. */
  avgNormal: [number, number, number];
  /** Vertex indices that lie on the boundary with another component. */
  boundaryVerts: number[];
  /** Centroid of boundary verts, useful as a hardpoint anchor. */
  boundaryCentroid: [number, number, number] | null;
}

export interface SplitResult {
  /** Welded mesh used internally — emit panels back referencing this. */
  weldedMesh: Mesh;
  components: SplitComponent[];
  /** Per-triangle component id (-1 if unassigned, shouldn't happen). */
  triangleComponent: Int32Array;
  /** Sharp-edge count, useful as a "is this a clean CAD mesh?" signal. */
  sharpEdgeCount: number;
  /** Total triangle count after welding. */
  totalTriangles: number;
}

export interface SplitOptions {
  /** Dihedral angle in degrees above which an edge is considered a shut line. */
  thresholdDeg?: number;
  /** Components below this triangle count get merged into largest neighbour. */
  minTriangles?: number;
  /** Components below this fraction of total area get merged. */
  minAreaFraction?: number;
  /** Weld tolerance in metres (or whatever input units). */
  weldEpsilon?: number;
  /** Treat units as millimetres when converting to m^2 for area thresholds. */
  unitsAreMillimetres?: boolean;
}

const DEFAULTS: Required<SplitOptions> = {
  thresholdDeg: 45,
  minTriangles: 200,
  minAreaFraction: 0.005,
  weldEpsilon: 0.001,
  unitsAreMillimetres: true,
};

/**
 * Split a mesh by dihedral creases. See SplitOptions for tuning.
 */
export function splitByCreases(mesh: Mesh, opts: SplitOptions = {}): SplitResult {
  const o = { ...DEFAULTS, ...opts };

  // Step 1 — weld so adjacent triangles actually share vertex indices.
  const welded = weldMesh(mesh, o.weldEpsilon);
  const triCount = welded.indices.length / 3;
  if (triCount === 0) {
    return {
      weldedMesh: welded,
      components: [],
      triangleComponent: new Int32Array(0),
      sharpEdgeCount: 0,
      totalTriangles: 0,
    };
  }

  // Step 2 — compute per-triangle normals + areas.
  const triNormals = new Float32Array(triCount * 3);
  const triAreas = new Float32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = welded.indices[t * 3] * 3;
    const b = welded.indices[t * 3 + 1] * 3;
    const c = welded.indices[t * 3 + 2] * 3;
    const ux = welded.positions[b] - welded.positions[a];
    const uy = welded.positions[b + 1] - welded.positions[a + 1];
    const uz = welded.positions[b + 2] - welded.positions[a + 2];
    const vx = welded.positions[c] - welded.positions[a];
    const vy = welded.positions[c + 1] - welded.positions[a + 1];
    const vz = welded.positions[c + 2] - welded.positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    triAreas[t] = len * 0.5;
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    triNormals[t * 3] = nx;
    triNormals[t * 3 + 1] = ny;
    triNormals[t * 3 + 2] = nz;
  }

  // Step 3 — edge → triangles map (key = "smaller,larger").
  const edgeToTris = new Map<number, number[]>();
  const edgeKey = (a: number, b: number): number => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    return lo * 4_000_000 + hi; // safe up to ~4M verts
  };
  for (let t = 0; t < triCount; t++) {
    const i0 = welded.indices[t * 3];
    const i1 = welded.indices[t * 3 + 1];
    const i2 = welded.indices[t * 3 + 2];
    pushEdge(edgeToTris, edgeKey(i0, i1), t);
    pushEdge(edgeToTris, edgeKey(i1, i2), t);
    pushEdge(edgeToTris, edgeKey(i2, i0), t);
  }

  // Step 4 — mark sharp edges (dihedral > threshold) and collect non-sharp
  // adjacency for the flood fill.
  const cosThreshold = Math.cos((o.thresholdDeg * Math.PI) / 180);
  const sharpEdges = new Set<number>();
  const triNeighbours: number[][] = Array.from({ length: triCount }, () => []);
  let sharpEdgeCount = 0;
  for (const [key, tris] of edgeToTris) {
    if (tris.length !== 2) continue; // boundary or non-manifold — treat as wall
    const [tA, tB] = tris;
    const dot =
      triNormals[tA * 3] * triNormals[tB * 3] +
      triNormals[tA * 3 + 1] * triNormals[tB * 3 + 1] +
      triNormals[tA * 3 + 2] * triNormals[tB * 3 + 2];
    if (dot < cosThreshold) {
      sharpEdges.add(key);
      sharpEdgeCount++;
    } else {
      triNeighbours[tA].push(tB);
      triNeighbours[tB].push(tA);
    }
  }

  // Step 5 — flood fill across non-sharp adjacency.
  const triComp = new Int32Array(triCount).fill(-1);
  const rawComponents: number[][] = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (triComp[seed] !== -1) continue;
    const compIdx = rawComponents.length;
    const queue = [seed];
    triComp[seed] = compIdx;
    const tris: number[] = [];
    while (queue.length) {
      const t = queue.pop()!;
      tris.push(t);
      const ns = triNeighbours[t];
      for (let i = 0; i < ns.length; i++) {
        const nb = ns[i];
        if (triComp[nb] === -1) {
          triComp[nb] = compIdx;
          queue.push(nb);
        }
      }
    }
    rawComponents.push(tris);
  }

  // Step 6 — sliver merge. Anything below the size or area thresholds gets
  // absorbed into its largest neighbouring component (across a sharp edge).
  // We loop until no merges happen.
  const totalArea = sumTriAreas(triAreas);
  const minArea = totalArea * o.minAreaFraction;

  // Build component-level neighbour map (across sharp edges).
  const buildCompNeighbours = (compsIn: number[][]) => {
    const n = compsIn.length;
    const compEdges: Map<number, number>[] = Array.from({ length: n }, () => new Map());
    for (const key of sharpEdges) {
      const tris = edgeToTris.get(key)!;
      if (tris.length !== 2) continue;
      const cA = triComp[tris[0]];
      const cB = triComp[tris[1]];
      if (cA === cB || cA < 0 || cB < 0) continue;
      // Approximate shared length by edge length.
      const lo = Math.floor(key / 4_000_000);
      const hi = key % 4_000_000;
      const dx = welded.positions[lo * 3] - welded.positions[hi * 3];
      const dy = welded.positions[lo * 3 + 1] - welded.positions[hi * 3 + 1];
      const dz = welded.positions[lo * 3 + 2] - welded.positions[hi * 3 + 2];
      const len = Math.hypot(dx, dy, dz);
      compEdges[cA].set(cB, (compEdges[cA].get(cB) ?? 0) + len);
      compEdges[cB].set(cA, (compEdges[cB].get(cA) ?? 0) + len);
    }
    return compEdges;
  };

  let working = rawComponents.map((tris) => tris.slice());
  // Iterate sliver merging.
  for (let pass = 0; pass < 4; pass++) {
    const compArea = working.map((tris) => {
      let s = 0;
      for (const t of tris) s += triAreas[t];
      return s;
    });
    const compNeighbours = buildCompNeighbours(working);
    let merged = false;
    // Sort small components first.
    const order = working
      .map((_, i) => i)
      .sort((a, b) => working[a].length - working[b].length);
    const consumed = new Set<number>();
    for (const i of order) {
      if (consumed.has(i)) continue;
      const tooFewTris = working[i].length < o.minTriangles;
      const tooSmall = compArea[i] < minArea;
      if (!tooFewTris && !tooSmall) continue;
      // Find the best neighbour (longest shared edge).
      let bestNb = -1;
      let bestLen = 0;
      for (const [nb, len] of compNeighbours[i]) {
        if (consumed.has(nb)) continue;
        if (len > bestLen) {
          bestLen = len;
          bestNb = nb;
        }
      }
      if (bestNb < 0) continue;
      // Merge i into bestNb.
      for (const t of working[i]) {
        triComp[t] = bestNb;
        working[bestNb].push(t);
      }
      working[i] = [];
      consumed.add(i);
      merged = true;
    }
    // Compact.
    working = working.filter((arr) => arr.length > 0);
    // Reassign triComp to the new compact ids.
    const remap = new Map<number, number>();
    for (let newId = 0; newId < working.length; newId++) {
      // Find old id from any triangle in the array.
      const sampleTri = working[newId][0];
      remap.set(triComp[sampleTri], newId);
    }
    for (let t = 0; t < triCount; t++) {
      const old = triComp[t];
      const nw = remap.get(old);
      if (nw !== undefined) triComp[t] = nw;
    }
    if (!merged) break;
  }

  // Step 7 — compute per-component summaries and boundary verts.
  const components: SplitComponent[] = working.map((tris, compId) => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let area = 0;
    let nx = 0, ny = 0, nz = 0;
    let cx = 0, cy = 0, cz = 0;
    let centroidWeight = 0;
    const localVerts = new Set<number>();

    for (const t of tris) {
      area += triAreas[t];
      const w = triAreas[t] || 1;
      nx += triNormals[t * 3] * w;
      ny += triNormals[t * 3 + 1] * w;
      nz += triNormals[t * 3 + 2] * w;
      for (let k = 0; k < 3; k++) {
        const vi = welded.indices[t * 3 + k];
        localVerts.add(vi);
        const px = welded.positions[vi * 3];
        const py = welded.positions[vi * 3 + 1];
        const pz = welded.positions[vi * 3 + 2];
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
        cx += px * w;
        cy += py * w;
        cz += pz * w;
        centroidWeight += w;
      }
    }

    const nlen = Math.hypot(nx, ny, nz) || 1;
    const cw = centroidWeight || 1;

    // Boundary verts = verts on a sharp edge whose two triangles belong to
    // different (final) components, where one of them is this component.
    const boundary = new Set<number>();
    for (const key of sharpEdges) {
      const trisOfEdge = edgeToTris.get(key)!;
      if (trisOfEdge.length !== 2) continue;
      const cA = triComp[trisOfEdge[0]];
      const cB = triComp[trisOfEdge[1]];
      if (cA === cB) continue;
      if (cA !== compId && cB !== compId) continue;
      const lo = Math.floor(key / 4_000_000);
      const hi = key % 4_000_000;
      boundary.add(lo);
      boundary.add(hi);
    }
    const boundaryVerts = Array.from(boundary);
    let boundaryCentroid: [number, number, number] | null = null;
    if (boundaryVerts.length > 0) {
      let bx = 0, by = 0, bz = 0;
      for (const v of boundaryVerts) {
        bx += welded.positions[v * 3];
        by += welded.positions[v * 3 + 1];
        bz += welded.positions[v * 3 + 2];
      }
      boundaryCentroid = [
        bx / boundaryVerts.length,
        by / boundaryVerts.length,
        bz / boundaryVerts.length,
      ];
    }

    // Convert area to m^2 if input is in millimetres.
    const areaM2 = o.unitsAreMillimetres ? area / 1_000_000 : area;

    return {
      triangleIndices: tris,
      triangleCount: tris.length,
      vertexCount: localVerts.size,
      areaM2,
      bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      centroid: [cx / cw, cy / cw, cz / cw],
      avgNormal: [nx / nlen, ny / nlen, nz / nlen],
      boundaryVerts,
      boundaryCentroid,
    };
  });

  return {
    weldedMesh: welded,
    components,
    triangleComponent: triComp,
    sharpEdgeCount,
    totalTriangles: triCount,
  };
}

function pushEdge(map: Map<number, number[]>, key: number, t: number) {
  const arr = map.get(key);
  if (arr) arr.push(t);
  else map.set(key, [t]);
}

function sumTriAreas(arr: Float32Array): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

/**
 * Build a standalone Mesh containing only the given triangle indices,
 * with re-indexed vertex positions. Used to write each panel as its own STL.
 */
export function extractComponentMesh(
  weldedMesh: Mesh,
  triangleIndices: number[],
): Mesh {
  const remap = new Map<number, number>();
  const newPos: number[] = [];
  const newIdx = new Uint32Array(triangleIndices.length * 3);
  for (let i = 0; i < triangleIndices.length; i++) {
    const t = triangleIndices[i];
    for (let k = 0; k < 3; k++) {
      const old = weldedMesh.indices[t * 3 + k];
      let nid = remap.get(old);
      if (nid === undefined) {
        nid = newPos.length / 3;
        newPos.push(
          weldedMesh.positions[old * 3],
          weldedMesh.positions[old * 3 + 1],
          weldedMesh.positions[old * 3 + 2],
        );
        remap.set(old, nid);
      }
      newIdx[i * 3 + k] = nid;
    }
  }
  return {
    positions: new Float32Array(newPos),
    indices: newIdx,
  };
}
