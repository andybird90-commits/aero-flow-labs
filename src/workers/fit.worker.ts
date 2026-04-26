/// <reference lib="webworker" />
/**
 * Off-main-thread Live Fit worker.
 *
 * Messages in:
 *   { type: "set-base", baseId, positions, indices? }
 *     – cache a base body geometry (rebuilds BVH).
 *   { type: "snap", reqId, baseId, positions, indices?, normals?, offsetM, maxDistance }
 *     – returns snapped Float32Array positions (transferable).
 *   { type: "trim", reqId, baseId, positions, indices?, normals? }
 *     – returns trimmed positions + normals + indices (or unindexed positions).
 *   { type: "snap-and-trim", … } — convenience: snap then trim in one round-trip.
 *
 * Messages out:
 *   { type: "snap-result" | "trim-result" | "fit-result" | "error", reqId, … }
 */

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { snapToSurface } from "@/lib/build-studio/fit/snap-to-surface";
import { trimToBody } from "@/lib/build-studio/fit/trim-to-body";
import { clipGeometryToAabb, partAabb } from "@/lib/build-studio/fit/clip-region";

interface BaseEntry {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  triCount: number;
}
const baseCache = new Map<string, BaseEntry>();

// CSG cost grows with both part tris and body-region tris. Keep live trim
// deliberately conservative so the worker never asks three-bvh-csg for a
// multi-GB typed array; snap still works when trim is skipped.
const TRIM_BASE_REGION_HARD_CAP = 18_000;
const TRIM_PART_HARD_CAP = 12_000;
const TRIM_PAIR_COST_HARD_CAP = 36_000_000;

function geometryTriCount(geo: THREE.BufferGeometry): number {
  return geo.index
    ? geo.index.count / 3
    : geo.attributes.position.count / 3;
}

function buildGeometry(
  positions: Float32Array,
  indices?: Uint32Array | null,
  normals?: Float32Array | null,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (indices && indices.length > 0) g.setIndex(new THREE.BufferAttribute(indices, 1));
  if (normals && normals.length === positions.length) {
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  } else {
    g.computeVertexNormals();
  }
  return g;
}

function getBase(baseId: string): BaseEntry | null {
  return baseCache.get(baseId) ?? null;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === "set-base") {
      const geo = buildGeometry(msg.positions, msg.indices ?? null, null);
      const bvh = new MeshBVH(geo, { strategy: 0, maxLeafTris: 10 });
      const triCount = geo.index
        ? geo.index.count / 3
        : geo.attributes.position.count / 3;
      baseCache.set(msg.baseId, { geometry: geo, bvh, triCount });
      (self as any).postMessage({ type: "base-ready", baseId: msg.baseId });
      return;
    }

    if (msg.type === "snap") {
      const base = getBase(msg.baseId);
      if (!base) throw new Error(`Base "${msg.baseId}" not loaded`);
      const part = buildGeometry(msg.positions, msg.indices ?? null, msg.normals ?? null);
      const result = snapToSurface(
        { partGeometry: part, baseBVH: base.bvh },
        { offsetM: msg.offsetM, maxDistance: msg.maxDistance },
      );
      const pos = (result.attributes.position.array as Float32Array);
      const nor = (result.attributes.normal.array as Float32Array);
      (self as any).postMessage(
        { type: "snap-result", reqId: msg.reqId, positions: pos, normals: nor },
        [pos.buffer as ArrayBuffer, nor.buffer as ArrayBuffer],
      );
      return;
    }

    if (msg.type === "trim" || msg.type === "snap-and-trim") {
      const base = getBase(msg.baseId);
      if (!base) throw new Error(`Base "${msg.baseId}" not loaded`);
      let part = buildGeometry(msg.positions, msg.indices ?? null, msg.normals ?? null);

      if (msg.type === "snap-and-trim") {
        part = snapToSurface(
          { partGeometry: part, baseBVH: base.bvh },
          { offsetM: msg.offsetM, maxDistance: msg.maxDistance },
        );
      }

      // Clip the base body to a small region around the (snapped) part. This
      // keeps the CSG SUBTRACTION evaluator's intermediate buffers bounded —
      // unclipped bodies can blow past 4 GB allocations and crash the worker.
      const aabb = partAabb(part);
      const clipped = clipGeometryToAabb(base.geometry, aabb, {
        paddingM: 0.18,
        maxTris: TRIM_BASE_REGION_HARD_CAP,
      });
      const partTriCount = geometryTriCount(part);
      const estimatedPairCost = partTriCount * clipped.triCount;

      let trimmed: THREE.BufferGeometry | null = null;
      // Skip trim if either mesh is too dense or the estimated CSG pair cost
      // is high. This prevents "Invalid typed array length" crashes while
      // still returning the snapped geometry as a usable Live Fit preview.
      const safeForCsg =
        !clipped.truncated &&
        clipped.triCount > 0 &&
        clipped.triCount <= TRIM_BASE_REGION_HARD_CAP &&
        partTriCount <= TRIM_PART_HARD_CAP &&
        estimatedPairCost <= TRIM_PAIR_COST_HARD_CAP;

      if (safeForCsg) {
        try {
          trimmed = trimToBody({
            partGeometry: part,
            baseGeometry: clipped.geometry,
          });
        } catch (csgErr) {
          // CSG can still OOM on tricky geometry — fall back to snap-only.
          (self as any).postMessage({
            type: "trim-warning",
            reqId: msg.reqId,
            message: `Trim skipped: ${String((csgErr as Error)?.message ?? csgErr)}`,
          });
          trimmed = null;
        }
      }

      const finalGeo = trimmed ?? part;
      const pos = finalGeo.attributes.position.array as Float32Array;
      const nor = (finalGeo.attributes.normal?.array as Float32Array | undefined) ??
        new Float32Array(pos.length);
      const idxAttr = finalGeo.index;
      const idx = idxAttr ? (idxAttr.array as Uint32Array).slice() : null;

      const transfer: ArrayBuffer[] = [pos.buffer as ArrayBuffer, nor.buffer as ArrayBuffer];
      if (idx) transfer.push(idx.buffer as ArrayBuffer);

      (self as any).postMessage(
        {
          type: msg.type === "trim" ? "trim-result" : "fit-result",
          reqId: msg.reqId,
          positions: pos,
          normals: nor,
          indices: idx,
          /** Tells the UI whether CSG actually ran or we fell back to snap. */
          trimApplied: !!trimmed,
        },
        transfer,
      );
      return;
    }
  } catch (err: any) {
    (self as any).postMessage({
      type: "error",
      reqId: msg?.reqId ?? null,
      message: String(err?.message ?? err),
    });
  }
};

export {};

