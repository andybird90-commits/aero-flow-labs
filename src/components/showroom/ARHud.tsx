/**
 * ARHud — DOM overlay shown only while the AR session is active.
 *
 * Uses the WebXR `dom-overlay` feature so this element is composited on top
 * of the camera feed by the browser. Outside an XR session it just renders
 * normally (the Showroom hides it via `arActive` from the parent).
 */
import { Maximize2, MoveRight, Ruler, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { arStore, distance, useARAnchor } from "@/lib/showroom/ar-anchor";

interface ARHudProps {
  /** Approx natural car length in metres — used for the 1:1 helper button. */
  carLengthMeters: number;
  onExit: () => void;
}

export function ARHud({ carLengthMeters, onExit }: ARHudProps) {
  const ar = useARAnchor();
  if (ar.mode === "off") return null;

  const sizeM = carLengthMeters * ar.scale;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex flex-col">
      {/* Top bar — instructions + exit */}
      <div className="pointer-events-auto flex items-center justify-between gap-3 bg-gradient-to-b from-background/85 to-transparent px-4 py-3 text-foreground">
        <div className="text-xs font-medium">
          {ar.mode === "placing" && "Point at the floor and tap to place"}
          {ar.mode === "anchored" && !ar.measureMode && "Pinch to scale · Long-press to reposition"}
          {ar.mode === "anchored" && ar.measureMode && (
            ar.measurePoints.length === 0
              ? "Tap a point on the car to start measuring"
              : ar.measurePoints.length === 1
                ? "Tap a second point"
                : `${(distance(ar.measurePoints[0], ar.measurePoints[1]) * 100).toFixed(1)} cm`
          )}
        </div>
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 bg-background/80"
          onClick={onExit}
          aria-label="Exit AR"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1" />

      {/* Bottom bar — actions */}
      <div className="pointer-events-auto bg-gradient-to-t from-background/90 to-transparent px-4 pb-6 pt-4">
        {ar.mode === "anchored" && (
          <div className="mx-auto flex max-w-md flex-col gap-3 rounded-2xl border border-border bg-surface-1/95 p-3 shadow-2xl">
            {/* Scale row */}
            <div className="flex items-center gap-2 text-xs">
              <span className="w-12 text-muted-foreground">Scale</span>
              <Slider
                value={[ar.scale]}
                min={0.05}
                max={2}
                step={0.01}
                onValueChange={([v]) => arStore.setScale(v)}
                className="flex-1"
              />
              <span className="w-16 text-right tabular-nums text-foreground">
                {(ar.scale * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Approx car length: <span className="text-foreground tabular-nums">{sizeM.toFixed(2)} m</span></span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => arStore.setScale(1)}
              >
                <Maximize2 className="h-3 w-3" />
                1:1
              </Button>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                size="sm"
                variant={ar.measureMode ? "default" : "outline"}
                className="h-8 gap-1 text-xs"
                onClick={() => arStore.toggleMeasure()}
              >
                <Ruler className="h-3.5 w-3.5" />
                Measure
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => arStore.reposition()}
              >
                <MoveRight className="h-3.5 w-3.5" />
                Move
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => arStore.clearMeasure()}
                disabled={!ar.measureMode || ar.measurePoints.length === 0}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </div>
        )}
        {ar.mode === "placing" && (
          <div className="mx-auto max-w-md rounded-full border border-border bg-surface-1/95 px-4 py-2 text-center text-xs text-muted-foreground shadow-2xl">
            Move your phone slowly · A cyan ring will appear on the floor · Tap to place
          </div>
        )}
      </div>
    </div>
  );
}
