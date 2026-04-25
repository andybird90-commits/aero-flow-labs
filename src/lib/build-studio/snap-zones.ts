/**
 * Snap zones data layer — admin-managed attachment slots on a car_template.
 *
 * Snap zones are positioned in the same normalized car-space as the placed
 * parts (origin = ground centre, +X = forward, Y = up, Z = lateral). They're
 * keyed to a car_template (not a project), so the same set works for every
 * project that uses that template.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Vec3 } from "@/lib/build-studio/placed-parts";

export type SnapZoneType = Database["public"]["Enums"]["snap_zone_type"];

export interface SnapZone {
  id: string;
  car_template_id: string;
  zone_type: SnapZoneType;
  label: string | null;
  notes: string | null;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  normal: Vec3;
  mirror_zone_id: string | null;
  created_at: string;
  updated_at: string;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const ONE: Vec3 = { x: 1, y: 1, z: 1 };
const UP: Vec3 = { x: 0, y: 1, z: 0 };

export function useSnapZones(carTemplateId: string | undefined | null) {
  return useQuery({
    queryKey: ["snap_zones", carTemplateId],
    enabled: !!carTemplateId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("snap_zones")
        .select("*")
        .eq("car_template_id", carTemplateId!)
        .order("zone_type", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SnapZone[];
    },
  });
}

export function useAddSnapZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      car_template_id: string;
      zone_type: SnapZoneType;
      label?: string;
      position?: Vec3;
    }) => {
      const { data, error } = await (supabase as any)
        .from("snap_zones")
        .insert({
          car_template_id: input.car_template_id,
          zone_type: input.zone_type,
          label: input.label ?? null,
          position: input.position ?? { x: 0, y: 0.5, z: 0 },
          rotation: ZERO,
          scale: ONE,
          normal: UP,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as SnapZone;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["snap_zones", vars.car_template_id] });
    },
  });
}

export function useUpdateSnapZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      car_template_id: string;
      patch: Partial<Pick<SnapZone, "position" | "rotation" | "scale" | "normal" | "label" | "notes" | "zone_type">>;
    }) => {
      const { data, error } = await (supabase as any)
        .from("snap_zones")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as SnapZone;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["snap_zones", vars.car_template_id] });
    },
  });
}

export function useDeleteSnapZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; car_template_id: string }) => {
      const { error } = await (supabase as any)
        .from("snap_zones")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["snap_zones", vars.car_template_id] });
    },
  });
}

/* ─── Snap helpers ─── */

export function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function nearestSnapZone(
  pos: Vec3,
  zones: SnapZone[],
  threshold = 0.5,
): SnapZone | null {
  let best: { zone: SnapZone; d: number } | null = null;
  for (const z of zones) {
    const d = distSq(pos, z.position);
    if (!best || d < best.d) best = { zone: z, d };
  }
  if (!best) return null;
  return Math.sqrt(best.d) <= threshold ? best.zone : null;
}

export const SNAP_ZONE_LABELS: Record<SnapZoneType, string> = {
  front_left_arch: "Front L arch",
  front_right_arch: "Front R arch",
  rear_left_arch: "Rear L arch",
  rear_right_arch: "Rear R arch",
  front_splitter: "Front splitter",
  rear_diffuser: "Rear diffuser",
  left_sill: "Side skirt L",
  right_sill: "Side skirt R",
  rear_wing: "Rear wing",
  bonnet: "Bonnet",
  roof: "Roof",
  left_door: "Door L",
  right_door: "Door R",
  left_quarter: "Quarter L",
  right_quarter: "Quarter R",
};

export const SNAP_ZONE_TYPES: SnapZoneType[] = Object.keys(SNAP_ZONE_LABELS) as SnapZoneType[];

/**
 * Heuristic: which zone type pairs with which on the opposite side?
 * Used by the admin "auto-pair" tool and by the user-side mirror button.
 */
export const MIRROR_TYPE: Partial<Record<SnapZoneType, SnapZoneType>> = {
  front_left_arch: "front_right_arch",
  front_right_arch: "front_left_arch",
  rear_left_arch: "rear_right_arch",
  rear_right_arch: "rear_left_arch",
  left_sill: "right_sill",
  right_sill: "left_sill",
  left_door: "right_door",
  right_door: "left_door",
  left_quarter: "right_quarter",
  right_quarter: "left_quarter",
};

/** Find the mirror partner of a zone (explicit mirror_zone_id wins, else heuristic). */
export function findMirrorZone(zone: SnapZone, all: SnapZone[]): SnapZone | null {
  if (zone.mirror_zone_id) {
    return all.find((z) => z.id === zone.mirror_zone_id) ?? null;
  }
  const partnerType = MIRROR_TYPE[zone.zone_type];
  if (!partnerType) return null;
  return all.find((z) => z.zone_type === partnerType) ?? null;
}
