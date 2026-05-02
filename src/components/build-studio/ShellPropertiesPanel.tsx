/**
 * ShellPropertiesPanel — right-rail properties for the active body-shell
 * overlay (Shell Fit). Body shells aren't `placed_parts`, so the standard
 * PropertiesPanel can't edit them — this panel exposes position / rotation /
 * uniform scale bound to the `shell_alignments` row, plus quick-restore for
 * swapped shells.
 *
 * Rendered when no placed part is selected but a shell skin IS active, so
 * the user always has somewhere to tweak the overlay precisely.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Layers, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { RotationEditor } from "@/components/build-studio/PropertiesPanel";
import type { ShellTransform } from "@/components/build-studio/BuildStudioViewport";
import type { BodySkin } from "@/lib/body-skins";
import type { Vec3 } from "@/lib/build-studio/placed-parts";

interface Props {
  /** Active body shell row (drives display name + restore-original action). */
  activeSkin: BodySkin | null;
  /** Current transform from `shell_alignments`. Null until row exists. */
  transform: ShellTransform | null;
  /** Persist a new transform to `shell_alignments`. */
  onCommit: (t: ShellTransform) => void;
  /** Switch the active overlay to another shell (used for Restore original). */
  onSelectSkin?: (id: string) => void;
}

const IDENTITY: ShellTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

export function ShellPropertiesPanel({
  activeSkin,
  transform,
  onCommit,
  onSelectSkin,
}: Props) {
  if (!activeSkin) return null;

  const t = transform ?? IDENTITY;
  const sourceId = (activeSkin as any).source_skin_id as string | null | undefined;

  const setPos = (axis: "x" | "y" | "z", v: number) =>
    onCommit({ ...t, position: { ...t.position, [axis]: v } as Vec3 });

  const setRotation = (rot: Vec3) => onCommit({ ...t, rotation: rot });

  // Uniform scale only — keeps proportions correct. Body shells should not
  // typically be stretched non-uniformly through this panel (use Shell Fit
  // "Stretch to wheelbase" if that's what you want).
  const uniformScale = (t.scale.x + t.scale.y + t.scale.z) / 3;
  const setUniformScale = (s: number) => {
    const safe = Math.max(0.01, s);
    onCommit({ ...t, scale: { x: safe, y: safe, z: safe } });
  };

  const reset = () => {
    onCommit(IDENTITY);
    toast.success("Shell transform reset");
  };

  const restoreOriginal = () => {
    if (!sourceId || !onSelectSkin) return;
    onSelectSkin(sourceId);
    toast.success("Restored original body shell");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <div className="min-w-0">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Body Shell
          </div>
          <div className="truncate text-sm font-medium">{activeSkin.name}</div>
        </div>
      </div>

      <Separator className="my-2" />

      {/* Position */}
      <div className="space-y-2 rounded-md border border-border/60 bg-surface-0/40 p-2">
        <div className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Position (m)
        </div>
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis} className="flex items-center gap-2">
            <Label className="w-4 text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {axis.toUpperCase()}
            </Label>
            <Input
              type="number"
              step={0.001}
              value={Number.isFinite(t.position[axis]) ? t.position[axis].toFixed(4) : "0"}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setPos(axis, n);
              }}
              className="h-7 flex-1 text-xs font-mono tabular-nums"
            />
            <span className="text-mono text-[10px] text-muted-foreground/60">m</span>
          </div>
        ))}
      </div>

      {/* Rotation */}
      <div className="mt-2">
        <RotationEditor value={t.rotation} onChange={setRotation} />
      </div>

      {/* Uniform Scale */}
      <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-surface-0/40 p-2">
        <div className="flex items-center justify-between">
          <div className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Uniform Scale
          </div>
          <div className="text-[10px] text-muted-foreground/70 font-mono tabular-nums">
            x{uniformScale.toFixed(3)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {[0.5, 0.9, 1, 1.1, 1.5, 2].map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant={Math.abs(uniformScale - s) < 0.001 ? "default" : "outline"}
              className="h-6 flex-1 px-1 text-[10px] font-mono"
              onClick={() => setUniformScale(s)}
              title={`Scale ×${s}`}
            >
              ×{s}
            </Button>
          ))}
        </div>
        <Input
          type="number"
          step={0.01}
          value={Number.isFinite(uniformScale) ? uniformScale.toFixed(4) : "1"}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setUniformScale(n);
          }}
          className="h-7 text-xs font-mono tabular-nums"
        />
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          Use Shell Fit → "Stretch to wheelbase" for non-uniform scaling.
        </p>
      </div>

      <Separator className="my-3" />

      <div className="flex flex-col gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-full justify-start text-xs text-muted-foreground"
          onClick={reset}
        >
          <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset transform
        </Button>
        {sourceId && onSelectSkin && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-full justify-start text-xs"
            onClick={restoreOriginal}
            title="Switch the active overlay back to the original (untrimmed) body shell"
          >
            <Undo2 className="mr-2 h-3.5 w-3.5" /> Restore original shell
          </Button>
        )}
      </div>
    </div>
  );
}
