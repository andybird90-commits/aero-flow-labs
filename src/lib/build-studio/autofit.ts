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
 * `placed_parts.metadata.autofit_glb_url` by the edge function. Because the
 * part was sent already positioned in car-world coordinates, the worker's
 * result is also in car-world coordinates and the viewport renders it with
 * an identity transform.
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
async function buildPositionedPartBlob(partUrl: string, part: PlacedPart): Promise<Blob> {
  const partRoot = await loadGlb(partUrl);
  const wrapper = new THREE.Group();
  wrapper.add(partRoot);
  wrapper.position.set(part.position.x, part.position.y, part.position.z);
  wrapper.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
  wrapper.scale.set(
    part.scale.x,
    part.scale.y,
    // Mirror flag flips Z — matches viewport convention.
    part.mirrored ? -part.scale.z : part.scale.z,
  );
  wrapper.updateMatrixWorld(true);
  return exportGlb(wrapper);
}

async function buildCarBlob(carUrl: string): Promise<Blob> {
  // Car GLB is already in world frame — re-export as-is so the worker gets
  // the exact same bytes the viewport is rendering.
  const carRoot = await loadGlb(carUrl);
  return exportGlb(carRoot);
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
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["placed_parts", vars.project_id] });
    },
  });
}
