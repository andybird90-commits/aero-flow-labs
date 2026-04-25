/**
 * GLB export — bundles the live three.js scene (car + body skin + placed
 * parts + materials) into a single .glb the user can open in Blender,
 * Unreal, marketplace viewers, or Android Scene Viewer.
 *
 * Uses three's built-in GLTFExporter; binary output keeps file size sensible
 * even for high-poly bodies. We dump the actual rendered scene so paint
 * finishes + curated material tags are baked into the export.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { downloadBlob } from "./capture";

export async function exportSceneToGLB(scene: THREE.Object3D, filename = "showroom.glb") {
  const exporter = new GLTFExporter();
  return new Promise<void>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: "model/gltf-binary" });
          downloadBlob(blob, filename);
          resolve();
        } else {
          // JSON fallback (shouldn't happen with binary:true, but be safe).
          const blob = new Blob([JSON.stringify(result)], { type: "model/gltf+json" });
          downloadBlob(blob, filename.replace(/\.glb$/, ".gltf"));
          resolve();
        }
      },
      (err) => reject(err),
      {
        binary: true,
        embedImages: true,
        onlyVisible: true,
        // Skip lights/cameras/helpers — keep payload to mesh + materials.
        includeCustomExtensions: false,
      } as Record<string, unknown>,
    );
  });
}

/**
 * Returns a Blob of the GLB rather than triggering a download — used for
 * uploading to storage so we can wire it to Android Scene Viewer.
 */
export async function exportSceneToGLBBlob(scene: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: "model/gltf-binary" }));
        } else {
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) => reject(err),
      { binary: true, embedImages: true, onlyVisible: true } as Record<string, unknown>,
    );
  });
}
