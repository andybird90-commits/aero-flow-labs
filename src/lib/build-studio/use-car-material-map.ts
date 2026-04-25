/**
 * useCarMaterialMap — fetch + auto-trigger the per-triangle material
 * classification for a car_stl.
 *
 * The classification is a one-time, shared computation per hero STL, stored
 * in `car_material_maps`. When a car opens for the first time and no map
 * exists, the hook fires the `classify-car-materials` edge function which
 * runs the geometric classifier server-side and persists the result.
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CarMaterialMap {
  id: string;
  car_stl_id: string;
  method: string;
  triangle_count: number;
  tag_blob_b64: string;
  stats: { body?: number; glass?: number; wheel?: number; tyre?: number; total?: number };
  ai_notes: string | null;
}

/** Decode base64 → Uint8Array of per-triangle tags. */
export function decodeTagBlob(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function useCarMaterialMap(carStlId: string | null | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["car_material_map", carStlId],
    enabled: !!carStlId,
    queryFn: async (): Promise<CarMaterialMap | null> => {
      const { data, error } = await supabase
        .from("car_material_maps")
        .select("*")
        .eq("car_stl_id", carStlId!)
        .maybeSingle();
      if (error) throw error;
      return (data as CarMaterialMap | null) ?? null;
    },
  });

  // Auto-trigger classification if missing OR if cached at an older method
  // version. Manual (admin-curated) maps are NEVER auto-replaced — admins
  // own them; bump this string only when the *automatic* classifier improves.
  const CURRENT_METHOD = "geometric-v2";

  useEffect(() => {
    if (!carStlId || query.isLoading) return;
    // Manual maps win — never overwrite an admin's curation.
    if (query.data && query.data.method === "manual") return;
    if (query.data && query.data.method === CURRENT_METHOD) return;
    let cancelled = false;
    (async () => {
      try {
        const { error } = await supabase.functions.invoke("classify-car-materials", {
          body: { car_stl_id: carStlId, force: !!query.data },
        });
        if (cancelled || error) return;
        qc.invalidateQueries({ queryKey: ["car_material_map", carStlId] });
      } catch (e) {
        console.error("[useCarMaterialMap] classify failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carStlId, query.data, query.isLoading, qc]);

  const tags = useMemo(() => {
    if (!query.data) return null;
    return decodeTagBlob(query.data.tag_blob_b64);
  }, [query.data]);

  return {
    map: query.data ?? null,
    tags,
    loading: query.isLoading,
    error: query.error,
  };
}
