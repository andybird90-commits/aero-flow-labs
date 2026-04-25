/**
 * Shell alignments — per-project transform of a body skin overlay (Shell Fit).
 *
 * One row per (project_id, body_skin_id) is enforced softly here: we look up
 * the existing row and update it, otherwise insert. Position/rotation/scale
 * are stored as {x,y,z} JSONB and applied in the Build Studio viewport.
 *
 * `locked_hardpoints` stores a list of (car_hardpoint_id ↔ shell point) pairs
 * that the user has clicked. When 3+ pairs exist we can solve a Kabsch-style
 * similarity transform to auto-align the shell to the donor car.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Vec3 } from "./placed-parts";

export type ShellAlignment = Database["public"]["Tables"]["shell_alignments"]["Row"];

/** A user-defined pair tying a car hardpoint to a point on the shell mesh. */
export interface LockedHardpointPair {
  car_hardpoint_id: string;
  /** Cached label so deletes/missing hardpoints still display sensibly. */
  label: string;
  /** Shell-local point (in the *untransformed* shell's coord frame) clicked by the user. */
  shell: Vec3;
}

export function useShellAlignment(projectId: string | null | undefined, bodySkinId: string | null | undefined) {
  return useQuery({
    queryKey: ["shell_alignment", projectId, bodySkinId],
    enabled: !!projectId && !!bodySkinId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shell_alignments")
        .select("*")
        .eq("project_id", projectId!)
        .eq("body_skin_id", bodySkinId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ShellAlignment | null;
    },
  });
}

/**
 * Most-recently-updated alignment for a project, regardless of body skin.
 * Used by the Showroom (which has no UI to pick the active skin) so it can
 * render whatever shell the user last fitted in the Build Studio.
 */
export function useLatestShellAlignmentForProject(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["shell_alignment_latest", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shell_alignments")
        .select("*")
        .eq("project_id", projectId!)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ShellAlignment | null;
    },
  });
}
export function useUpsertShellAlignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      user_id: string;
      project_id: string;
      body_skin_id: string;
      position?: Vec3;
      rotation?: Vec3;
      scale?: Vec3;
      scale_to_wheelbase?: boolean;
      locked_hardpoints?: LockedHardpointPair[];
    }) => {
      // Find existing
      const { data: existing } = await (supabase as any)
        .from("shell_alignments")
        .select("id, position, rotation, scale, scale_to_wheelbase, locked_hardpoints")
        .eq("project_id", input.project_id)
        .eq("body_skin_id", input.body_skin_id)
        .maybeSingle();

      const payload: any = {
        user_id: input.user_id,
        project_id: input.project_id,
        body_skin_id: input.body_skin_id,
        position: input.position ?? existing?.position ?? { x: 0, y: 0, z: 0 },
        rotation: input.rotation ?? existing?.rotation ?? { x: 0, y: 0, z: 0 },
        scale: input.scale ?? existing?.scale ?? { x: 1, y: 1, z: 1 },
        scale_to_wheelbase:
          input.scale_to_wheelbase ?? existing?.scale_to_wheelbase ?? true,
        locked_hardpoints:
          input.locked_hardpoints ?? existing?.locked_hardpoints ?? [],
      };

      if (existing?.id) {
        const { data, error } = await (supabase as any)
          .from("shell_alignments")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw error;
        return data as ShellAlignment;
      } else {
        const { data, error } = await (supabase as any)
          .from("shell_alignments")
          .insert(payload)
          .select("*")
          .single();
        if (error) throw error;
        return data as ShellAlignment;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["shell_alignment", vars.project_id, vars.body_skin_id] });
    },
  });
}
