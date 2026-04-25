/**
 * ShellFitPanel — popover-style controls for aligning a body skin overlay to
 * the donor car. Surfaces the auto-fit and Kabsch-solve actions implemented
 * in `lib/build-studio/shell-fit.ts`.
 *
 * Three actions:
 *   1. **Auto-fit to wheelbase** — detects shell wheel arches and snaps them
 *      onto the donor's `front_wheel_centre`/`rear_wheel_centre` hardpoints.
 *      No clicks required, works for ~80% of bodies.
 *   2. **Solve from locked points** — re-uses the pairs the user has clicked
 *      in Shell Fit Mode (≥2) and solves a similarity transform.
 *   3. **Stretch to wheelbase** toggle — when enabled, allows non-uniform
 *      X-axis scale so the user can match the wheelbase exactly without
 *      changing height/width. Saved to `shell_alignments.scale.x` only.
 *
 * The panel is dismissive — it lives in the viewport toolbar and only
 * appears when a shell skin is selected.
 */
import { useMemo, useState } from "react";
import * as THREE from "three";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Wand2, Move3d, Ruler, Scaling, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  autoFitToWheelbase,
  describeFitQuality,
  solveFromLockedHardpoints,
} from "@/lib/build-studio/shell-fit";
import type { CarHardpoint } from "@/lib/build-studio/hardpoints";
import type { LockedHardpointPair } from "@/lib/build-studio/shell-alignments";
import type { Vec3 } from "@/lib/build-studio/placed-parts";
import type { ShellTransform } from "@/components/build-studio/BuildStudioViewport";

interface Props {
  /** Currently loaded shell mesh (root Object3D in shell-local frame). */
  shellRoot: THREE.Object3D | null;
  /** All hardpoints defined on the donor car_template. */
  carHardpoints: CarHardpoint[];
  /** Pairs the user has manually locked via Shell Fit Mode. */
  lockedPairs: LockedHardpointPair[];
  /** Current transform values from `shell_alignments`. */
  currentTransform: ShellTransform | null;
  /** Persisted preference for non-uniform wheelbase stretch. */
  stretchEnabled: boolean;
  /** Disabled when no shell is loaded. */
  disabled?: boolean;
  /** Commit a new transform to `shell_alignments`. */
  onApplyTransform: (t: ShellTransform) => void;
  /** Update the stretch preference (non-uniform X scale allowed). */
  onStretchChange: (enabled: boolean) => void;
}

export function ShellFitPanel({
  shellRoot,
  carHardpoints,
  lockedPairs,
  currentTransform,
  stretchEnabled,
  disabled,
  onApplyTransform,
  onStretchChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [lastRms, setLastRms] = useState<number | null>(null);

  const hasFrontRear = useMemo(() => {
    const f = carHardpoints.some((h) => h.point_type === "front_wheel_centre");
    const r = carHardpoints.some((h) => h.point_type === "rear_wheel_centre");
    return f && r;
  }, [carHardpoints]);

  const lockedPairCount = lockedPairs.length;
  const canSolveFromLocked = lockedPairCount >= 2;

  const handleAutoFit = () => {
    if (!shellRoot) {
      toast.error("Shell mesh not ready");
      return;
    }
    if (!hasFrontRear) {
      toast.error(
        "Donor car needs front + rear wheel-centre hardpoints. Add them in Hardpoints admin first.",
      );
      return;
    }
    const result = autoFitToWheelbase(shellRoot, carHardpoints);
    if (!result) {
      toast.error(
        "Couldn't detect wheel arches on this shell. Try the manual hardpoint method instead.",
      );
      return;
    }
    const { transform } = result;
    setLastRms(transform.rms);
    onApplyTransform(toShellTransform(transform.position, transform.rotation, transform.scale, stretchEnabled, currentTransform));
    toast.success(`Snapped to wheelbase — fit ${describeFitQuality(transform.rms).toLowerCase()}`);
  };

  const handleSolveLocked = () => {
    if (!canSolveFromLocked) {
      toast.error("Lock at least 2 hardpoint pairs in Shell Fit Mode first.");
      return;
    }
    const t = solveFromLockedHardpoints(lockedPairs, carHardpoints);
    if (!t) {
      toast.error("Could not solve from locked points.");
      return;
    }
    setLastRms(t.rms);
    onApplyTransform(toShellTransform(t.position, t.rotation, t.scale, stretchEnabled, currentTransform));
    toast.success(`Solved from ${lockedPairCount} pairs — fit ${describeFitQuality(t.rms).toLowerCase()}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-9 px-3 text-xs"
          disabled={disabled || !shellRoot}
          title={shellRoot ? "Shell Fit tools" : "Load a shell skin first"}
        >
          <Wand2 className="mr-1.5 h-3.5 w-3.5 text-primary" /> Auto-fit
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-3">
        <div className="mb-2 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Shell Fit</h3>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
          Align the body skin overlay to the donor car. Auto-fit reads the
          shell's wheel arches; manual solve uses the hardpoint pairs you've
          clicked in Shell Fit Mode.
        </p>

        <div className="space-y-2">
          <Button
            onClick={handleAutoFit}
            disabled={!shellRoot || !hasFrontRear}
            size="sm"
            className="h-8 w-full justify-start text-xs"
          >
            <Ruler className="mr-2 h-3.5 w-3.5" /> Auto-fit to wheelbase
          </Button>
          {!hasFrontRear && (
            <p className="flex items-start gap-1.5 text-[10px] text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Donor car needs front + rear wheel-centre hardpoints
            </p>
          )}

          <Button
            onClick={handleSolveLocked}
            disabled={!canSolveFromLocked}
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start text-xs"
          >
            <Move3d className="mr-2 h-3.5 w-3.5" />
            Solve from locked points{" "}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {lockedPairCount}
            </span>
          </Button>
          {!canSolveFromLocked && (
            <p className="text-[10px] text-muted-foreground">
              Click ≥2 pairs (car hardpoint ↔ shell point) in Shell Fit Mode.
            </p>
          )}
        </div>

        <Separator className="my-3" />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-start gap-2">
            <Scaling className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <Label htmlFor="stretch-wb" className="cursor-pointer text-xs">
                Stretch to wheelbase
              </Label>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Allow non-uniform X scale (may distort fenders)
              </p>
            </div>
          </div>
          <Switch
            id="stretch-wb"
            checked={stretchEnabled}
            onCheckedChange={onStretchChange}
          />
        </div>

        {lastRms !== null && (
          <>
            <Separator className="my-3" />
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              <span className="text-muted-foreground">Last fit:</span>
              <span className="font-medium">{describeFitQuality(lastRms)}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {(lastRms * 1000).toFixed(0)} mm
              </span>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compose the final shell transform. When `stretch` is true we keep the
 * solver's uniform scale on Y/Z but allow X to be retained from the current
 * scale value (so the user can dial in the longitudinal stretch separately
 * via the gizmo). When stretch is false we use the solver's uniform scale
 * for all three axes — the wheelbase is corrected by translation+scale only.
 */
function toShellTransform(
  position: Vec3,
  rotation: Vec3,
  uniformScale: Vec3,
  stretch: boolean,
  current: ShellTransform | null,
): ShellTransform {
  const sX = stretch && current ? current.scale.x : uniformScale.x;
  return {
    position,
    rotation,
    scale: { x: sX, y: uniformScale.y, z: uniformScale.z },
  };
}
