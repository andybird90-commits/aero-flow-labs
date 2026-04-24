/**
 * React Query hooks for the cad_jobs table — the queue that backs the
 * external Onshape parametric CAD worker (parallel to geometry-jobs/Blender
 * and meshify-part/Rodin).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CadJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface CadJob {
  id: string;
  user_id: string;
  concept_id: string | null;
  project_id: string | null;
  part_kind: string;
  part_label: string | null;
  status: CadJobStatus;
  recipe: Record<string, any>;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  worker_task_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function useCadJob(id: string | null | undefined) {
  return useQuery({
    queryKey: ["cad_job", id],
    enabled: !!id,
    refetchInterval: (q) => {
      const j = q.state.data as CadJob | undefined;
      if (!j) return 4000;
      return j.status === "succeeded" || j.status === "failed" ? false : 4000;
    },
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cad_jobs")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as CadJob | null;
    },
  });
}

export function useGenerateCadRecipe() {
  return useMutation({
    mutationFn: async (input: {
      concept_id?: string | null;
      part_kind: string;
      part_label?: string;
      reference_image_urls?: string[];
      base_mesh_url?: string | null;
      notes?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("generate-cad-recipe", {
        body: input,
      });
      if (error) throw error;
      const payload = data as {
        recipe?: any;
        error?: string;
        issues?: string[];
        fallback_used?: boolean;
        original_issues?: string[];
      };
      if (payload?.error) {
        const detail = payload.issues?.length ? `\n• ${payload.issues.slice(0, 5).join("\n• ")}` : "";
        throw new Error(payload.error + detail);
      }
      if (!payload?.recipe) throw new Error("No recipe returned");
      return {
        recipe: payload.recipe as Record<string, any>,
        fallback_used: !!payload.fallback_used,
        original_issues: payload.original_issues ?? [],
      };
    },
  });
}

export function useDispatchCadJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      concept_id?: string | null;
      project_id?: string | null;
      part_kind: string;
      part_label?: string;
      recipe: Record<string, any>;
      inputs?: Record<string, any>;
    }) => {
      const { data, error } = await supabase.functions.invoke("dispatch-cad-job", {
        body: input,
      });
      if (error) throw error;
      const payload = data as { job_id?: string; error?: string };
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.job_id) throw new Error("Dispatcher returned no job id");
      return payload.job_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cad_jobs"] });
    },
  });
}

export function useRefreshCadJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job_id: string) => {
      const { data, error } = await supabase.functions.invoke("cad-job-status", {
        body: { job_id },
      });
      if (error) throw error;
      return data as { status: CadJobStatus; outputs?: Record<string, any> };
    },
    onSuccess: (_d, job_id) => {
      qc.invalidateQueries({ queryKey: ["cad_job", job_id] });
      qc.invalidateQueries({ queryKey: ["cad_jobs"] });
    },
  });
}
