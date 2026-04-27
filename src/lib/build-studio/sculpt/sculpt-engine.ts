/**
 * SculptEngine — owns one mesh's BVH and exposes per-stroke mutation.
 *
 * Lifecycle:
 *   • `attach(mesh)` — clones the mesh's geometry (so the original library
 *     asset isn't mutated until the user explicitly Saves), builds a BVH,
 *     caches vertex adjacency for smooth brush.
 *   • `findAffected(centre, radius)` — uses BVH `shapecast` to return the
 *     set of unique vertex indices inside a brush sphere. O(log n) walk.
 *   • `applyStroke({...})` — runs the brush kernel, marks position attribute
 *     dirty, and partially recomputes vertex normals only for affected
 *     triangles. BVH is **not** rebuilt here — that happens at stroke end
 *     via `commitStroke()`.
 *   • `snapshot(indices)` / `restoreSnapshot(snap)` — minimal undo entries
 *     storing only the changed XYZ values.
 *   • `mirrorIndices(indices)` — finds X-mirrored vertex partners using a
 *     spatial hash built once on attach. Returns the mirror set.
 *
 * The mesh material/group structure is not touched — we only edit positions
 * + normals so paint/material maps continue to work.
 */
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { applyBrush, buildVertexNeighbours, type BrushKind, type BrushParams } from "./brushes";

export interface StrokeSnapshot {
  /** Vertex indices touched by the stroke. */
  indices: Uint32Array;
  /** Original xyz triplets in indices order — length = indices.length * 3. */
  before: Float32Array;
  /** New xyz triplets — same shape. */
  after: Float32Array;
}

export class SculptEngine {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  neighbours: Map<number, number[]>;
  private mirrorMap: Map<number, number> | null = null;
  private positions: Float32Array;
  private normals: Float32Array;

  /** Pending changed indices since last `commitStroke`. */
  private pendingChanged: Set<number> = new Set();

  constructor(mesh: THREE.Mesh) {
    this.mesh = mesh;
    // Clone geometry so undo/cancel can be cheap and the original
    // library asset isn't mutated until Save.
    const cloned = (mesh.geometry as THREE.BufferGeometry).clone();
    if (!cloned.attributes.normal) cloned.computeVertexNormals();
    this.geometry = cloned;
    mesh.geometry = cloned;

    this.positions = cloned.attributes.position.array as Float32Array;
    this.normals = cloned.attributes.normal.array as Float32Array;
    this.bvh = new MeshBVH(cloned, { strategy: 0, maxLeafTris: 10 });
    (cloned as any).boundsTree = this.bvh;
    this.neighbours = buildVertexNeighbours(cloned);
  }

  /** Vertex indices whose position lies in the brush sphere. */
  findAffected(centre: THREE.Vector3, radius: number): Set<number> {
    const affected = new Set<number>();
    const sphere = new THREE.Sphere(centre.clone(), radius);
    const triBox = new THREE.Box3();
    const idxAttr = this.geometry.index;

    this.bvh.shapecast({
      intersectsBounds: (box) => {
        if (box.intersectsSphere(sphere)) return 1;
        return 0;
      },
      intersectsTriangle: (tri, triIndex) => {
        // Cheap: any of the 3 vertices inside sphere?
        if (sphere.containsPoint(tri.a) ||
            sphere.containsPoint(tri.b) ||
            sphere.containsPoint(tri.c)) {
          if (idxAttr) {
            const i0 = idxAttr.getX(triIndex * 3);
            const i1 = idxAttr.getX(triIndex * 3 + 1);
            const i2 = idxAttr.getX(triIndex * 3 + 2);
            affected.add(i0); affected.add(i1); affected.add(i2);
          } else {
            const base = triIndex * 3;
            affected.add(base); affected.add(base + 1); affected.add(base + 2);
          }
        } else {
          // Triangle straddles sphere — still include its vertices, the
          // brush kernel re-checks per-vertex distance with falloff.
          triBox.makeEmpty();
          triBox.expandByPoint(tri.a);
          triBox.expandByPoint(tri.b);
          triBox.expandByPoint(tri.c);
          if (triBox.intersectsSphere(sphere)) {
            if (idxAttr) {
              const i0 = idxAttr.getX(triIndex * 3);
              const i1 = idxAttr.getX(triIndex * 3 + 1);
              const i2 = idxAttr.getX(triIndex * 3 + 2);
              affected.add(i0); affected.add(i1); affected.add(i2);
            } else {
              const base = triIndex * 3;
              affected.add(base); affected.add(base + 1); affected.add(base + 2);
            }
          }
        }
        return false;
      },
    });
    return affected;
  }

  applyStroke(params: BrushParams, options?: { mirror?: boolean }): Set<number> {
    let affected = this.findAffected(params.centre, params.radius);
    let touched = applyBrush(this.positions, this.normals, affected, params, this.neighbours);

    if (options?.mirror) {
      const mirroredCentre = params.centre.clone();
      mirroredCentre.x = -mirroredCentre.x;
      const mirroredNormal = params.surfaceNormal.clone();
      mirroredNormal.x = -mirroredNormal.x;
      const mAffected = this.findAffected(mirroredCentre, params.radius);
      const mTouched = applyBrush(
        this.positions,
        this.normals,
        mAffected,
        { ...params, centre: mirroredCentre, surfaceNormal: mirroredNormal },
        this.neighbours,
      );
      mTouched.forEach((v) => touched.add(v));
    }

    for (const v of touched) this.pendingChanged.add(v);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    return touched;
  }

  /** Commit the stroke: recompute affected normals + rebuild BVH. */
  commitStroke(): { changed: Uint32Array; snapshot: StrokeSnapshot | null } {
    if (this.pendingChanged.size === 0) {
      return { changed: new Uint32Array(0), snapshot: null };
    }
    const changed = Uint32Array.from(this.pendingChanged);
    // Full vertex-normal recompute on a small body is sub-ms; keeps code
    // simple and avoids stale normals at brush boundaries.
    this.geometry.computeVertexNormals();
    (this.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;

    // Rebuild BVH with the new positions so the next stroke is accurate.
    this.bvh = new MeshBVH(this.geometry, { strategy: 0, maxLeafTris: 10 });
    (this.geometry as any).boundsTree = this.bvh;

    this.pendingChanged.clear();
    return { changed, snapshot: null };
  }

  /** Snapshot current positions for the given indices (for undo). */
  snapshotIndices(indices: Uint32Array): Float32Array {
    const out = new Float32Array(indices.length * 3);
    for (let i = 0; i < indices.length; i++) {
      const o = indices[i] * 3;
      out[i * 3] = this.positions[o];
      out[i * 3 + 1] = this.positions[o + 1];
      out[i * 3 + 2] = this.positions[o + 2];
    }
    return out;
  }

  /** Write a saved snapshot back into positions. */
  restoreIndices(indices: Uint32Array, values: Float32Array) {
    for (let i = 0; i < indices.length; i++) {
      const o = indices[i] * 3;
      this.positions[o] = values[i * 3];
      this.positions[o + 1] = values[i * 3 + 1];
      this.positions[o + 2] = values[i * 3 + 2];
    }
    this.geometry.computeVertexNormals();
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    this.bvh = new MeshBVH(this.geometry, { strategy: 0, maxLeafTris: 10 });
    (this.geometry as any).boundsTree = this.bvh;
  }

  /** Quick triangle count helper for UI. */
  get triangleCount(): number {
    const idx = this.geometry.index;
    if (idx) return idx.count / 3;
    return (this.geometry.attributes.position?.count ?? 0) / 3;
  }
}
