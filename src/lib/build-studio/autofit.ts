import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";

export type AutofitPartKind =
  | "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser";

export interface AutofitPlacedPartInput {
  placed_part_id: string;
  part_kind: AutofitPartKind;
  project_id: string;
  car_url?: string;
  part_url?: string;
  part: PlacedPart;
}

export interface AutofitPlacedPartResult {
  ok: boolean;
  placed_part_id: string;
  result_url: string;
  part_kind?: string;
  processing_ms: number | null;
}

async function loadGlb(url: string): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
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
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) => reject(new Error(`GLTFExporter failed: ${(err as any)?.message ?? String(err)}`)),
      { binary: true, embedImages: false, onlyVisible: true } as Record<string, unknown>,
    );
  });
}

async function buildCarBlob(carUrl: string): Promise<Blob> {
  const carScene = await loadGlb(carUrl);
  return exportGlb(carScene);
}

async function buildPositionedPartBlob(
  partUrl: string,
  part: PlacedPart,
): Promise<Blob> {
  const partScene = await loadGlb(partUrl);
  const wrapper = new THREE.Group();
  wrapper.position.set(part.position.x, part.position.y, part.position.z);
  wrapper.rotation.set(part.rotation.x, part.rotation.y, part.rotation.z);
  wrapper.scale.set(part.scale.x, part.scale.y, part.scale.z);
  wrapper.add(partScene);
  wrapper.updateMatrixWorld(true);
  return exportGlb(wrapper);
}

export function useAutofitPlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AutofitPlacedPartInput): Promise<AutofitPlacedPartResult> => {
      if (!input.car_url) throw new Error("Autofit: car_url is required");
      if (!input.part_url) throw new Error("Autofit: part_url is required");

      const [carBlob, partBlob] = await Promise.all([
        buildCarBlob(input.car_url),
        buildPositionedPartBlob(input.part_url, input.part),
      ]);

      const form = new FormData();
      form.append("placed_part_id", input.placed_part_id);
      form.append("part_kind", input.part_kind);
      form.append("car", new File([carBlob], "car.glb", { type: "model/gltf-binary" }));
      form.append("part", new File([partBlob], "part.glb", { type: "model/gltf-binary" }));

      const { data, error } = await supabase.functions.invoke("bake-bodykit-from-shell", {
        body: form,
      });
      if (error) throw new Error(`Autofit failed: ${error.message}`);
      if (!data?.ok || !data?.result_url) {
        throw new Error(`Autofit returned no result_url: ${JSON.stringify(data)}`);
      }
      return {
        ok: true,
        placed_part_id: input.placed_part_id,
        result_url: data.result_url,
        part_kind: data.part_kind ?? input.part_kind,
        processing_ms: data.processing_ms ?? null,
      };
    },
    onSuccess: async (data, vars) => {
      const queryKey = ["placed_parts", vars.project_id];
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
              autofit_frame: "world",
              autofit_source: "server-mesh-api",
            },
          };
        });
      });
      await qc.invalidateQueries({ queryKey });
      await qc.refetchQueries({ queryKey, type: "active" });
    },
  });
}
