/**
 * Bottom strip — placed parts timeline. Shows every part in the current
 * project; clicking selects it. Each chip has a quick-delete button.
 */
import { Box, Eye, EyeOff, Lock, Trash2 } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import { cn } from "@/lib/utils";

interface Props {
  parts: PlacedPart[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function PlacedPartsStrip({ parts, selectedId, onSelect, onDelete }: Props) {
  if (parts.length === 0) {
    return (
      <div className="flex h-full items-center px-3 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        No placed parts — add one from the left rail.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex gap-1.5 px-2 py-1.5">
        {parts.map((p) => {
          const active = p.id === selectedId;
          return (
            <div
              key={p.id}
              className={cn(
                "group relative flex h-12 min-w-[140px] shrink-0 items-center gap-2 rounded-md border pl-2 pr-1 transition",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card/40 hover:border-primary/40 hover:bg-card",
              )}
            >
              <button
                onClick={() => onSelect(p.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Box className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {p.part_name ?? "Untitled"}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {p.locked && <Lock className="h-2.5 w-2.5" />}
                    {p.hidden ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                  </div>
                </div>
              </button>
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (p.locked) return;
                    if (confirm(`Delete "${p.part_name ?? "Untitled"}"?`)) {
                      onDelete(p.id);
                    }
                  }}
                  disabled={p.locked}
                  title={p.locked ? "Unlock to delete" : "Delete part"}
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded transition",
                    "text-muted-foreground hover:bg-destructive/15 hover:text-destructive",
                    "opacity-0 group-hover:opacity-100",
                    p.locked && "cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
