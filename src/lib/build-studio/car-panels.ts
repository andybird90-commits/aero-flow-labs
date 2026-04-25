/**
 * Car panels — auto-split body panels stored against a car_stls row.
 *
 * Panels are produced by the `auto-split-car-stl` edge function. Each row
 * points to its own STL file in the `car-stls` bucket and carries the slot
 * label (hood, door_l, ...), classifier confidence, and bbox metadata
 * including a `boundary_centroid` that doubles as the auto-derived hardpoint
 * anchor.
 *
 * RLS lets any authenticated user read panels; only admins can write.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CarPanelBbox {
  min: [number, number, number];
  max: [number, number, number];
  centroid: [number, number, number];
  avg_normal: [number, number, number];
  boundary_centroid: [number, number, number] | null;
  boundary_vertex_count: number;
}

export interface CarPanel {
  id: string;
  car_stl_id: string;
  slot: string;
  confidence: number;
  stl_path: string;
  triangle_count: number;
  area_m2: number;
  bbox: CarPanelBbox;
  created_at: string;
  updated_at: string;
}

export type AutoSplitResult =
  | {
      ok: true;
      total_panels: number;
      named_panels: number;
      unknown_panels: number;
      sharp_edges: number;
      total_triangles: number;
      threshold_deg: number;
      summary: Array<{
        slot: string;
        confidence: number;
        triangle_count: number;
        area_m2: number;
        reason: string;
      }>;
    }
  | {
      ok: false;
      reason: "no_shut_lines_detected" | "needs_repair";
      message: string;
      components_found?: number;
      sharp_edges?: number;
    };

export function useCarPanels(carStlId: string | null | undefined) {
  return useQuery({
    queryKey: ["car_panels", carStlId],
    enabled: !!carStlId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("car_panels")
        .select("*")
        .eq("car_stl_id", carStlId!)
        .order("slot", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CarPanel[];
    },
  });
}

export function useUpdateCarPanelSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; car_stl_id: string; slot: string }) => {
      const { data, error } = await (supabase as any)
        .from("car_panels")
        .update({ slot: input.slot })
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as CarPanel;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["car_panels", vars.car_stl_id] });
    },
  });
}

export function useRunAutoSplit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { car_stl_id: string; threshold_deg?: number }) => {
      const { data, error } = await supabase.functions.invoke("auto-split-car-stl", {
        body: input,
      });
      if (error) throw error;
      return data as AutoSplitResult;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["car_panels", vars.car_stl_id] });
    },
  });
}

/**
 * Resolve a panel STL path to a temporary signed URL for client-side rendering.
 */
export async function getPanelSignedUrl(stlPath: string, ttlSeconds = 3600): Promise<string | null> {
  const { data, error } = await (supabase as any).storage
    .from("car-stls")
    .createSignedUrl(stlPath, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl as string;
}

export const PANEL_SLOT_LABELS: Record<string, string> = {
  hood: "Hood",
  roof: "Roof",
  trunk_lid: "Trunk lid",
  front_bumper: "Front bumper",
  rear_bumper: "Rear bumper",
  door_l: "Door (L)",
  door_r: "Door (R)",
  fender_l: "Fender (L)",
  fender_r: "Fender (R)",
  mirror_l: "Mirror (L)",
  mirror_r: "Mirror (R)",
  wheel_l_f: "Wheel (LF)",
  wheel_l_r: "Wheel (LR)",
  wheel_r_f: "Wheel (RF)",
  wheel_r_r: "Wheel (RR)",
  windshield: "Windshield",
  rear_window: "Rear window",
  side_window_l: "Side window (L)",
  side_window_r: "Side window (R)",
};

export function panelDisplayLabel(slot: string): string {
  // Strip trailing _2/_3 disambiguators for display.
  const base = slot.replace(/_(\d+)$/, "");
  const label = PANEL_SLOT_LABELS[base];
  if (!label) return slot;
  const m = slot.match(/_(\d+)$/);
  return m ? `${label} #${m[1]}` : label;
}
