/**
 * Live Three.js object registry for the Build Studio viewport.
 *
 * The viewport components register their mounted scene nodes here so that
 * non-R3F code (e.g. the autofit hook, body-swap action) can grab the *exact*
 * object currently in the scene — including any drag/transform changes the
 * user has applied but not yet committed back through query caches.
 *
 * This is intentionally module-scoped: there is only ever one viewport
 * mounted at a time in the studio.
 */
import type * as THREE from "three";

const placedPartObjects = new Map<string, THREE.Object3D>();
let carObject: THREE.Object3D | null = null;
let shellObject: THREE.Object3D | null = null;

export function registerPlacedPartObject(id: string, obj: THREE.Object3D | null) {
  if (obj) placedPartObjects.set(id, obj);
  else placedPartObjects.delete(id);
}

export function getPlacedPartObject(id: string): THREE.Object3D | null {
  return placedPartObjects.get(id) ?? null;
}

export function registerCarObject(obj: THREE.Object3D | null) {
  carObject = obj;
}

export function getCarObject(): THREE.Object3D | null {
  return carObject;
}

/** The currently-loaded body-shell overlay (Shell Fit Mode). */
export function registerShellObject(obj: THREE.Object3D | null) {
  shellObject = obj;
}

export function getShellObject(): THREE.Object3D | null {
  return shellObject;
}
