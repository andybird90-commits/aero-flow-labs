/**
 * useAutofitPlacedPart — calls the `bake-bodykit-from-shell` edge function
 * (a.k.a. Autofit) for a single placed part.
 *
 * Unlike previous versions, this no longer sends URL pointers to the original
 * library asset. Instead it:
 *
 *   1. Loads the donor car GLB and the part's library GLB into THREE.
 *   2. Applies the placed part's current position / rotation / scale
 *      (including mirror flag) into the part scene so the exported GLB
 *      contains the part exactly where the user dragged it in the viewport.
 *   3. Exports both as binary GLB blobs.
 *   4. Uploads them as multipart/form-data (fields `car` and `part`) to the
 *      edge function, which forwards them — also as multipart — to the mesh
 *      worker's `/autofit` endpoint.
 *
 * The fitted GLB returned by the worker is then persisted onto
 * `placed_parts.metadata.autofit_glb_url` by the edge function. The viewport
 * keeps the placed part's existing transform and swaps only the rendered GLB.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";

export type AutofitPartKind =
  | "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser";

export interface AutofitPlacedPartInput {
  placed_part_id: string;
  part_kind: AutofitPartKind;
  /** project_id is only used to invalidate the placed_parts query cache. */
  project_id: string;
  /** Donor car mesh URL (GLB or STL — must be GLB for autofit). */
  car_url: string;
  /** Library part GLB URL. */
  part_url: string;
  /** Current placed part — its transform is baked into the exported part GLB. */
  part: PlacedPart;
}

export interface AutofitPlacedPartResult {
  ok: boolean;
  placed_part_id: string;
  result_url: string;
  part_kind?: string;
  processing_ms: number | null;
}

function loadGlb(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(new Error(`Failed to load GLB ${url}: ${(err as any)?.message ?? String(err)}`)),
    );
  });
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
          // Shouldn't happen with binary:true, but be safe.
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) => reject(new Error(`GLTFExporter failed: ${(err as any)?.message ?? String(err)}`)),
      { binary: true, embedImages: true, onlyVisible: true } as Record<string, unknown>,
    );
  });
}

/**
 * Build the part GLB with its current placed transform baked in. The wrapping
 * group is positioned/rotated/scaled to match the viewport, so the resulting
 * GLB is in the same world frame as the car GLB.
 */
/**
 * Bake a transform into mesh geometry vertices.
 *
 * Walks the loaded scene, clones each mesh + its geometry, applies the
 * computed world matrix to the cloned geometry, then resets the clone's
 * local TRS to identity. The returned root contains meshes whose vertices
 * are already in world space — GLTFExporter will write those exact
 * coordinates regardless of any parent transform.
 */
function bakeWorldTransformIntoGeometry(
  source: THREE.Object3D,
  worldMatrix: THREE.Matrix4,
): THREE.Object3D {
  const root = new THREE.Group();

  // Make sure children's matrixWorld is current relative to `source`.
  source.updateMatrixWorld(true);

  source.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;

    const cloned = mesh.clone();
    cloned.geometry = mesh.geometry.clone();

    // Combined matrix = outer placed transform * mesh's own world matrix
    // inside the loaded scene (handles nested mesh hierarchies in the GLB).
    const combined = new THREE.Matrix4()
      .multiplyMatrices(worldMatrix, mesh.matrixWorld);
    cloned.geometry.applyMatrix4(combined);

    cloned.position.set(0, 0, 0);
    cloned.rotation.set(0, 0, 0);
    cloned.scale.set(1, 1, 1);
    cloned.updateMatrix();
    cloned.updateMatrixWorld(true);

    root.add(cloned);
  });

  return root;
}

/**
 * Read the first N vertex positions from the first mesh under `root`.
 * Geometry is already baked, so these are the exact coords GLTFExporter writes.
 */
function firstVertices(root: THREE.Object3D, n = 3): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  let found: THREE.Mesh | null = null;
  root.traverse((c) => {
    if (found) return;
    const m = c as THREE.Mesh;
    if ((m as any).isMesh && m.geometry?.attributes?.position) found = m;
  });
  if (!found) return out;
  const pos = (found as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute;
  const count = Math.min(n, pos.count);
  for (let i = 0; i < count; i++) {
    out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
  }
  return out;
}

async function buildPositionedPartBlob(partUrl: string, part: PlacedPart): Promise<Blob> {
  const partRoot = await loadGlb(partUrl);

  // Build the placed-part world matrix from its TRS (mirrored = flip Z).
  const placedMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(part.position.x, part.position.y, part.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(part.rotation.x, part.rotation.y, part.rotation.z),
    ),
    new THREE.Vector3(
      part.scale.x,
      part.scale.y,
      part.mirrored ? -part.scale.z : part.scale.z,
    ),
  );

  const baked = bakeWorldTransformIntoGeometry(partRoot, placedMatrix);

  // Diagnostic: bbox of the baked root. Vertices are now in world space, so
  // bounds should match where the part visually sits in the viewport.
  const bbox = new THREE.Box3().setFromObject(baked);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);
  // eslint-disable-next-line no-console
  console.log("[autofit] exporting part GLB — baked world bbox", {
    placed_part_id: part.id,
    transform: {
      position: part.position,
      rotation: part.rotation,
      scale: part.scale,
      mirrored: part.mirrored,
    },
    bbox: {
      min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
      max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
    },
  });

  return exportGlb(baked);
}

async function buildCarBlob(carUrl: string): Promise<Blob> {
  const carRoot = await loadGlb(carUrl);
  // Car GLB is already authored in world frame, but bake identity anyway so
  // any nested transforms inside the GLB are flattened into the vertices —
  // this guarantees the worker sees identical coordinates to the viewport.
  const baked = bakeWorldTransformIntoGeometry(carRoot, new THREE.Matrix4());

  const bbox = new THREE.Box3().setFromObject(baked);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  // eslint-disable-next-line no-console
  console.log("[autofit] exporting car GLB — baked world bbox", {
    bbox: {
      min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
      max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
      size: { x: size.x, y: size.y, z: size.z },
    },
  });

  return exportGlb(baked);
}

export function useAutofitPlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AutofitPlacedPartInput): Promise<AutofitPlacedPartResult> => {
      // 1. Build car + part GLB blobs client-side.
      const [carBlob, partBlob] = await Promise.all([
        buildCarBlob(input.car_url),
        buildPositionedPartBlob(input.part_url, input.part),
      ]);

      // 2. Send to edge function as multipart/form-data.
      const form = new FormData();
      form.append("placed_part_id", input.placed_part_id);
      form.append("part_kind", input.part_kind);
      form.append("car", new File([carBlob], "car.glb", { type: "model/gltf-binary" }));
      form.append("part", new File([partBlob], "part.glb", { type: "model/gltf-binary" }));

      const { data, error } = await supabase.functions.invoke(
        "bake-bodykit-from-shell",
        { body: form },
      );
      if (error) {
        throw new Error(
          (data as any)?.error ?? error.message ?? "Autofit worker failed",
        );
      }
      return data as AutofitPlacedPartResult;
    },
    onSuccess: async (data, vars) => {
      const queryKey = ["placed_parts", vars.project_id];

      // Make the viewport receive the new metadata immediately instead of
      // waiting for an async invalidation cycle. PartMesh reads this prop to
      // choose metadata.autofit_glb_url over the original library asset_url.
      qc.setQueryData<PlacedPart[]>(queryKey, (current) => {
        if (!current) return current;
        return current.map((part) => {
          if (part.id !== vars.placed_part_id) return part;
          return {
            ...part,
            metadata: {
              ...(part.metadata ?? {}),
              autofit_glb_url: data.result_url,
              autofit_part_kind: data.part_kind ?? vars.part_kind,
              autofit_processing_ms: data.processing_ms ?? null,
              autofit_at: new Date().toISOString(),
              autofit_frame: "part-local",
            },
          };
        });
      });

      // Then force the active query to reconcile with the DB row written by
      // the edge function, and keep mutateAsync pending until that completes.
      await qc.invalidateQueries({ queryKey });
      await qc.refetchQueries({ queryKey, type: "active" });
    },
  });
}
