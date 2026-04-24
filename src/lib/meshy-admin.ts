/**
 * Meshy Admin data layer — record + manage meshy generations and save them
 * into the part library or body skin library.
 *
 * Generation lifecycle: queued → running → complete | failed. Once complete,
 * an admin can promote the result into either a library_item (kind=part) or
 * a body_skins row.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type MeshyGeneration = Database["public"]["Tables"]["meshy_generations"]["Row"];
export type MeshyGenerationType = Database["public"]["Enums"]["meshy_generation_type"];
export type MeshyGenerationStatus = Database["public"]["Enums"]["meshy_generation_status"];

export function useMeshyGenerations() {
  return useQuery({
    queryKey: ["meshy_generations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("meshy_generations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MeshyGeneration[];
    },
  });
}

/**
 * Record a manual / external generation entry. Lets admins log a Meshy run
 * they kicked off elsewhere, then promote the resulting URL into the library.
 */
export function useRecordMeshyGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      generation_type: MeshyGenerationType;
      prompt: string;
      reference_image_urls?: string[];
      output_glb_url?: string | null;
      output_stl_url?: string | null;
      preview_url?: string | null;
      donor_car_template_id?: string | null;
      status?: MeshyGenerationStatus;
    }) => {
      const insert = {
        user_id: input.userId,
        generation_type: input.generation_type,
        prompt: input.prompt,
        reference_image_urls: input.reference_image_urls ?? [],
        output_glb_url: input.output_glb_url ?? null,
        output_stl_url: input.output_stl_url ?? null,
        preview_url: input.preview_url ?? null,
        donor_car_template_id: input.donor_car_template_id ?? null,
        status: input.status ?? "complete",
      };
      const { data, error } = await (supabase as any)
        .from("meshy_generations")
        .insert(insert)
        .select("*")
        .single();
      if (error) throw error;
      return data as MeshyGeneration;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meshy_generations"] }),
  });
}

export function useDeleteMeshyGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("meshy_generations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meshy_generations"] }),
  });
}

/**
 * Promote a Meshy generation into a part library item.
 * Sets `saved_library_item_id` on the generation row for traceability.
 */
export function usePromoteToLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { generation: MeshyGeneration; title: string }) => {
      const g = input.generation;
      const asset_url = g.output_glb_url ?? g.output_stl_url;
      if (!asset_url) throw new Error("Generation has no GLB/STL output yet.");
      const asset_mime = g.output_glb_url ? "model/gltf-binary" : "model/stl";

      const { data: lib, error: libErr } = await (supabase as any)
        .from("library_items")
        .insert({
          user_id: g.user_id,
          kind: g.generation_type === "body_skin" ? "aero_kit_mesh" : "concept_part_mesh",
          title: input.title,
          asset_url,
          asset_mime,
          thumbnail_url: g.preview_url,
          metadata: {
            source: "meshy_admin",
            meshy_generation_id: g.id,
            prompt: g.prompt,
          },
        })
        .select("*")
        .single();
      if (libErr) throw libErr;

      await (supabase as any)
        .from("meshy_generations")
        .update({ saved_library_item_id: lib.id })
        .eq("id", g.id);

      return lib;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meshy_generations"] });
      qc.invalidateQueries({ queryKey: ["library_items"] });
    },
  });
}

/**
 * Promote a Meshy generation into a body_skins entry. Stores the URL directly
 * (no re-upload) since the asset is already hosted.
 */
export function usePromoteToBodySkin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { generation: MeshyGeneration; name: string }) => {
      const g = input.generation;
      if (!g.output_glb_url && !g.output_stl_url) {
        throw new Error("Generation has no GLB/STL output yet.");
      }
      const { data: skin, error } = await (supabase as any)
        .from("body_skins")
        .insert({
          user_id: g.user_id,
          name: input.name,
          file_url_glb: g.output_glb_url,
          file_url_stl: g.output_stl_url,
          preview_url: g.preview_url,
          donor_car_template_id: g.donor_car_template_id,
          generation_prompt: g.prompt,
        })
        .select("*")
        .single();
      if (error) throw error;

      await (supabase as any)
        .from("meshy_generations")
        .update({ saved_body_skin_id: skin.id })
        .eq("id", g.id);

      return skin;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meshy_generations"] });
      qc.invalidateQueries({ queryKey: ["body_skins"] });
    },
  });
}
