/**
 * Left rail — part library picker. Filters the user's library_items down to
 * mesh-bearing kinds (CAD / geometry / concept-part / aero-kit) and lets them
 * add one to the scene with a click.
 */
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Box, ImageIcon } from "lucide-react";
import type { LibraryItem } from "@/lib/repo";
import { MeshStructureChip } from "@/components/build-studio/MeshStructureChip";

const MESH_KINDS = new Set([
  "aero_kit_mesh",
  "concept_part_mesh",
  "prototype_part_mesh",
  "geometry_part_mesh",
  "cad_part_mesh",
]);

/**
 * A library row is only "addable" if it has a real, downloadable mesh asset.
 * Anything pointing at localhost (dev artefacts), or with no URL / no mesh
 * extension, would render as an orange placeholder box and break Live Fit —
 * so we hide them from the picker entirely.
 */
function hasUsableMesh(item: LibraryItem): boolean {
  const url = item.asset_url?.trim();
  if (!url) return false;
  if (/^https?:\/\/(localhost|127\.)/i.test(url)) return false;
  const path = url.toLowerCase().split("?")[0];
  const mime = (item.asset_mime ?? "").toLowerCase();
  return (
    path.endsWith(".glb") ||
    path.endsWith(".gltf") ||
    path.endsWith(".stl") ||
    mime.includes("gltf") ||
    mime.includes("glb") ||
    mime.includes("stl")
  );
}

interface Props {
  items: LibraryItem[] | undefined;
  isLoading: boolean;
  onAdd: (item: LibraryItem) => void;
  onAddBlank: () => void;
}

export function PartLibraryRail({ items, isLoading, onAdd, onAddBlank }: Props) {
  const meshes = (items ?? []).filter((i) => MESH_KINDS.has(i.kind) && hasUsableMesh(i));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Part library
          </div>
          <div className="text-sm font-medium">{meshes.length} parts</div>
        </div>
        <Button size="sm" variant="outline" onClick={onAddBlank} className="h-7 gap-1 text-xs">
          <Plus className="h-3 w-3" /> Blank
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2 py-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : meshes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No 3D parts in your library yet. Add a blank part to start blocking
            out, or generate parts in Concept Studio.
          </div>
        ) : (
          <div className="space-y-1">
            {meshes.map((item) => (
              <button
                key={item.id}
                onClick={() => onAdd(item)}
                className="group flex w-full items-center gap-2 rounded-md border border-border bg-card/40 p-1.5 text-left transition hover:border-primary/50 hover:bg-card"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {item.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail_url}
                      alt={item.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Box className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium leading-tight text-foreground">
                    {item.title}
                  </div>
                  <div className="truncate text-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">
                    {item.kind.replace(/_/g, " ")}
                  </div>
                  <div className="mt-0.5 truncate">
                    <MeshStructureChip item={item} variant="inline" />
                  </div>
                </div>
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-hover:text-primary" />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
