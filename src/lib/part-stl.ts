/**
 * Browser-side STL serialiser for a single fitted part.
 *
 * Uses the same parametric builders as the 3D viewer + the Exports page,
 * so what you see in the concept-pick flow is exactly what gets printed.
 *
 * SCALE NOTE: `buildPartMesh` works in metres (matches three.js viewer
 * conventions). STL files for 3D printing are conventionally in mm, so we
 * scale the exported scene by 1000× before serialising. This makes a 80mm
 * splitter actually open as 80mm in Bambu / Prusa / online STL viewers
 * instead of 0.08mm (which renders as a yellow speck inside its bounding box).
 */
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { buildPartMesh } from "@/lib/part-geometry";

export function partToStlString(kind: string, params: Record<string, number>): string {
  const mesh = buildPartMesh(kind, params);
  // Scale metres → millimetres for slicer-friendly STL units.
  mesh.scale.setScalar(1000);
  const scene = new THREE.Scene();
  scene.add(mesh);
  // Bake transform into world matrix so exported vertices are in mm.
  scene.updateMatrixWorld(true);
  return new STLExporter().parse(scene, { binary: false }) as string;
}

export function downloadStl(filename: string, stl: string) {
  const blob = new Blob([stl], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
