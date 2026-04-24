/**
 * Hook + types for the cad-worker-status edge function. Powers the in-app
 * guided setup flow that gates "Build with CAD".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CadWorkerState =
  | "ok"
  | "missing_secrets"
  | "unreachable"
  | "unauthorized"
  | "unhealthy";

export interface CadWorkerStatus {
  state: CadWorkerState;
  has_url: boolean;
  has_token: boolean;
  worker_url?: string;
  http_status?: number;
  detail?: string;
}

async function fetchStatus(): Promise<CadWorkerStatus> {
  const { data, error } = await supabase.functions.invoke("cad-worker-status", {
    body: {},
  });
  if (error) throw error;
  return data as CadWorkerStatus;
}

export function useCadWorkerStatus(enabled = true) {
  return useQuery({
    queryKey: ["cad_worker_status"],
    enabled,
    staleTime: 30_000,
    queryFn: fetchStatus,
  });
}

export function useRecheckCadWorkerStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchStatus,
    onSuccess: (data) => {
      qc.setQueryData(["cad_worker_status"], data);
    },
  });
}
