/**
 * useBodySwap — client-side CSG body swap.
 *
 * The user has a donor car in the scene and a full body shell loaded as the
 * active Shell Fit overlay. Body Swap trims the bottom of the shell where it
 * overlaps the donor car's body so the shell sits flush on the donor — the
 * donor car remains in the scene underneath, the shell becomes the new
 * outer skin.
 *
 * Pipeline (entirely browser-side, no edge function):
 *   1. Read the live donor car + shell Object3D from the scene registry so
 *      any drag/alignment edits the user has made are honoured.
 *   2. Bake both into world-space BufferGeometries.
 *   3. Center the shell over the donor and scale it ×1.02 so it cleanly
 *      brackets the donor everywhere — guarantees the SUBTRACTION can find
 *      a continuous cut surface even when the shell touches the donor body.
 *   4. Run `Evaluator.evaluate(shellBrush, donorBrush, SUBTRACTION)`.
 *   5. Keep only the largest connected component (drops floating splinters
 *      left by the boolean — the same cleanup step used by autofit).
 *   6. Export the trimmed shell as a binary GLB.
 *   7. Upload to the `body-skins` bucket and insert a new `body_skins` row
 *      so the new swapped body shows up in the Shell Fit dropdown for reuse.
 *
 * The donor car is *never* modified — only the shell geometry is cut.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { supabase } from "@/integrations/supabase/client";
import {
  getCarObject,
  getShellObject,
} from "@/lib/build-studio/scene-registry";
import type { BodySkin } from "@/lib/body-skins";

export interface BodySwapInput {
  /** Source skin we're starting from — used to name the new swap and link metadata. */
  sourceSkin: BodySkin;
  /** Donor car template id (for naming the new swap). */
  donorCarTemplateId?: string | null;
  /** Donor car display name (for naming the new swap). */
  donorCarLabel?: string | null;
  /** Owning user id — required to write to storage + body_skins. */
  userId: string;
  /** Shell pre-clearance multiplier. Default 1.02. */
  preClearance?: number;
}

export interface BodySwapResult {
  ok: true;
  new_body_skin: BodySkin;
  processing_ms: number;
  triangles_in: number;
  triangles_out: number;
}

/* ─── geometry baking + cleanup helpers (mirrors autofit.ts) ─── */

function bakeLiveWorldGeometry(liveRoot: THREE.Object3D): THREE.BufferGeometry {
  liveRoot.updateWorldMatrix(true, true);

  const geometries: THREE.BufferGeometry[] = [];
  liveRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    const g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    let baked = g;
    if (g.index) {
      baked = g.toNonIndexed();
      g.dispose();
    }
    baked.applyMatrix4(mesh.matrixWorld);
    if (!baked.attributes.normal) baked.computeVertexNormals();
    geometries.push(baked);
  });

  if (geometries.length === 0) {
    throw new Error("No meshes found under live root");
  }

  let totalVerts = 0;
  for (const g of geometries) totalVerts += g.attributes.position.count;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of geometries) {
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal.array as ArrayLike<number>;
    positions.set(p as any, offset * 3);
    normals.set(n as any, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Centre `geom` over `targetCenter` (in-place) and scale uniformly about that
 * centre. Used to bracket the donor before the SUBTRACTION cut so the shell
 * is guaranteed to clear the donor body everywhere.
 */
function centerAndScaleAround(
  geom: THREE.BufferGeometry,
  targetCenter: THREE.Vector3,
  scale: number,
) {
  geom.computeBoundingBox();
  const shellCenter = new THREE.Vector3();
  geom.boundingBox!.getCenter(shellCenter);

  const m = new THREE.Matrix4()
    .makeTranslation(targetCenter.x, targetCenter.y, targetCenter.z)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(
      new THREE.Matrix4().makeTranslation(-shellCenter.x, -shellCenter.y, -shellCenter.z),
    );
  geom.applyMatrix4(m);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
}

/** Keep only the single largest connected component by triangle count. */
function keepLargestComponent(inputGeom: THREE.BufferGeometry): THREE.BufferGeometry {
  const welded = mergeVertices(inputGeom, 1e-5);
  if (!welded.index) return inputGeom;
  const indexArr = welded.index.array as ArrayLike<number>;
  const triCount = indexArr.length / 3;
  const vertCount = welded.attributes.position.count;

  const vertToTris: number[][] = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) vertToTris[i] = [];
  for (let t = 0; t < triCount; t++) {
    vertToTris[indexArr[t * 3] as number].push(t);
    vertToTris[indexArr[t * 3 + 1] as number].push(t);
    vertToTris[indexArr[t * 3 + 2] as number].push(t);
  }

  const compOf = new Int32Array(triCount).fill(-1);
  const components: number[][] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (compOf[seed] !== -1) continue;
    const compId = components.length;
    const tris: number[] = [];
    stack.length = 0;
    stack.push(seed);
    compOf[seed] = compId;
    while (stack.length > 0) {
      const t = stack.pop() as number;
      tris.push(t);
      const a = indexArr[t * 3] as number;
      const b = indexArr[t * 3 + 1] as number;
      const c = indexArr[t * 3 + 2] as number;
      const neigh = [vertToTris[a], vertToTris[b], vertToTris[c]];
      for (const list of neigh) {
        for (let i = 0; i < list.length; i++) {
          const nt = list[i];
          if (compOf[nt] === -1) {
            compOf[nt] = compId;
            stack.push(nt);
          }
        }
      }
    }
    components.push(tris);
  }

  components.sort((a, b) => b.length - a.length);
  const largestTris = components[0];
  if (!largestTris) return inputGeom;
  // eslint-disable-next-line no-console
  console.log("[body-swap] component cleanup", {
    components: components.length,
    largestTris: largestTris.length,
    droppedTris: triCount - largestTris.length,
  });

  const posAttr = welded.attributes.position;
  const normAttr = welded.attributes.normal;
  const positions = new Float32Array(largestTris.length * 9);
  const normals = normAttr ? new Float32Array(largestTris.length * 9) : null;
  let w = 0;
  for (const t of largestTris) {
    for (let k = 0; k < 3; k++) {
      const vi = indexArr[t * 3 + k] as number;
      positions[w] = posAttr.getX(vi);
      positions[w + 1] = posAttr.getY(vi);
      positions[w + 2] = posAttr.getZ(vi);
      if (normals && normAttr) {
        normals[w] = normAttr.getX(vi);
        normals[w + 1] = normAttr.getY(vi);
        normals[w + 2] = normAttr.getZ(vi);
      }
      w += 3;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (normals) out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  welded.dispose();
  return out;
}

function exportGlb(root: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: "model/gltf-binary" }));
        } else {
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) =>
        reject(
          new Error(`GLTFExporter failed: ${(err as any)?.message ?? String(err)}`),
        ),
      { binary: true, embedImages: false, onlyVisible: true } as Record<string, unknown>,
    );
  });
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

/* ─── public hook ─── */

export function useBodySwap() {
  const qc = useQueryClient();

  return useMutation<BodySwapResult, Error, BodySwapInput>({
    mutationFn: async (input) => {
      const start = performance.now();
      const preClearance = input.preClearance ?? 1.02;

      const shellMesh = getShellObject();
      const carMesh = getCarObject();
      if (!shellMesh) {
        throw new Error(
          "Body Swap: load a body shell via Shell Fit before running the swap.",
        );
      }
      if (!carMesh) {
        throw new Error("Body Swap: no donor car mesh registered in the scene.");
      }

      // Step 1 — bake both meshes to world space.
      const shellGeom = bakeLiveWorldGeometry(shellMesh);
      const donorGeom = bakeLiveWorldGeometry(carMesh);

      // Step 2 — centre shell over donor, scale ×preClearance about that centre
      // so the shell brackets the donor everywhere before the cut.
      const donorBox = new THREE.Box3().setFromBufferAttribute(
        donorGeom.attributes.position as THREE.BufferAttribute,
      );
      const donorCenter = donorBox.getCenter(new THREE.Vector3());
      centerAndScaleAround(shellGeom, donorCenter, preClearance);

      const trianglesIn =
        shellGeom.attributes.position.count / 3 + donorGeom.attributes.position.count / 3;

      // Step 3 — boolean SUBTRACTION (shell − donor).
      const shellBrush = new Brush(shellGeom);
      shellBrush.updateMatrixWorld();
      const donorBrush = new Brush(donorGeom);
      donorBrush.updateMatrixWorld();

      const evaluator = getEvaluator();
      const result = evaluator.evaluate(shellBrush, donorBrush, SUBTRACTION) as Brush;

      // Step 4 — strip floating fragments and weld for smooth shading.
      const rawGeom = result.geometry.clone();
      const cleaned = keepLargestComponent(rawGeom);
      rawGeom.dispose();
      const welded = mergeVertices(cleaned, 1e-4);
      if (welded !== cleaned) cleaned.dispose();
      welded.computeVertexNormals();
      welded.computeBoundingBox();
      welded.computeBoundingSphere();

      const trianglesOut = welded.attributes.position.count / 3;

      // Step 5 — wrap in a fresh scene + export GLB.
      const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(welded, mat);
      const scene = new THREE.Scene();
      scene.add(mesh);
      const blob = await exportGlb(scene);

      // Free the CSG-side allocations.
      shellGeom.dispose();
      donorGeom.dispose();

      // Step 6 — upload to the body-skins bucket.
      const ts = Date.now();
      const path = `${input.userId}/swap/${input.sourceSkin.id}-${ts}.glb`;
      const { error: upErr } = await supabase.storage
        .from("body-skins")
        .upload(path, blob, { contentType: "model/gltf-binary", upsert: false });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // Step 7 — register a new body_skins row pointing at the trimmed shell so
      // it shows up in the Shell Fit picker for re-use.
      const baseName = input.sourceSkin.name ?? "Body shell";
      const donorLabel = input.donorCarLabel ? ` on ${input.donorCarLabel}` : "";
      const insert = {
        user_id: input.userId,
        name: `${baseName} (swapped${donorLabel})`,
        notes: `Body Swap of "${baseName}" trimmed to donor car body. Pre-clearance ${preClearance}.`,
        donor_car_template_id: input.donorCarTemplateId ?? null,
        style_tags: [...((input.sourceSkin as any).style_tags ?? []), "body-swap"],
        preview_url: input.sourceSkin.preview_url ?? null,
        file_url_glb: path,
      };
      const { data: row, error: insErr } = await (supabase as any)
        .from("body_skins")
        .insert(insert)
        .select("*")
        .single();
      if (insErr) throw new Error(`Save failed: ${insErr.message}`);

      const processing_ms = Math.round(performance.now() - start);
      // eslint-disable-next-line no-console
      console.log("[body-swap] done", {
        processing_ms,
        trianglesIn,
        trianglesOut,
        path,
      });

      return {
        ok: true,
        new_body_skin: row as BodySkin,
        processing_ms,
        triangles_in: trianglesIn,
        triangles_out: trianglesOut,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["body_skins"] });
    },
  });
}
