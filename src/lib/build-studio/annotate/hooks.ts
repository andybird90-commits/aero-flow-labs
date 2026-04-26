/**
 * Persistence layer for studio annotations. Hydrates the in-memory store
 * from `studio_annotations` rows and offers a debounced `saveLayer` mutation.
 */
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAnnotationStore, type AnnotationLayer, type Stroke, type CameraPose } from "./store";

interface AnnotationRow {
  id: string;
  user_id: string;
  project_id: string;
  kind: "screen" | "surface";
  label: string | null;
  color: string;
  strokes: Stroke[];
  camera_pose: CameraPose | null;
  visible: boolean;
}

function rowToLayer(r: AnnotationRow): AnnotationLayer {
  return {
    id: `db-${r.id}`,
    persistedId: r.id,
    label: r.label ?? "Annotation",
    color: r.color,
    visible: r.visible,
    kind: r.kind,
    cameraPose: r.camera_pose,
    strokes: Array.isArray(r.strokes) ? r.strokes : [],
  };
}

export function useStudioAnnotations(projectId: string | undefined | null) {
  return useQuery({
    queryKey: ["studio_annotations", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("studio_annotations")
        .select("*")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as AnnotationRow[]).map(rowToLayer);
    },
  });
}

/** Hydrate the zustand store whenever the loaded layers change. */
export function useHydrateAnnotations(projectId: string | undefined | null) {
  const { data } = useStudioAnnotations(projectId);
  const hydrate = useAnnotationStore((s) => s.hydrate);
  const lastHash = useRef<string>("");
  useEffect(() => {
    if (!data) return;
    const hash = data.map((l) => l.persistedId).join("|");
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    hydrate(data);
  }, [data, hydrate]);
}

export function useSaveAnnotationLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      userId: string;
      projectId: string;
      layer: AnnotationLayer;
    }) => {
      const payload = {
        user_id: input.userId,
        project_id: input.projectId,
        kind: input.layer.kind,
        label: input.layer.label,
        color: input.layer.color,
        strokes: input.layer.strokes as any,
        camera_pose: input.layer.cameraPose as any,
        visible: input.layer.visible,
      };
      if (input.layer.persistedId) {
        const { data, error } = await supabase
          .from("studio_annotations")
          .update(payload)
          .eq("id", input.layer.persistedId)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from("studio_annotations")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["studio_annotations", vars.projectId] });
    },
  });
}

export function useDeleteAnnotationLayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; projectId: string }) => {
      const { error } = await supabase
        .from("studio_annotations")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["studio_annotations", vars.projectId] });
    },
  });
}
