/**
 * React Query hooks for the geometry_jobs table — the queue that backs the
 * external Blender worker (fit/mirror/export of body-conforming parts).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GeometryJobType =
  | "prepare_base_mesh"
  | "fit_part_to_zone"
  | "mirror_part"
  | "export_stl";

export type GeometryJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type GeometryJobSide = "left" | "right" | "center";

export interface GeometryJob {
  id: string;
  user_id: string;
  concept_id: string | null;
  project_id: string | null;
  part_kind: string;
  mount_zone: string;
  side: GeometryJobSide;
  job_type: GeometryJobType;
  status: GeometryJobStatus;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  worker_task_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function useGeometryJob(id: string | null | undefined) {
  return useQuery({
    queryKey: ["geometry_job", id],
    enabled: !!id,
    refetchInterval: (q) => {
      const j = q.state.data as GeometryJob | undefined;
      if (!j) return 4000;
      return j.status === "succeeded" || j.status === "failed" ? false : 4000;
    },
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("geometry_jobs")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data as GeometryJob | null;
    },
  });
}

export function useMyGeometryJobs(userId: string | undefined) {
  return useQuery({
    queryKey: ["geometry_jobs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("geometry_jobs")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as GeometryJob[];
    },
  });
}

/**
 * Dispatch a new geometry job to the Blender worker via the
 * `dispatch-geometry-job` edge function. Returns the inserted row id so the
 * caller can subscribe to status with `useGeometryJob`.
 */
export function useDispatchGeometryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      concept_id?: string | null;
      project_id?: string | null;
      part_kind: string;
      mount_zone: string;
      side: GeometryJobSide;
      job_type: GeometryJobType;
      inputs: Record<string, any>;
    }) => {
      const { data, error } = await supabase.functions.invoke("dispatch-geometry-job", {
        body: input,
      });
      if (error) throw error;
      const payload = data as { job_id?: string; error?: string };
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.job_id) throw new Error("Dispatcher returned no job id");
      return payload.job_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["geometry_jobs"] });
    },
  });
}

/** Manually poke the status endpoint. The worker → status sync also runs in
 *  the background but a one-off call is useful from the dispatch UI. */
export function useRefreshGeometryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job_id: string) => {
      const { data, error } = await supabase.functions.invoke("geometry-job-status", {
        body: { job_id },
      });
      if (error) throw error;
      return data as { status: GeometryJobStatus; outputs?: Record<string, any> };
    },
    onSuccess: (_d, job_id) => {
      qc.invalidateQueries({ queryKey: ["geometry_job", job_id] });
      qc.invalidateQueries({ queryKey: ["geometry_jobs"] });
    },
  });
}
