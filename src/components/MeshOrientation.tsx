/**
 * MeshOrientation — lets the user fix the rotation / axis of an uploaded mesh.
 *
 * STL files commonly come Z-up (CAD convention) instead of Y-up (three.js
 * convention), and may face the wrong way down the X axis. We expose:
 *   - a quick "Up axis" preset (Y-up / Z-up / X-up)
 *   - 90° yaw rotations + a fine yaw slider
 *   - a flip-forward toggle
 *
 * The orientation is stored under `geometry.metadata.mesh_orientation`
 * and applied by `<UserMesh>` in the 3D viewer.
 */
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useUpdateGeometry, type Geometry } from "@/lib/repo";
import { Compass, RotateCw, FlipHorizontal2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type UpAxis = "y" | "z" | "x";

export interface MeshOrientation {
  upAxis: UpAxis;
  yawDeg: number; // -180..180, applied around world Y after up-axis fix
  flipForward: boolean;
}

export const DEFAULT_ORIENTATION: MeshOrientation = {
  upAxis: "y",
  yawDeg: 0,
  flipForward: false,
};

export function readOrientation(geometry: Geometry | null | undefined): MeshOrientation {
  const raw = (geometry?.metadata as any)?.mesh_orientation;
  if (!raw || typeof raw !== "object") return DEFAULT_ORIENTATION;
  return {
    upAxis: raw.upAxis === "z" || raw.upAxis === "x" ? raw.upAxis : "y",
    yawDeg: typeof raw.yawDeg === "number" ? raw.yawDeg : 0,
    flipForward: !!raw.flipForward,
  };
}

interface Props {
  geometry: Geometry;
}

export function MeshOrientationControls({ geometry }: Props) {
  const update = useUpdateGeometry();
  const o = readOrientation(geometry);

  const patch = (next: Partial<MeshOrientation>) => {
    const merged: MeshOrientation = { ...o, ...next };
    update.mutate({
      id: geometry.id,
      patch: {
        metadata: {
          ...((geometry.metadata as object) ?? {}),
          mesh_orientation: merged,
        },
      },
    });
  };

  const nudgeYaw = (delta: number) => {
    let next = ((o.yawDeg + delta + 540) % 360) - 180;
    if (next === -180) next = 180;
    patch({ yawDeg: next });
  };

  if (!geometry.stl_path) return null;

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Mesh orientation</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => patch(DEFAULT_ORIENTATION)}
          className="h-7 text-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Reset
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Up axis */}
        <div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
            Up axis
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["y", "z", "x"] as UpAxis[]).map((axis) => (
              <button
                key={axis}
                type="button"
                onClick={() => patch({ upAxis: axis })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-mono text-[11px] uppercase tracking-widest transition-colors",
                  o.upAxis === axis
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                )}
              >
                {axis.toUpperCase()}-up
              </button>
            ))}
          </div>
          <p className="text-mono text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
            Most CAD exports are Z-up. Switch if your car appears on its side or nose.
          </p>
        </div>

        {/* Yaw */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Yaw
            </span>
            <span className="text-mono text-[11px] text-foreground tabular-nums">
              {o.yawDeg.toFixed(0)}°
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => nudgeYaw(-90)}
              className="h-8 px-2"
              title="Rotate −90°"
            >
              <RotateCw className="h-3.5 w-3.5 -scale-x-100" />
            </Button>
            <Slider
              value={[o.yawDeg]}
              min={-180}
              max={180}
              step={1}
              onValueChange={(v) => patch({ yawDeg: v[0] })}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => nudgeYaw(90)}
              className="h-8 px-2"
              title="Rotate +90°"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Flip forward */}
        <button
          type="button"
          onClick={() => patch({ flipForward: !o.flipForward })}
          className={cn(
            "w-full flex items-center justify-between rounded-md border px-3 py-2 transition-colors",
            o.flipForward
              ? "border-primary/60 bg-primary/[0.06] text-foreground"
              : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="flex items-center gap-2">
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            <span className="text-sm">Flip forward direction</span>
          </span>
          <span className="text-mono text-[10px] uppercase tracking-widest">
            {o.flipForward ? "On" : "Off"}
          </span>
        </button>
      </div>
    </div>
  );
}
