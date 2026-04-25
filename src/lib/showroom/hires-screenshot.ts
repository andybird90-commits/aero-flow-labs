/**
 * Hi-res screenshot — temporarily resizes the WebGL renderer so a single
 * frame is rendered at 2× / 4× the on-screen resolution, captures it, then
 * restores the original size.
 *
 * Why this works: r3f's renderer respects `setSize` + `setPixelRatio` on the
 * fly. We render one extra frame at the bumped resolution, pull it via
 * `canvas.toBlob`, then put everything back on the next frame. The user's
 * camera state and scene contents stay identical — only the framebuffer
 * grows for ~50 ms.
 */
import * as THREE from "three";
import { downloadBlob } from "./capture";

export type HiResScale = 1 | 2 | 4;

export interface HiResOptions {
  scale: HiResScale;
  filename?: string;
}

/**
 * Capture one frame at `scale × current size` and download it as PNG.
 * Caller passes the live renderer + scene + camera (we get them from r3f).
 */
export async function captureHiRes(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: HiResOptions,
): Promise<void> {
  const { scale, filename = `showroom-${scale}x.png` } = opts;

  // Snapshot original sizes so we can restore.
  const prevSize = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevPixelRatio = renderer.getPixelRatio();
  const prevAutoClear = renderer.autoClear;

  const targetW = Math.round(prevSize.x * scale);
  const targetH = Math.round(prevSize.y * scale);

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(targetW, targetH, false);
    renderer.autoClear = true;
    renderer.render(scene, camera);

    // Grab the canvas snapshot at the bumped size.
    const blob = await new Promise<Blob>((resolve, reject) => {
      renderer.domElement.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/png",
        1,
      );
    });
    downloadBlob(blob, filename);
  } finally {
    // Restore on-screen size + ratio + redraw.
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    renderer.autoClear = prevAutoClear;
    renderer.render(scene, camera);
  }
}
