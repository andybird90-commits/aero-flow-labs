/**
 * Left panel: Garage car selector + view picker + frozen part library.
 */
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useGarageCars, type GarageCar } from "@/lib/repo";
import { VIEW_ANGLES, type ViewAngle } from "@/lib/prototyper/mount-zones";
import { FrozenPartCard } from "./FrozenPartCard";
import type { FrozenPart } from "@/lib/prototyper/frozen-parts";
import { Plus } from "lucide-react";

interface Props {
  userId: string | undefined;
  garageCarId: string | null;
  onGarageCarChange: (id: string) => void;
  view: ViewAngle;
  onViewChange: (v: ViewAngle) => void;
  carImageByView: Record<ViewAngle, string | null>;
  frozenParts: FrozenPart[];
  selectedFrozenPartId: string | null;
  onSelectFrozenPart: (id: string | null) => void;
  onDeleteFrozenPart: (id: string) => void;
  onNewPrototype: () => void;
  prototypeTitle: string;
}

export function PrototyperLeftPanel({
  userId,
  garageCarId,
  onGarageCarChange,
  view,
  onViewChange,
  carImageByView,
  frozenParts,
  selectedFrozenPartId,
  onSelectFrozenPart,
  onDeleteFrozenPart,
  onNewPrototype,
  prototypeTitle,
}: Props) {
  const { data: cars = [] } = useGarageCars(userId);
  const carsTyped = cars as GarageCar[];

  return (
    <div className="flex flex-col h-full gap-4 overflow-hidden">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Project</div>
        <div className="font-semibold text-sm truncate">{prototypeTitle}</div>
        <Button size="sm" variant="outline" className="mt-2 w-full" onClick={onNewPrototype}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New prototype
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Garage car</Label>
        <Select value={garageCarId ?? ""} onValueChange={onGarageCarChange}>
          <SelectTrigger>
            <SelectValue placeholder="Pick a car…" />
          </SelectTrigger>
          <SelectContent>
            {carsTyped.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No cars in garage yet.
              </div>
            )}
            {carsTyped.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.year ? `${c.year} ` : ""}{c.make} {c.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">View</Label>
        <div className="grid grid-cols-5 gap-1">
          {VIEW_ANGLES.map((v) => {
            const has = !!carImageByView[v.id];
            return (
              <Button
                key={v.id}
                size="xs"
                variant={view === v.id ? "default" : "outline"}
                disabled={!has}
                onClick={() => onViewChange(v.id)}
                className="text-[10px] px-1"
                title={v.label}
              >
                {v.label.split(" ")[0]}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Frozen parts ({frozenParts.length})
          </Label>
        </div>
        <div className="flex-1 overflow-y-auto pr-1">
          {frozenParts.length === 0 ? (
            <Card className="p-3 text-xs text-muted-foreground text-center">
              No frozen parts yet. Generate a concept, then switch to Freeze Part to capture one.
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {frozenParts.map((p) => (
                <FrozenPartCard
                  key={p.id}
                  part={p}
                  active={selectedFrozenPartId === p.id}
                  onSelect={() => onSelectFrozenPart(p.id)}
                  onDelete={() => onDeleteFrozenPart(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
