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
import { Copy, Trash2, FlipHorizontal, Lock, EyeOff, Magnet, Sparkles, Wand2, Loader2, CheckCircle2, Move3d, RotateCcw, RotateCw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";
import * as THREE from "three";
import { useState } from "react";
import type { PlacedPart, Vec3 } from "@/lib/build-studio/placed-parts";
import {
  type SnapZone,
  SNAP_ZONE_LABELS,
  findMirrorZone,
} from "@/lib/build-studio/snap-zones";
import type { LibraryItem } from "@/lib/repo";
import { LiveFitPanel } from "@/components/build-studio/LiveFitPanel";
import { SculptStudioDialog } from "@/components/build-studio/SculptStudioDialog";
import { DeformDialog } from "@/components/build-studio/DeformDialog";
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

/**
 * Apply a world-space 90° rotation around `axis` to the part's current Euler.
 * We pre-multiply (worldQ * partQ) so the rotation is around the WORLD axis,
 * not the part's local axis. This means "yaw" always spins the part around
 * world-up regardless of how the part has been tilted or rolled.
 */
function rotate90Worldspace(rotation: Vec3, axis: "x" | "y" | "z", sign: 1 | -1): Vec3 {
  const current = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x, rotation.y, rotation.z, "XYZ"),
  );
  const axisV = axis === "x" ? new THREE.Vector3(1, 0, 0)
              : axis === "y" ? new THREE.Vector3(0, 1, 0)
              :                new THREE.Vector3(0, 0, 1);
  const step = new THREE.Quaternion().setFromAxisAngle(axisV, sign * Math.PI / 2);
  const next = step.multiply(current); // pre-multiply = world-space
  const e = new THREE.Euler().setFromQuaternion(next, "XYZ");
  return { x: e.x, y: e.y, z: e.z };
}

function RotButton({
  label, axis, sign, icon: Icon, rotation, disabled, onChange,
}: {
  label: string;
  axis: "x" | "y" | "z";
  sign: 1 | -1;
  icon: React.ComponentType<{ className?: string }>;
  rotation: Vec3;
  disabled?: boolean;
  onChange: (r: Vec3) => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled}
      title={label}
      onClick={() => onChange(rotate90Worldspace(rotation, axis, sign))}
      className="h-7 px-1 text-[10px]"
    >
      <Icon className="h-3 w-3" />
    </Button>
  );

export function PropertiesPanel({
  part, onPatch, onDuplicate, onDelete, onMirror,
  snapZones = [], onSnapToZone, onMirrorToZone,
  selectedLibraryItem = null, baseMeshUrl = null, userId = null,
  onLiveFitBaked, onSendForPrint,
}: Props) {
  const [sculptOpen, setSculptOpen] = useState(false);
  const [deformOpen, setDeformOpen] = useState(false);
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
                Sends this part + the donor car to the mesh worker. The part
                is reshaped to follow the car surface.
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Rotate 90°
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              disabled={part.locked}
              onClick={() => onPatch({ rotation: { x: 0, y: 0, z: 0 } })}
              title="Reset rotation"
            >
              Reset
            </Button>
          </div>
          {/* World-space 90° rotations. We pre-multiply a world-axis quaternion onto
              the part's current orientation so that "up" stays world-up no matter
              how the part has already been rolled. */}
          <div className="grid grid-cols-3 gap-1">
            <RotButton label="Tilt back"   axis="x" sign={-1} icon={ArrowUp}    rotation={part.rotation} disabled={part.locked} onChange={(r) => onPatch({ rotation: r })} />
            <RotButton label="Yaw left"    axis="y" sign={ 1} icon={ArrowLeft}  rotation={part.rotation} disabled={part.locked} onChange={(r) => onPatch({ rotation: r })} />
            <RotButton label="Roll left"   axis="z" sign={ 1} icon={RotateCcw}  rotation={part.rotation} disabled={part.locked} onChange={(r) => onPatch({ rotation: r })} />
            <RotButton label="Tilt fwd"    axis="x" sign={ 1} icon={ArrowDown}  rotation={part.rotation} disabled={part.locked} onChange={(r) => onPatch({ rotation: r })} />
            <RotButton label="Yaw right"   axis="y" sign={-1} icon={ArrowRight} rotation={part.rotation} disabled={part.locked} onChange={(r) => onPatch({ rotation: r })} />
            <RotButton label="Roll right"  axis="z" sign={-1} icon={RotateCw}   rotation={part.rotation} disabled={part.locked} onChange={(r) => onPatch({ rotation: r })} />
          </div>
        </div>

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

      <div className="space-y-1.5 border-t border-border p-2">
        {selectedLibraryItem?.asset_url && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDeformOpen(true)}
            className="h-7 w-full text-xs"
            title="Grab edges and deform this part to fit"
          >
            <Move3d className="mr-1 h-3 w-3 text-primary" /> Deform part
          </Button>
        )}
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

      {selectedLibraryItem && userId && (
        <DeformDialog
          open={deformOpen}
          onOpenChange={setDeformOpen}
          libraryItem={selectedLibraryItem}
          userId={userId}
          onSaved={() => {
            toast.success("Deformed part saved — find it in your library");
          }}
        />
      )}
    </div>
  );
}
