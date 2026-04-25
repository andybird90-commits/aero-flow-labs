/**
 * Showroom capture utilities — screenshot a single frame or record a
 * turntable WebM from the WebGL canvas.
 *
 * Why MediaRecorder + canvas.captureStream? Because re-rendering the scene
 * server-side (or via a headless renderer) would drop the user's exact
 * lighting / paint / placed parts. We just record what the user already sees,
 * which is faithful to the live preview at zero infra cost.
 */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function captureCanvasPng(
  canvas: HTMLCanvasElement,
  filename = "showroom.png",
): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas toBlob returned null"));
          return;
        }
        downloadBlob(blob, filename);
        resolve();
      },
      "image/png",
      1,
    );
  });
}

export interface TurntableOptions {
  /** Total rotation duration in seconds. */
  durationSec?: number;
  /** Frames per second target for MediaRecorder. */
  fps?: number;
  /** Called every frame with progress 0..1 so the UI can show a bar. */
  onProgress?: (t: number) => void;
  /** Called every frame with the current angle in radians (caller rotates camera). */
  onTick: (angleRad: number) => void;
  /** Filename for download. */
  filename?: string;
}

/**
 * Records a turntable video by:
 *  1) starting MediaRecorder on canvas.captureStream
 *  2) calling onTick each animation frame with the next angle
 *  3) stopping after `durationSec`
 */
export async function recordTurntable(
  canvas: HTMLCanvasElement,
  opts: TurntableOptions,
): Promise<void> {
  const {
    durationSec = 8,
    fps = 60,
    onProgress,
    onTick,
    filename = "showroom-turntable.webm",
  } = opts;

  if (!("captureStream" in canvas) || typeof MediaRecorder === "undefined") {
    throw new Error("Browser does not support canvas video capture");
  }

  // Pick the best available codec.
  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

  const stream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      downloadBlob(blob, filename);
      resolve();
    };
  });

  recorder.start(100);

  const start = performance.now();
  await new Promise<void>((resolve) => {
    let raf = 0;
    const loop = (now: number) => {
      const elapsed = (now - start) / 1000;
      const t = Math.min(1, elapsed / durationSec);
      onProgress?.(t);
      onTick(t * Math.PI * 2);
      if (t >= 1) {
        cancelAnimationFrame(raf);
        resolve();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  });

  recorder.stop();
  await done;
}
