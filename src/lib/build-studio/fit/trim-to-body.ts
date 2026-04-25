/**
 * Trim a part where it overlaps the car body using BVH-accelerated CSG.
 *
 * Returns a NEW BufferGeometry with the overlapping volume subtracted.
 * Typical cost on desktop: ~80–250ms for a ~5k-tri part vs ~80k-tri body.
 *
 * IMPORTANT: meshes must be in the same world frame. Both must be indexed
 * triangle meshes. We copy the inputs into bare Mesh objects and run the
 * Evaluator's SUBTRACTION op.
 */
import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";

export interface TrimInputs {
  /** Part geometry to trim. */
  partGeometry: THREE.BufferGeometry;
  /** Base body geometry (BVH built internally by the Brush wrapper). */
  baseGeometry: THREE.BufferGeometry;
}

let cachedEvaluator: Evaluator | null = null;
function getEvaluator(): Evaluator {
  if (cachedEvaluator) return cachedEvaluator;
  const ev = new Evaluator();
  ev.attributes = ["position", "normal"];
  ev.useGroups = false;
  cachedEvaluator = ev;
  return ev;
}

/**
 * Subtract the body shape from the part. The returned geometry contains only
 * the part volume that does NOT overlap the body — i.e. the visible surface
 * once it's trimmed against the car.
 *
 * Throws if either input has no vertices.
 */
export function trimToBody({ partGeometry, baseGeometry }: TrimInputs): THREE.BufferGeometry {
  if (!partGeometry.attributes.position || partGeometry.attributes.position.count === 0) {
    throw new Error("Part geometry has no vertices");
  }
  if (!baseGeometry.attributes.position || baseGeometry.attributes.position.count === 0) {
    throw new Error("Base geometry has no vertices");
  }

  const partBrush = new Brush(partGeometry.clone());
  partBrush.updateMatrixWorld();

  const bodyBrush = new Brush(baseGeometry.clone());
  bodyBrush.updateMatrixWorld();

  const ev = getEvaluator();
  const result = ev.evaluate(partBrush, bodyBrush, SUBTRACTION) as Brush;

  const out = result.geometry.clone();
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
