/**
 * Annotation toolbar segment — drops into the Build Studio top toolbar
 * to expose Markup / Surface drawing modes plus pen color/width pickers.
 *
 * Visually styled as the warm-orange "AERO DESIGN" CTA cluster.
 */
import { useAnnotationStore } from "@/lib/build-studio/annotate/store";
import { Pencil, Brush, Eraser, MousePointer2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";

const SWATCHES = [
  "#fb923c",   // signature orange
  "#f43f5e",   // rose
  "#22d3ee",   // cyan
  "#a78bfa",   // violet
  "#fafafa",   // chalk white
  "#0a0a0a",   // graphite
];

export function AnnotationToolbar() {
  const mode = useAnnotationStore((s) => s.mode);
  const tool = useAnnotationStore((s) => s.tool);
  const color = useAnnotationStore((s) => s.color);
  const width = useAnnotationStore((s) => s.width);
  const setMode = useAnnotationStore((s) => s.setMode);
  const setTool = useAnnotationStore((s) => s.setTool);
  const setColor = useAnnotationStore((s) => s.setColor);
  const setWidth = useAnnotationStore((s) => s.setWidth);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        className="studio-pill"
        data-active={mode === "off"}
        onClick={() => setMode("off")}
        title="Select / transform parts"
      >
        <MousePointer2 className="h-3.5 w-3.5" />
        Select
      </button>

      <button
        type="button"
        className="studio-pill"
        data-active={mode === "screen"}
        onClick={() => setMode(mode === "screen" ? "off" : "screen")}
        title="Sketch on screen — pinned to camera angle"
      >
        <Pencil className="h-3.5 w-3.5" />
        Markup
      </button>

      <button
        type="button"
        className="studio-pill"
        data-active={mode === "surface"}
        onClick={() => setMode(mode === "surface" ? "off" : "surface")}
        title="Draw lines that stick to the car body"
      >
        <Brush className="h-3.5 w-3.5" />
        Surface
      </button>

      {mode !== "off" && (
        <>
          <span className="mx-1 h-5 w-px bg-border/60" />
          {/* Swatches */}
          <div className="flex items-center gap-1">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-5 w-5 rounded-full border transition"
                style={{
                  background: c,
                  borderColor:
                    color === c ? "hsl(var(--studio-accent-glow))" : "hsl(var(--studio-stroke))",
                  boxShadow:
                    color === c
                      ? "0 0 0 2px hsl(var(--studio-accent) / 0.45)"
                      : undefined,
                }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <span className="mx-1 h-5 w-px bg-border/60" />
          {/* Width */}
          <div className="flex items-center gap-2 px-1.5">
            <span className="text-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              W
            </span>
            <Slider
              value={[width]}
              min={1}
              max={12}
              step={1}
              onValueChange={(v) => setWidth(v[0])}
              className="w-20"
            />
            <span className="text-mono text-[10px] tabular-nums text-foreground/70">
              {width}
            </span>
          </div>
          <button
            type="button"
            className="studio-pill"
            data-active={tool === "eraser"}
            onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}
            title="Eraser (whole strokes)"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
