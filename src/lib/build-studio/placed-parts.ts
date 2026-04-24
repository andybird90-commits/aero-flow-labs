/**
 * Build Studio data layer — placed_parts CRUD via React Query.
 *
 * A "placed part" is a library item dropped into the 3D scene for a project,
 * with its own transform (position / rotation / scale) and presentation flags
 * (locked, hidden, mirrored, snap zone).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Vec3 { x: number; y: number; z: number }

export interface PlacedPart {
  id: string;
  user_id: string;
  project_id: string;
  library_item_id: string | null;
  part_name: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  snap_zone_id: string | null;
  mirrored: boolean;
  locked: boolean;
  hidden: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const ONE: Vec3 = { x: 1, y: 1, z: 1 };

export function usePlacedParts(projectId: string | undefined) {
  return useQuery({
    queryKey: ["placed_parts", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("placed_parts")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlacedPart[];
    },
  });
}

export function useAddPlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      project_id: string;
      library_item_id: string | null;
      part_name: string;
      position?: Vec3;
      metadata?: Record<string, any>;
    }) => {
      const payload = {
        user_id: input.user_id,
        project_id: input.project_id,
        library_item_id: input.library_item_id,
        part_name: input.part_name,
        position: input.position ?? { x: 0, y: 0.5, z: 0 },
        rotation: ZERO,
        scale: ONE,
        metadata: input.metadata ?? {},
      };
      const { data, error } = await (supabase as any)
        .from("placed_parts")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return data as PlacedPart;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["placed_parts", vars.project_id] });
    },
  });
}

export function useUpdatePlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      project_id: string;
      patch: Partial<Pick<PlacedPart,
        "position" | "rotation" | "scale" | "locked" | "hidden" | "mirrored" | "part_name"
      >>;
    }) => {
      const { data, error } = await (supabase as any)
        .from("placed_parts")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as PlacedPart;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["placed_parts", vars.project_id] });
    },
  });
}

export function useDeletePlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await (supabase as any)
        .from("placed_parts")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["placed_parts", vars.project_id] });
    },
  });
}

export function useDuplicatePlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (part: PlacedPart) => {
      const { id, created_at, updated_at, ...rest } = part;
      const next = {
        ...rest,
        position: { ...part.position, x: part.position.x + 0.2 },
      };
      const { data, error } = await (supabase as any)
        .from("placed_parts")
        .insert(next)
        .select("*")
        .single();
      if (error) throw error;
      return data as PlacedPart;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["placed_parts", data.project_id] });
    },
  });
}
