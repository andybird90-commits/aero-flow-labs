/**
 * Build Studio status bar — slim 28px footer with the technical readout
 * (units, snap, triangle count, selection name, viewport tip).
 */
import type { PlacedPart } from "@/lib/build-studio/placed-parts";

interface Props {
  selected: PlacedPart | null;
  partsCount: number;
  triangleCount: number | null;
  snapEnabled: boolean;
  unitLabel?: string;
  fps?: number | null;
}

function formatTriangles(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground/60">{label}</span>
      <span className="text-foreground/85" style={{ color: "hsl(var(--studio-accent-glow))" }}>
        {value}
      </span>
    </div>
  );
}

export function BuildStudioStatusBar({
  selected,
  partsCount,
  triangleCount,
  snapEnabled,
  unitLabel = "m",
  fps = null,
}: Props) {
  return (
    <div
      className="studio-status flex h-[var(--studio-status-h)] items-center gap-5 px-4"
      style={{ height: "var(--studio-status-h)" }}
    >
      <Cell label="Units" value={unitLabel} />
      <span className="h-3 w-px bg-border/60" />
      <Cell label="Snap" value={snapEnabled ? "5cm · 15°" : "off"} />
      <span className="h-3 w-px bg-border/60" />
      <Cell label="Tris" value={formatTriangles(triangleCount)} />
      <span className="h-3 w-px bg-border/60" />
      <Cell label="Parts" value={partsCount.toString()} />
      {fps != null && (
        <>
          <span className="h-3 w-px bg-border/60" />
          <Cell label="FPS" value={fps.toFixed(0)} />
        </>
      )}
      <div className="ml-auto flex items-center gap-5">
        {selected ? (
          <Cell label="Selected" value={selected.part_name ?? "Part"} />
        ) : (
          <span className="text-[10px] text-muted-foreground/50">
            Click a part · drag to orbit · scroll to zoom
          </span>
        )}
      </div>
    </div>
  );
}
