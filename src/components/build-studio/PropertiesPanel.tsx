/**
 * Right rail — selected part properties (name, transform, flags, actions).
 * Phase 4 add-on: snap-zone badge, picker, and mirror-to-opposite-zone.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Copy, Trash2, FlipHorizontal, Lock, EyeOff, Magnet } from "lucide-react";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";
import {
  type SnapZone,
  SNAP_ZONE_LABELS,
  findMirrorZone,
} from "@/lib/build-studio/snap-zones";

interface Props {
  part: PlacedPart | null;
  onPatch: (patch: Partial<Pick<PlacedPart,
    "position" | "rotation" | "scale" | "locked" | "hidden" | "mirrored" | "part_name"
  >>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMirror: () => void;
  /** Snap zones available for the project's car template. */
  snapZones?: SnapZone[];
  /** Snap the part to a zone (or unsnap when zoneId is null). */
  onSnapToZone?: (zoneId: string | null) => void;
  /** Mirror the part to the opposite-side snap zone (creates a duplicate). */
  onMirrorToZone?: (zone: SnapZone) => void;
}

const NONE = "__none__";

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

export function PropertiesPanel({
  part, onPatch, onDuplicate, onDelete, onMirror,
  snapZones = [], onSnapToZone, onMirrorToZone,
}: Props) {
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

  const currentZone = part.snap_zone_id
    ? snapZones.find((z) => z.id === part.snap_zone_id) ?? null
    : null;
  const mirrorZone = currentZone ? findMirrorZone(currentZone, snapZones) : null;

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
        {/* Snap zone */}
        {snapZones.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs">
                <Magnet className="h-3 w-3" /> Snap zone
              </Label>
              {currentZone ? (
                <Badge variant="secondary" className="text-[10px]">
                  {currentZone.label || SNAP_ZONE_LABELS[currentZone.zone_type]}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">Free</Badge>
              )}
            </div>
            <Select
              value={part.snap_zone_id ?? NONE}
              onValueChange={(v) => onSnapToZone?.(v === NONE ? null : v)}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Snap to zone…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Free (no zone)</SelectItem>
                {snapZones.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.label || SNAP_ZONE_LABELS[z.zone_type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mirrorZone && onMirrorToZone && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-full text-xs"
                onClick={() => onMirrorToZone(mirrorZone)}
              >
                <FlipHorizontal className="mr-1 h-3 w-3" />
                Mirror to {mirrorZone.label || SNAP_ZONE_LABELS[mirrorZone.zone_type]}
              </Button>
            )}
          </div>
        )}

        {snapZones.length > 0 && <Separator />}

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
            <FlipHorizontal className="mr-1 h-3 w-3" /> Flip
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
