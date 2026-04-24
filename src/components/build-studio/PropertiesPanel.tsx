/**
 * Right rail — selected part properties (name, transform, flags, actions).
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Copy, Trash2, FlipHorizontal, Lock, EyeOff } from "lucide-react";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";

interface Props {
  part: PlacedPart | null;
  onPatch: (patch: Partial<Pick<PlacedPart,
    "position" | "rotation" | "scale" | "locked" | "hidden" | "mirrored" | "part_name"
  >>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMirror: () => void;
}

function NumField({
  label, value, step = 0.01, onChange, disabled,
}: { label: string; value: number; step?: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value.toFixed(3) : "0"}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="h-7 text-xs"
      />
    </div>
  );
}

function VecRow({
  label, value, step, onChange, disabled,
}: { label: string; value: Vec3; step?: number; onChange: (v: Vec3) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField label="X" value={value.x} step={step} disabled={disabled}
          onChange={(x) => onChange({ ...value, x })} />
        <NumField label="Y" value={value.y} step={step} disabled={disabled}
          onChange={(y) => onChange({ ...value, y })} />
        <NumField label="Z" value={value.z} step={step} disabled={disabled}
          onChange={(z) => onChange({ ...value, z })} />
      </div>
    </div>
  );
}

export function PropertiesPanel({ part, onPatch, onDuplicate, onDelete, onMirror }: Props) {
  if (!part) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Properties
        </div>
        <p className="mt-2 max-w-[12rem] text-xs text-muted-foreground">
          Click a part in the viewport, or add one from the library.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Properties
        </div>
        <Input
          value={part.part_name ?? ""}
          onChange={(e) => onPatch({ part_name: e.target.value })}
          className="mt-1 h-7 text-sm"
          placeholder="Part name"
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <VecRow
          label="Position (m)"
          value={part.position}
          step={0.01}
          disabled={part.locked}
          onChange={(position) => onPatch({ position })}
        />
        <VecRow
          label="Rotation (rad)"
          value={part.rotation}
          step={0.05}
          disabled={part.locked}
          onChange={(rotation) => onPatch({ rotation })}
        />
        <VecRow
          label="Scale"
          value={part.scale}
          step={0.05}
          disabled={part.locked}
          onChange={(scale) => onPatch({ scale })}
        />

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs">
              <Lock className="h-3 w-3" /> Locked
            </Label>
            <Switch checked={part.locked} onCheckedChange={(locked) => onPatch({ locked })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs">
              <EyeOff className="h-3 w-3" /> Hidden
            </Label>
            <Switch checked={part.hidden} onCheckedChange={(hidden) => onPatch({ hidden })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs">
              <FlipHorizontal className="h-3 w-3" /> Mirrored
            </Label>
            <Switch checked={part.mirrored} onCheckedChange={(mirrored) => onPatch({ mirrored })} />
          </div>
        </div>
      </div>

      <div className="border-t border-border p-2">
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" variant="outline" onClick={onMirror} className="h-7 text-xs">
            <FlipHorizontal className="mr-1 h-3 w-3" /> Mirror
          </Button>
          <Button size="sm" variant="outline" onClick={onDuplicate} className="h-7 text-xs">
            <Copy className="mr-1 h-3 w-3" /> Dup
          </Button>
          <Button size="sm" variant="outline" onClick={onDelete} className="h-7 text-xs text-destructive hover:text-destructive">
            <Trash2 className="mr-1 h-3 w-3" /> Del
          </Button>
        </div>
      </div>
    </div>
  );
}
