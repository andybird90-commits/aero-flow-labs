import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { FrozenPart } from "@/lib/prototyper/frozen-parts";

interface Props {
  part: FrozenPart;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function FrozenPartCard({ part, active, onSelect, onDelete }: Props) {
  return (
    <Card
      onClick={onSelect}
      className={`group relative cursor-pointer overflow-hidden border ${
        active ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="aspect-square w-full bg-surface-2 flex items-center justify-center">
        {part.silhouette_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={part.silhouette_url}
            alt={part.name}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="text-xs text-muted-foreground">No preview</div>
        )}
      </div>
      <div className="p-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium truncate">{part.name}</div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px] px-1 py-0">{String(part.category)}</Badge>
          <Badge variant="outline" className="text-[10px] px-1 py-0">{String(part.mount_zone)}</Badge>
          {part.side !== "center" && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">{String(part.side)}</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
