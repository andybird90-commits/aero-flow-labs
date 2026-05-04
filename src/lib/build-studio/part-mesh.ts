/**
 * Helpers for resolving a placed part's underlying 3D asset.
 *
 * A placed_parts row may be:
 *   • Linked to a library_item (asset_url + asset_mime)
 *   • Or a "blank" stand-in (no library item) — in which case we render a box
 *
 * We treat anything with `model/gltf-binary` (or `.glb`) as a GLB, anything
 * with `model/stl` (or `.stl`) as an STL. URLs that have neither hint default
 * to STL since most uploaded car bodywork is STL.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LibraryItem } from "@/lib/repo";

export type MeshAssetKind = "glb" | "stl" | "obj";

export interface ResolvedMeshAsset {
  url: string;
  kind: MeshAssetKind;
}

export function detectMeshKind(item: LibraryItem | null | undefined): MeshAssetKind | null {
  if (!item?.asset_url) return null;
  const mime = (item.asset_mime ?? "").toLowerCase();
  if (mime.includes("gltf") || mime.includes("glb")) return "glb";
  if (mime.includes("stl")) return "stl";
  if (mime.includes("obj")) return "obj";
  const url = item.asset_url.toLowerCase().split("?")[0];
  if (url.endsWith(".glb") || url.endsWith(".gltf")) return "glb";
  if (url.endsWith(".stl")) return "stl";
  if (url.endsWith(".obj")) return "obj";
  return "stl";
}

/**
 * Look up library items in bulk by id; used by the viewport to know what to
 * draw for each placed part.
 */
export function useLibraryItemsByIds(ids: string[]) {
  const sortedIds = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["library_items_by_ids", sortedIds.join(",")],
    enabled: sortedIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("library_items")
        .select("id, kind, title, asset_url, asset_mime, thumbnail_url, metadata")
        .in("id", sortedIds);
      if (error) throw error;
      const map = new Map<string, LibraryItem>();
      for (const row of (data ?? []) as LibraryItem[]) map.set(row.id, row);
      return map;
    },
  });
}
