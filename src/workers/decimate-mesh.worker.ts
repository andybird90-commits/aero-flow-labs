/// <reference lib="webworker" />
/**
 * Web Worker wrapper around `decimateMeshFile`.
 *
 * Posts:
 *   in  → { id, bytes: ArrayBuffer, filename, targetTriangles }
 *   out → { id, ok: true, result } | { id, ok: false, error }
 */
import { decimateMeshFile } from "@/lib/mesh-decimate";

interface InMsg {
  id: number;
  bytes: ArrayBuffer;
  filename: string;
  targetTriangles: number;
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const { id, bytes, filename, targetTriangles } = e.data;
  try {
    const r = decimateMeshFile(new Uint8Array(bytes), filename, targetTriangles);
    (self as unknown as Worker).postMessage(
      {
        id,
        ok: true,
        result: {
          bytes: r.bytes.buffer,
          triCountIn: r.triCountIn,
          triCountOut: r.triCountOut,
          vertCountOut: r.vertCountOut,
          bboxMin: r.bboxMin,
          bboxMax: r.bboxMax,
        },
      },
      [r.bytes.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: String((err as Error).message ?? err),
    });
  }
};
