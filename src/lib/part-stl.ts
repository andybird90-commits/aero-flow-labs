/**
 * Browser-side STL serialiser for a single fitted part.
 *
 * Uses the same parametric builders as the 3D viewer + the Exports page,
 * so what you see in the concept-pick flow is exactly what gets printed.
 */
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { buildPartMesh } from "@/lib/part-geometry";

export function partToStlString(kind: string, params: Record<string, number>): string {
  const mesh = buildPartMesh(kind, params);
  const scene = new THREE.Scene();
  scene.add(mesh);
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
