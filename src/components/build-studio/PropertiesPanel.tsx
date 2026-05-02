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
import { Copy, Trash2, FlipHorizontal, Lock, EyeOff, Magnet, Sparkles, Wand2, Loader2, CheckCircle2, RotateCcw, Crosshair } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";
import {
  type SnapZone,
  SNAP_ZONE_LABELS,
  findMirrorZone,
} from "@/lib/build-studio/snap-zones";
import type { LibraryItem } from "@/lib/repo";
import { LiveFitPanel } from "@/components/build-studio/LiveFitPanel";
import { SculptStudioDialog } from "@/components/build-studio/SculptStudioDialog";
import { useAutofitPlacedPart, type AutofitPartKind } from "@/lib/build-studio/autofit";
import { toast } from "sonner";

const AUTOFIT_KINDS: AutofitPartKind[] = ["wing", "bumper", "spoiler", "lip", "skirt", "diffuser"];

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
  /** Resolved library item for the selected part (for Live Fit asset URL). */
  selectedLibraryItem?: LibraryItem | null;
  /** Signed URL for the project's base car STL/GLB (enables Live Fit). */
  baseMeshUrl?: string | null;
  /** Owner of the project, used when uploading baked Live Fit STLs. */
  userId?: string | null;
  /** Called after Live Fit Bake succeeds — parent invalidates library cache. */
  onLiveFitBaked?: (newAssetUrl: string, newLibraryItemId: string) => void;
  /** Optional handler for the "Print-ready" CTA inside Live Fit. */
  onSendForPrint?: (snappedStlBlob: Blob) => void;
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

/* ─── Rotation editor ───
 * Displays + edits rotation in degrees (most users think in degrees, not
 * radians). Includes:
 *   • Per-axis nudges: ±1°, ±5°, ±90°
 *   • Quick presets: 0°, 90°, 180°, -90°
 *   • "Snap all to nearest 90°" — kills off the tiny misalignments left
 *     behind by drag-rotating with the gizmo.
 * The persisted value stays in radians so nothing else has to change.
 */
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const SNAP_DEG_PRESETS = [0, 45, 90, 135, 180, -135, -90, -45];

function snapTo(deg: number, step: number): number {
  return Math.round(deg / step) * step;
}

function RotationAxisRow({
  axis, valueRad, disabled, onChange,
}: {
  axis: "x" | "y" | "z";
  valueRad: number;
  disabled?: boolean;
  onChange: (newRad: number) => void;
}) {
  const deg = valueRad * DEG;
  // Normalise display to (-180, 180] so values stay readable after many nudges.
  const normalisedDeg = (((deg + 180) % 360) + 360) % 360 - 180;

  const setDeg = (d: number) => onChange(d * RAD);
  const nudge = (d: number) => setDeg(normalisedDeg + d);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {axis.toUpperCase()}
        </Label>
        <div className="flex items-center gap-0.5">
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-5 px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => nudge(-90)} title="−90°"
          >−90</Button>
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-5 px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => nudge(-5)} title="−5°"
          >−5</Button>
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-5 px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => nudge(-1)} title="−1°"
          >−1</Button>
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-5 px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => nudge(1)} title="+1°"
          >+1</Button>
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-5 px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => nudge(5)} title="+5°"
          >+5</Button>
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-5 px-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => nudge(90)} title="+90°"
          >+90</Button>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step={0.1}
          value={Number.isFinite(deg) ? deg.toFixed(2) : "0"}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setDeg(n);
          }}
          onBlur={(e) => {
            // On blur, snap to nearest 0.01° to clean up gizmo-drift residue.
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setDeg(Math.round(n * 100) / 100);
          }}
          className="h-7 flex-1 text-xs font-mono tabular-nums"
        />
        <span className="text-mono text-[10px] text-muted-foreground/60">°</span>
        <div className="flex items-center gap-0.5">
          {SNAP_DEG_PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={Math.abs(normalisedDeg - p) < 0.01 ? "default" : "outline"}
              disabled={disabled}
              className="h-6 w-7 px-0 text-[9px] font-mono tabular-nums"
              onClick={() => setDeg(p)}
              title={`Set to ${p}°`}
            >
              {p}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RotationEditor({
  value, disabled, onChange,
}: {
  value: Vec3;
  disabled?: boolean;
  onChange: (v: Vec3) => void;
}) {
  const snapAllTo90 = () => {
    onChange({
      x: snapTo(value.x * DEG, 90) * RAD,
      y: snapTo(value.y * DEG, 90) * RAD,
      z: snapTo(value.z * DEG, 90) * RAD,
    });
  };
  const snapAllTo45 = () => {
    onChange({
      x: snapTo(value.x * DEG, 45) * RAD,
      y: snapTo(value.y * DEG, 45) * RAD,
      z: snapTo(value.z * DEG, 45) * RAD,
    });
  };
  const snapAllTo1 = () => {
    onChange({
      x: snapTo(value.x * DEG, 1) * RAD,
      y: snapTo(value.y * DEG, 1) * RAD,
      z: snapTo(value.z * DEG, 1) * RAD,
    });
  };
  const reset = () => onChange({ x: 0, y: 0, z: 0 });

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-surface-0/40 p-2">
      <div className="flex items-center justify-between">
        <div className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Rotation (°)
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button" size="sm" variant="outline" disabled={disabled}
            className="h-6 px-1.5 text-[10px]"
            onClick={snapAllTo1}
            title="Round all axes to nearest 1°"
          >
            <Crosshair className="mr-0.5 h-2.5 w-2.5" />1°
          </Button>
          <Button
            type="button" size="sm" variant="outline" disabled={disabled}
            className="h-6 px-1.5 text-[10px]"
            onClick={snapAllTo45}
            title="Snap all axes to nearest 45°"
          >
            45°
          </Button>
          <Button
            type="button" size="sm" variant="outline" disabled={disabled}
            className="h-6 px-1.5 text-[10px]"
            onClick={snapAllTo90}
            title="Snap all axes to nearest 90° — kills tiny misalignments"
          >
            90°
          </Button>
          <Button
            type="button" size="sm" variant="ghost" disabled={disabled}
            className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={reset}
            title="Reset to 0,0,0"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <RotationAxisRow axis="x" valueRad={value.x} disabled={disabled}
        onChange={(x) => onChange({ ...value, x })} />
      <RotationAxisRow axis="y" valueRad={value.y} disabled={disabled}
        onChange={(y) => onChange({ ...value, y })} />
      <RotationAxisRow axis="z" valueRad={value.z} disabled={disabled}
        onChange={(z) => onChange({ ...value, z })} />
    </div>
  );
}

export function PropertiesPanel({
  part, onPatch, onDuplicate, onDelete, onMirror,
  snapZones = [], onSnapToZone, onMirrorToZone,
  selectedLibraryItem = null, baseMeshUrl = null, userId = null,
  onLiveFitBaked, onSendForPrint,
}: Props) {
  const [sculptOpen, setSculptOpen] = useState(false);
  const autofitMeta = (part?.metadata ?? {}) as Record<string, unknown>;
  const initialKind = (autofitMeta.autofit_part_kind as AutofitPartKind | undefined)
    ?? (selectedLibraryItem?.metadata as any)?.part_kind
    ?? "wing";
  const [autofitKind, setAutofitKind] = useState<AutofitPartKind>(
    AUTOFIT_KINDS.includes(initialKind as AutofitPartKind) ? (initialKind as AutofitPartKind) : "wing"
  );
  const autofit = useAutofitPlacedPart();
  const hasAutofit = !!(autofitMeta.autofit_glb_url as string | undefined);

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

        {/* Live Fit — in-app body conform + CSG trim. Only shown when we have
            a part asset and a base car mesh. */}
        {selectedLibraryItem?.asset_url && baseMeshUrl && (
          <>
            <LiveFitPanel
              part={part}
              libraryItem={selectedLibraryItem}
              baseMeshUrl={baseMeshUrl}
              userId={userId}
              onBaked={(url, id) => onLiveFitBaked?.(url, id)}
              onSendForPrint={onSendForPrint}
            />
            <Separator />
          </>
        )}

        {/* Autofit — sends the part GLB + donor car GLB to the mesh worker,
            which deforms the part to follow the car surface. The fitted GLB
            is stored on placed_parts.metadata.autofit_glb_url and rendered
            in place of the library asset. */}
        {selectedLibraryItem?.asset_url && (
          <>
            <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Wand2 className="h-3 w-3 text-primary" /> Autofit to car
                </Label>
                {hasAutofit && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <CheckCircle2 className="h-3 w-3" /> Fitted
                  </Badge>
                )}
              </div>
              <Select value={autofitKind} onValueChange={(v) => setAutofitKind(v as AutofitPartKind)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTOFIT_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="text-xs capitalize">{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="default"
                className="h-7 w-full text-xs"
                disabled={autofit.isPending}
                onClick={async () => {
                  if (!selectedLibraryItem?.asset_url) {
                    toast.error("Part has no GLB asset to fit.");
                    return;
                  }
                  if (!baseMeshUrl) {
                    toast.error("Donor car GLB not available.");
                    return;
                  }
                  try {
                    await autofit.mutateAsync({
                      placed_part_id: part.id,
                      project_id: part.project_id,
                      part_kind: autofitKind,
                      car_url: baseMeshUrl,
                      part_url: selectedLibraryItem.asset_url,
                      part,
                    });
                    toast.success("Part fitted to car");
                  } catch (e) {
                    toast.error((e as Error).message ?? "Autofit failed");
                  }
                }}
              >
                {autofit.isPending ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Fitting…</>
                ) : (
                  <><Wand2 className="mr-1 h-3 w-3" /> {hasAutofit ? "Re-fit to car" : "Autofit to car"}</>
                )}
              </Button>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Trims the part flush against the car body using boolean subtraction.
              </p>
            </div>
            <Separator />
          </>
        )}

        <VecRow
          label="Position (m)"
          value={part.position}
          step={0.01}
          disabled={part.locked}
          onChange={(position) => onPatch({ position })}
        />
        <RotationEditor
          value={part.rotation}
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

      <div className="space-y-1.5 border-t border-border p-2">
        {selectedLibraryItem?.asset_url && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSculptOpen(true)}
            className="h-7 w-full text-xs"
            title="Push, pull and smooth this part's geometry"
          >
            <Sparkles className="mr-1 h-3 w-3 text-primary" /> Sculpt mesh
          </Button>
        )}
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

      {selectedLibraryItem && (
        <SculptStudioDialog
          item={selectedLibraryItem}
          open={sculptOpen}
          onOpenChange={setSculptOpen}
        />
      )}
    </div>
  );
}
