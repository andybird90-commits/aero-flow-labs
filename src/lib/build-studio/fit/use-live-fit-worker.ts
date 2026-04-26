/**
 * useLiveFitWorker — singleton wrapper around the Live Fit web worker.
 *
 * Lifecycle:
 *   • Worker is lazily created on first use, kept alive across components.
 *   • Base body geometry is uploaded once per `baseId` (positions+indices) —
 *     subsequent snap/trim calls just reference the cached BVH inside the
 *     worker.
 *   • All ops are request/response with a monotonic reqId so the latest
 *     answer wins and stale results from a discarded slider position are
 *     dropped on the floor.
 */
import { useCallback, useEffect, useRef } from "react";

let workerSingleton: Worker | null = null;
const knownBases = new Set<string>();

function getWorker(): Worker {
  if (!workerSingleton) {
    workerSingleton = new Worker(
      new URL("@/workers/fit.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return workerSingleton;
}

export interface FitGeometry {
  positions: Float32Array;
  normals?: Float32Array | null;
  indices?: Uint32Array | null;
}

export interface FitResult {
  positions: Float32Array;
  normals: Float32Array;
  indices?: Uint32Array | null;
  /** True when the worker actually ran CSG trim. False when it fell back to
   *  snap-only (huge body / OOM-protected). Always true for plain "snap". */
  trimApplied?: boolean;
}

export function useLiveFitWorker() {
  const reqRef = useRef(0);
  const pendingRef = useRef(new Map<number, (msg: any) => void>());

  useEffect(() => {
    const w = getWorker();
    const onMsg = (e: MessageEvent) => {
      const { reqId } = e.data ?? {};
      const cb = pendingRef.current.get(reqId);
      if (cb) {
        pendingRef.current.delete(reqId);
        cb(e.data);
      }
    };
    w.addEventListener("message", onMsg);
    return () => w.removeEventListener("message", onMsg);
  }, []);

  /**
   * Upload a base body geometry to the worker (once per baseId). Resolves
   * when the worker confirms it's ready.
   */
  const setBase = useCallback(async (baseId: string, base: FitGeometry) => {
    if (knownBases.has(baseId)) return;
    const w = getWorker();
    return new Promise<void>((resolve) => {
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "base-ready" && e.data.baseId === baseId) {
          w.removeEventListener("message", handler);
          knownBases.add(baseId);
          resolve();
        }
      };
      w.addEventListener("message", handler);
      // Clone arrays before transferring — caller may want to keep theirs.
      const positions = base.positions.slice();
      const indices = base.indices ? base.indices.slice() : null;
      const transfer: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
      if (indices) transfer.push(indices.buffer as ArrayBuffer);
      w.postMessage({ type: "set-base", baseId, positions, indices }, transfer);
    });
  }, []);

  const run = useCallback(
    (
      type: "snap" | "trim" | "snap-and-trim",
      baseId: string,
      part: FitGeometry,
      opts: { offsetM?: number; maxDistance?: number } = {},
    ): Promise<FitResult> => {
      const w = getWorker();
      const reqId = ++reqRef.current;
      const positions = part.positions.slice();
      const indices = part.indices ? part.indices.slice() : null;
      const normals = part.normals ? part.normals.slice() : null;
      const transfer: ArrayBuffer[] = [positions.buffer as ArrayBuffer];
      if (indices) transfer.push(indices.buffer as ArrayBuffer);
      if (normals) transfer.push(normals.buffer as ArrayBuffer);

      return new Promise((resolve, reject) => {
        pendingRef.current.set(reqId, (msg) => {
          if (msg.type === "error") reject(new Error(msg.message));
          else resolve({
            positions: msg.positions,
            normals: msg.normals,
            indices: msg.indices ?? null,
            trimApplied: msg.trimApplied,
          });
        });
        w.postMessage(
          {
            type, reqId, baseId, positions, indices, normals,
            offsetM: opts.offsetM ?? 0,
            maxDistance: opts.maxDistance ?? 0.25,
          },
          transfer,
        );
      });
    },
    [],
  );

  /** Returns the most recent reqId issued — used by callers to discard stale results. */
  const latestReqId = useCallback(() => reqRef.current, []);

  return { setBase, run, latestReqId };
}
