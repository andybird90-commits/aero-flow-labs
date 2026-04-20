/**
 * Main-thread helper that runs the decimation worker and returns a File.
 *
 * The output is always a `.stl` (binary), regardless of input format —
 * lossy decimation makes preserving the original format meaningless.
 */
export interface DecimateClientResult {
  file: File;
  triCountIn: number;
  triCountOut: number;
  vertCountOut: number;
  originalSizeBytes: number;
  decimatedSizeBytes: number;
}

let worker: Worker | null = null;
let nextId = 1;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    new URL("../workers/decimate-mesh.worker.ts", import.meta.url),
    { type: "module" },
  );
  return worker;
}

export async function decimateClientSide(
  input: File,
  targetTriangles = 200_000,
): Promise<DecimateClientResult> {
  const w = ensureWorker();
  const id = nextId++;
  const buf = await input.arrayBuffer();
  const originalSize = input.size;

  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const msg = e.data as
        | { id: number; ok: true; result: { bytes: ArrayBuffer; triCountIn: number; triCountOut: number; vertCountOut: number } }
        | { id: number; ok: false; error: string };
      if (msg.id !== id) return;
      w.removeEventListener("message", handler);
      if (!msg.ok) {
        reject(new Error(msg.error));
        return;
      }
      const baseName = input.name.replace(/\.(stl|obj)$/i, "");
      const file = new File([msg.result.bytes], `${baseName}.decimated.stl`, {
        type: "model/stl",
      });
      resolve({
        file,
        triCountIn: msg.result.triCountIn,
        triCountOut: msg.result.triCountOut,
        vertCountOut: msg.result.vertCountOut,
        originalSizeBytes: originalSize,
        decimatedSizeBytes: file.size,
      });
    };
    w.addEventListener("message", handler);
    w.postMessage({ id, bytes: buf, filename: input.name, targetTriangles }, [buf]);
  });
}
