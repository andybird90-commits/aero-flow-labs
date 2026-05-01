/**
 * Blender Jobs data layer — list, dispatch, poll, cancel jobs that run on the
 * external Blender worker (`blender-worker/worker.py`).
 *
 * The 14 `blender_job_type` operations cover the entire post-Meshy pipeline:
 * trim/conform/thicken/lip/tabs/mirror/split/repair/decimate/wheel-arches/
 * window-openings/panelise/export. Each op carries a typed parameter shape so
 * the admin UI can render the right form.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type BlenderJob = Database["public"]["Tables"]["blender_jobs"]["Row"];
export type BlenderJobType = Database["public"]["Enums"]["blender_job_type"];
export type BlenderJobStatus = Database["public"]["Enums"]["blender_job_status"];

/** Friendly labels + grouping for the 14 operations. */
export const BLENDER_OP_META: Record<
  BlenderJobType,
  { label: string; group: "Trim & Fit" | "Reinforce" | "Mirror & Split" | "Repair" | "Cut" | "Panelise" | "Export"; description: string }
> = {
  trim_part_to_car: { label: "Trim part to car", group: "Trim & Fit", description: "Boolean-cut the part against the car body to remove overlap." },
  conform_edge_to_body: { label: "Conform edge to body", group: "Trim & Fit", description: "Project the part's mating edge onto the body surface for a flush fit." },
  thicken_shell: { label: "Thicken shell", group: "Reinforce", description: "Solidify a single-sided surface to a printable wall thickness." },
  add_return_lip: { label: "Add return lip", group: "Reinforce", description: "Extrude an inward-facing lip along open boundary edges." },
  add_mounting_tabs: { label: "Add mounting tabs", group: "Reinforce", description: "Place flanged tabs at hardpoints for fasteners." },
  mirror_part: { label: "Mirror part", group: "Mirror & Split", description: "Mirror across the car centreline to create the opposite-side variant." },
  split_for_print_bed: { label: "Split for print bed", group: "Mirror & Split", description: "Slice the part into bed-sized chunks with index markers." },
  repair_watertight: { label: "Repair → watertight", group: "Repair", description: "Fix non-manifold edges, fill holes, recalc normals." },
  decimate_mesh: { label: "Decimate mesh", group: "Repair", description: "Reduce triangle count while preserving silhouette." },
  cut_wheel_arches: { label: "Cut wheel arches", group: "Cut", description: "Remove geometry intersecting the wheel-rotation cylinders." },
  cut_window_openings: { label: "Cut window openings", group: "Cut", description: "Boolean-cut window openings using the donor car windows." },
  panelise_body_skin: { label: "Panelise body skin", group: "Panelise", description: "Split a full body skin into bonnet / doors / quarters / bumpers panels." },
  export_stl: { label: "Export STL", group: "Export", description: "Write a print-ready binary STL with chosen units." },
  export_glb_preview: { label: "Export GLB preview", group: "Export", description: "Write a textured GLB for in-browser preview." },
  generate_part: { label: "Generate part (AI)", group: "Export", description: "AI-driven procedural part generation via the Blender actor." },
};

export const BLENDER_OPS: BlenderJobType[] = Object.keys(BLENDER_OP_META) as BlenderJobType[];

/** Default parameter blocks per op — these become the form schema. */
export function defaultParamsFor(op: BlenderJobType): Record<string, unknown> {
  switch (op) {
    case "trim_part_to_car":
      return { offset_mm: 1.5, smooth_iters: 2 };
    case "conform_edge_to_body":
      return { search_radius_mm: 25, smoothing: 0.4 };
    case "thicken_shell":
      return { thickness_mm: 3.0, even_offset: true };
    case "add_return_lip":
      return { lip_depth_mm: 8, lip_angle_deg: 90 };
    case "add_mounting_tabs":
      return { tab_count: 4, tab_size_mm: 18, hole_diameter_mm: 6.5 };
    case "mirror_part":
      return { axis: "x", merge_centreline: true };
    case "split_for_print_bed":
      return { bed_x_mm: 256, bed_y_mm: 256, bed_z_mm: 256, kerf_mm: 0.4 };
    case "repair_watertight":
      return { fill_holes: true, recalc_normals: true, max_hole_edges: 64 };
    case "decimate_mesh":
      return { ratio: 0.5, preserve_boundaries: true };
    case "cut_wheel_arches":
      return { clearance_mm: 8 };
    case "cut_window_openings":
      return { offset_mm: 2 };
    case "panelise_body_skin":
      return { panels: ["bonnet", "front_bumper", "left_door", "right_door", "left_quarter", "right_quarter", "rear_bumper", "roof"] };
    case "export_stl":
      return { units: "mm", binary: true };
    case "export_glb_preview":
      return { draco: true };
    case "generate_part":
      return { part_kind: "front_splitter", style_prompt: "", symmetry: "mirror_x" };
  }
}

/* ------------------------------------------------------------------------ */
/*  Hooks                                                                    */
/* ------------------------------------------------------------------------ */

export function useBlenderJobs() {
  return useQuery({
    queryKey: ["blender_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blender_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as BlenderJob[];
    },
    refetchInterval: (q) => {
      const rows = (q.state.data ?? []) as BlenderJob[];
      return rows.some((r) => r.status === "queued" || r.status === "running") ? 4000 : false;
    },
  });
}

export interface DispatchBlenderJobInput {
  operation_type: BlenderJobType;
  parameters?: Record<string, unknown>;
  input_mesh_urls?: Record<string, string>;
  selected_part_ids?: string[];
  body_skin_id?: string | null;
  donor_car_template_id?: string | null;
  project_id?: string | null;
}

export function useDispatchBlenderJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DispatchBlenderJobInput) => {
      const { data, error } = await supabase.functions.invoke("dispatch-blender-job", {
        body: input,
      });
      if (error) throw error;
      return data as { job_id: string; status: string; worker_task_id?: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blender_jobs"] }),
  });
}

export function usePollBlenderJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (job_id: string) => {
      const { data, error } = await supabase.functions.invoke("blender-job-status", {
        body: { job_id },
      });
      if (error) throw error;
      return data as { status: BlenderJobStatus; outputs?: Record<string, string>; error?: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blender_jobs"] }),
  });
}

export function useDeleteBlenderJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("blender_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blender_jobs"] }),
  });
}
