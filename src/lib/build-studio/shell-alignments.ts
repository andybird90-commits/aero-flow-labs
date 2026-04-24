/**
 * Shell alignments — per-project transform of a body skin overlay (Shell Fit).
 *
 * One row per (project_id, body_skin_id) is enforced softly here: we look up
 * the existing row and update it, otherwise insert. Position/rotation/scale
 * are stored as {x,y,z} JSONB and applied in the Build Studio viewport.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Vec3 } from "./placed-parts";

export type ShellAlignment = Database["public"]["Tables"]["shell_alignments"]["Row"];

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
    }) => {
      // Find existing
      const { data: existing } = await (supabase as any)
        .from("shell_alignments")
        .select("id")
        .eq("project_id", input.project_id)
        .eq("body_skin_id", input.body_skin_id)
        .maybeSingle();

      const payload: any = {
        user_id: input.user_id,
        project_id: input.project_id,
        body_skin_id: input.body_skin_id,
        position: input.position ?? { x: 0, y: 0, z: 0 },
        rotation: input.rotation ?? { x: 0, y: 0, z: 0 },
        scale: input.scale ?? { x: 1, y: 1, z: 1 },
        scale_to_wheelbase: input.scale_to_wheelbase ?? true,
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
