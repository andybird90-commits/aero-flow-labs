/**
 * Client-side GLB → binary STL conversion.
 *
 * Many of our part assets are stored as GLB (the format Meshy returns),
 * but CAD tools (Fusion 360, SolidWorks) expect actual STL when you give
 * them a .stl file. Renaming a GLB to .stl produces the "damaged file"
 * error users were seeing on import.
 *
 * Shared by ExtractedPartPreview and the Library page download buttons.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

/** Returns true if the buffer starts with the glTF magic bytes. */
export function isGlbBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  return new TextDecoder().decode(buf.slice(0, 4)) === "glTF";
}

/** Convert a GLB ArrayBuffer to a binary STL Blob. */
export async function glbBufferToStlBlob(buf: ArrayBuffer): Promise<Blob> {
  const gltf: any = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(buf, "", resolve, reject),
  );
  const scene = new THREE.Scene();
  scene.add(gltf.scene);
  scene.updateMatrixWorld(true);
  const stlData = new STLExporter().parse(scene, { binary: true }) as DataView;
  const stlBytes = new Uint8Array(
    stlData.buffer as ArrayBuffer,
    stlData.byteOffset,
    stlData.byteLength,
  );
  return new Blob([stlBytes], { type: "model/stl" });
}

/**
 * Fetch a remote asset and return a download-ready { blob, ext } pair.
 * If the asset is a GLB, it's transparently converted to STL.
 */
export async function fetchAsDownloadableMesh(
  url: string,
  declaredMime?: string | null,
): Promise<{ blob: Blob; ext: string }> {
  const r = await fetch(url);
  const buf = await r.arrayBuffer();

  // Plain images / unknown blobs — pass through.
  if (declaredMime?.startsWith("image/")) {
    const ext = declaredMime === "image/png" ? "png" : declaredMime === "image/jpeg" ? "jpg" : "bin";
    return { blob: new Blob([buf], { type: declaredMime }), ext };
  }

  if (isGlbBuffer(buf)) {
    const stl = await glbBufferToStlBlob(buf);
    return { blob: stl, ext: "stl" };
  }

  // Already STL (or something else mesh-like) — keep as-is.
  const mime = declaredMime || "model/stl";
  return { blob: new Blob([buf], { type: mime }), ext: "stl" };
}
