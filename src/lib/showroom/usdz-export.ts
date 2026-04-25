/**
 * USDZ export — bundles the live three.js scene into a .usdz file the iOS
 * AR Quick Look viewer understands. No server round-trip; everything runs
 * in the browser.
 *
 * Triggered from the Showroom; we hand over the actual r3f scene root so
 * cars + body skin + placed parts are all included with their materials.
 */
import * as THREE from "three";
import { USDZExporter } from "three/examples/jsm/exporters/USDZExporter.js";

export async function exportSceneToUSDZ(scene: THREE.Object3D, filename = "showroom.usdz") {
  const exporter = new USDZExporter();
  const arraybuffer = (await exporter.parse(scene)) as Uint8Array;
  const blob = new Blob([arraybuffer.buffer as ArrayBuffer], { type: "model/vnd.usdz+zip" });
  const url = URL.createObjectURL(blob);

  // Detect iOS Safari → use the native AR Quick Look anchor link.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iP(hone|ad|od)/.test(ua);

  if (isIOS) {
    const a = document.createElement("a");
    a.setAttribute("rel", "ar");
    a.href = url;
    // Quick Look requires an <img> child to receive the launch tap.
    const img = document.createElement("img");
    img.style.display = "none";
    a.appendChild(img);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 5000);
    return;
  }

  // Non-iOS → just download the file so the user can AirDrop / open in Quick Look later.
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

export function isIOSDevice(): boolean {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iP(hone|ad|od)/.test(ua);
}
