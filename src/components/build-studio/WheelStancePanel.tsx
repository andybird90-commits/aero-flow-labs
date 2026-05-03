/**
 * WheelStancePanel — controls for the wheel stance / track width preview tool.
 * Lives in the right rail when the wheelstance tool is active.
 */
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Trash2, CircleDot } from "lucide-react";
import * as THREE from "three";

interface Props {
  centres: THREE.Vector3[];
  onCentresChange: (c: THREE.Vector3[]) => void;
  trackOffset: number;
  onTrackOffsetChange: (v: number) => void;
}

const WHEEL_LABELS = ["FL", "FR", "RL", "RR"];

export function WheelStancePanel({
  centres,
  onCentresChange,
  trackOffset,
  onTrackOffsetChange,
}: Props) {
  const removeAt = (i: number) => {
    onCentresChange(centres.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-4 p-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <CircleDot className="h-3.5 w-3.5 text-primary" />
          Wheel Stance
        </h3>
        <p className="text-xs text-muted-foreground">
          Click on the car to place up to 4 wheel centre points, then adjust track width.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Wheel centres</Label>
            <Badge variant="secondary" className="text-[10px]">
              {centres.length} / 4
            </Badge>
          </div>

          {centres.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">
              Click on the car in the viewport to place wheel centres
            </p>
          )}

          {centres.map((c, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 rounded border border-border/60 bg-surface-1/50 px-2 py-1"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {WHEEL_LABELS[i] ?? i + 1}
                </Badge>
                <span className="text-[10px] font-mono text-muted-foreground truncate">
                  {c.x.toFixed(2)}, {c.y.toFixed(2)}, {c.z.toFixed(2)}
                </span>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => removeAt(i)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {centres.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={() => onCentresChange([])}
            >
              Clear all
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Track width offset</Label>
            <span className="text-[10px] font-mono text-muted-foreground">
              +{Math.round(trackOffset * 1000)} mm per side
            </span>
          </div>
          <Slider
            value={[trackOffset]}
            min={0}
            max={0.15}
            step={0.005}
            onValueChange={([v]) => onTrackOffsetChange(v)}
            disabled={centres.length === 0}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0 mm</span>
            <span>150 mm</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pushes overlay wheels outward so you can check arch clearance.
          </p>
        </div>
      </div>

      <div className="rounded border border-border/60 bg-surface-1/40 p-2">
        <p className="text-[10px] text-muted-foreground italic">
          This is a visual preview only — it does not modify the car mesh.
        </p>
      </div>
    </div>
  );
}
