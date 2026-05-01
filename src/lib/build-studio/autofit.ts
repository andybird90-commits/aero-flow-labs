/**
 * useAutofitPlacedPart — calls the `bake-bodykit-from-shell` edge function
 * (a.k.a. Autofit) for a single placed part. The worker deforms the part
 * GLB to fit the project's donor car and returns a new signed GLB URL,
 * which the edge function persists onto `placed_parts.metadata.autofit_glb_url`.
 *
 * The viewport reads that override (see PartMesh) so the fitted mesh
 * appears in place of the original library asset without mutating the
 * shared library_items row.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AutofitPartKind =
  | "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser";

export interface AutofitPlacedPartInput {
  placed_part_id: string;
  part_kind: AutofitPartKind;
  /** project_id is only used to invalidate the placed_parts query cache. */
  project_id: string;
}

export interface AutofitPlacedPartResult {
  ok: boolean;
  placed_part_id: string;
  result_url: string;
  processing_ms: number | null;
}

export function useAutofitPlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AutofitPlacedPartInput): Promise<AutofitPlacedPartResult> => {
      const { data, error } = await supabase.functions.invoke(
        "bake-bodykit-from-shell",
        {
          body: {
            placed_part_id: input.placed_part_id,
            part_kind: input.part_kind,
          },
        },
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
