/**
 * Body kits — baked, panelised aero kits derived from a fitted shell skin.
 *
 * A body kit is the result of running the bodykit pipeline against a
 * `body_skins` mesh aligned to a donor `car_templates` via the user's
 * `shell_alignments` row. Each kit owns:
 *   - a combined STL (`combined_stl_path`) of the outboard geometry, and
 *   - one row per detected panel in `body_kit_parts` (front_splitter,
 *     side_skirt, rear_wing, ...).
 *
 * Step 2 ships the read/queue hooks only — the actual baking happens in a
 * follow-up edge function (`bake-bodykit-from-shell`). Until that lands,
 * `useBakeBodyKit` simply creates a queued row so the UI can show progress
 * once the worker is wired up.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Vec3 } from "./placed-parts";

export type BodyKit = Database["public"]["Tables"]["body_kits"]["Row"];
export type BodyKitPart = Database["public"]["Tables"]["body_kit_parts"]["Row"];
export type BodyKitStatus = Database["public"]["Enums"]["body_kit_bake_status"];

export interface BakedTransformSnapshot {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  scale_to_wheelbase?: boolean;
}

export function useBodyKits(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["body_kits", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("body_kits")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BodyKit[];
    },
  });
}

export function useBodyKitParts(bodyKitId: string | null | undefined) {
  return useQuery({
    queryKey: ["body_kit_parts", bodyKitId],
    enabled: !!bodyKitId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("body_kit_parts")
        .select("*")
        .eq("body_kit_id", bodyKitId!)
        .order("slot", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BodyKitPart[];
    },
  });
}

export interface BakeBodyKitInput {
  user_id: string;
  project_id: string;
  body_skin_id: string;
  shell_alignment_id?: string | null;
  donor_car_template_id?: string | null;
  name?: string;
  baked_transform: BakedTransformSnapshot;
  notes?: string | null;
}

/**
 * Queue a bake. Inserts a `body_kits` row in `queued` status — the edge
 * worker (next step) picks it up, transitions through `subtracting` /
 * `splitting`, and finally writes `body_kit_parts` rows + `combined_stl_path`.
 */
export function useBakeBodyKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BakeBodyKitInput) => {
      const payload: Database["public"]["Tables"]["body_kits"]["Insert"] = {
        user_id: input.user_id,
        project_id: input.project_id,
        body_skin_id: input.body_skin_id,
        shell_alignment_id: input.shell_alignment_id ?? null,
        donor_car_template_id: input.donor_car_template_id ?? null,
        name: input.name ?? `Bodykit ${new Date().toLocaleString()}`,
        baked_transform: input.baked_transform as any,
        status: "queued",
        notes: input.notes ?? null,
      };
      const { data, error } = await (supabase as any)
        .from("body_kits")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return data as BodyKit;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["body_kits", vars.project_id] });
    },
  });
}

export function useDeleteBodyKit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await (supabase as any)
        .from("body_kits")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["body_kits", vars.project_id] });
    },
  });
}

/** Human-readable label for a bake status. */
export function bodyKitStatusLabel(status: BodyKitStatus): string {
  switch (status) {
    case "idle": return "Draft";
    case "queued": return "Queued";
    case "baking": return "Baking";
    case "subtracting": return "Subtracting donor";
    case "splitting": return "Splitting panels";
    case "ready": return "Ready";
    case "failed": return "Failed";
    default: return status;
  }
}

/** Whether the kit is currently being processed by the worker. */
export function isBodyKitInFlight(status: BodyKitStatus): boolean {
  return status === "queued" || status === "baking" || status === "subtracting" || status === "splitting";
}
