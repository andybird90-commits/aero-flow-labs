/**
 * Bottom strip — placed parts timeline. Shows every part in the current
 * project; clicking selects it.
 */
import { Box, Eye, EyeOff, Lock } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import { cn } from "@/lib/utils";

interface Props {
  parts: PlacedPart[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PlacedPartsStrip({ parts, selectedId, onSelect }: Props) {
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
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={cn(
                "flex h-12 min-w-[120px] shrink-0 items-center gap-2 rounded-md border px-2 text-left transition",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card/40 hover:border-primary/40 hover:bg-card",
              )}
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
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}
