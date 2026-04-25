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

interface BaseEntry {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
}
const baseCache = new Map<string, BaseEntry>();

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
      baseCache.set(msg.baseId, { geometry: geo, bvh });
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
        [pos.buffer, nor.buffer],
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

      const trimmed = trimToBody({ partGeometry: part, baseGeometry: base.geometry });
      const pos = trimmed.attributes.position.array as Float32Array;
      const nor = trimmed.attributes.normal.array as Float32Array;
      const idxAttr = trimmed.index;
      const idx = idxAttr ? (idxAttr.array as Uint32Array).slice() : null;

      const transfer: ArrayBuffer[] = [pos.buffer, nor.buffer];
      if (idx) transfer.push(idx.buffer);

      (self as any).postMessage(
        {
          type: msg.type === "trim" ? "trim-result" : "fit-result",
          reqId: msg.reqId,
          positions: pos,
          normals: nor,
          indices: idx,
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
