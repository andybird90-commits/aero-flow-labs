/**
 * Proportional mesh deformation engine.
 *
 * Places handles on a mesh. When a handle moves, nearby vertices
 * follow with a smooth gaussian falloff. Multiple handles can be
 * active simultaneously. Works on cloned geometry — never mutates
 * the original mesh.
 */
import * as THREE from "three";

export interface DeformHandle {
  id: string;
  /** World-space position of the handle */
  position: THREE.Vector3;
  /** Influence radius in metres */
  radius: number;
  /** The offset this handle has applied */
  offset: THREE.Vector3;
}

export interface SerializedHandle {
  id: string;
  position: [number, number, number];
  radius: number;
  offset: [number, number, number];
}

/** Gaussian falloff — 1 at centre, 0 at radius */
function falloff(dist: number, radius: number): number {
  if (dist >= radius) return 0;
  const t = dist / radius;
  return Math.exp(-4 * t * t);
}

/**
 * Apply all handles to the original geometry and return a new
 * deformed BufferGeometry. The original is never mutated.
 */
export function applyHandles(
  originalGeom: THREE.BufferGeometry,
  handles: DeformHandle[],
  meshWorldMatrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const geom = originalGeom.clone();
  const posAttr = geom.attributes.position as THREE.BufferAttribute;
  const worldInv = meshWorldMatrix.clone().invert();

  for (let i = 0; i < posAttr.count; i++) {
    const vLocal = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    const vWorld = vLocal.clone().applyMatrix4(meshWorldMatrix);

    const totalOffset = new THREE.Vector3();
    for (const handle of handles) {
      const dist = vWorld.distanceTo(handle.position);
      const weight = falloff(dist, handle.radius);
      if (weight > 0.001) {
        totalOffset.addScaledVector(handle.offset, weight);
      }
    }

    if (totalOffset.lengthSq() > 0) {
      const newWorld = vWorld.clone().add(totalOffset);
      const newLocal = newWorld.applyMatrix4(worldInv);
      posAttr.setXYZ(i, newLocal.x, newLocal.y, newLocal.z);
    }
  }

  posAttr.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return geom;
}

export function serializeHandles(handles: DeformHandle[]): SerializedHandle[] {
  return handles.map(h => ({
    id: h.id,
    position: [h.position.x, h.position.y, h.position.z],
    radius: h.radius,
    offset: [h.offset.x, h.offset.y, h.offset.z],
  }));
}

export function deserializeHandles(data: SerializedHandle[]): DeformHandle[] {
  return data.map(h => ({
    id: h.id,
    position: new THREE.Vector3(...h.position),
    radius: h.radius,
    offset: new THREE.Vector3(...h.offset),
  }));
}
