/**
 * React Query hooks for the new Prototyper workflow: prototypes scoped to
 * those with frozen parts (so the new page hides legacy rows), plus
 * frozen_parts CRUD.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  MountZone,
  PartCategory,
  PartSide,
  ViewAngle,
} from "./mount-zones";

export interface FrozenPart {
  id: string;
  user_id: string;
  prototype_id: string;
  garage_car_id: string | null;
  name: string;
  category: PartCategory | string;
  mount_zone: MountZone | string;
  side: PartSide | string;
  symmetry_allowed: boolean;
  silhouette_locked: boolean;
  source_image_url: string | null;
  mask_url: string | null;
  silhouette_url: string | null;
  preview_url: string | null;
  bbox: { x: number; y: number; w: number; h: number } | Record<string, never>;
  anchor_points: Record<string, { x: number; y: number }> | Record<string, never>;
  view_angle: ViewAngle | string;
  created_at: string;
  updated_at: string;
}

export function useFrozenParts(prototypeId: string | undefined) {
  return useQuery({
    queryKey: ["frozen_parts", prototypeId],
    enabled: !!prototypeId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("frozen_parts")
        .select("*")
        .eq("prototype_id", prototypeId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FrozenPart[];
    },
  });
}

/** Prototypes that already have at least one frozen part — used by the new
 * Prototyper landing list to hide legacy rows. */
export function useFrozenPrototypeIds(userId: string | undefined) {
  return useQuery({
    queryKey: ["frozen_parts_prototype_ids", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("frozen_parts")
        .select("prototype_id")
        .eq("user_id", userId!);
      if (error) throw error;
      const ids = new Set<string>();
      (data ?? []).forEach((r: { prototype_id: string }) => ids.add(r.prototype_id));
      return ids;
    },
  });
}

export function useCreateFrozenPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<FrozenPart> & {
      user_id: string;
      prototype_id: string;
    }) => {
      const { data, error } = await (supabase as any)
        .from("frozen_parts")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as FrozenPart;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["frozen_parts", row.prototype_id] });
      qc.invalidateQueries({ queryKey: ["frozen_parts_prototype_ids"] });
    },
  });
}

export function useUpdateFrozenPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<FrozenPart> }) => {
      const { data, error } = await (supabase as any)
        .from("frozen_parts")
        .update(input.patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as FrozenPart;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["frozen_parts", row.prototype_id] });
    },
  });
}

export function useDeleteFrozenPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("frozen_parts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["frozen_parts"] });
      qc.invalidateQueries({ queryKey: ["frozen_parts_prototype_ids"] });
    },
  });
}
