import { cn } from "@/lib/utils";

export interface LegendItem {
  label: string;
  /** Tailwind text color class applied to the swatch dot, e.g. "text-primary" */
  color: string;
  value?: string;
  shape?: "dot" | "line" | "square";
}

interface LegendProps {
  items: LegendItem[];
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export function Legend({ items, orientation = "horizontal", className }: LegendProps) {
  return (
    <ul
      className={cn(
        "text-mono text-[10px] uppercase tracking-widest",
        orientation === "horizontal" ? "flex flex-wrap items-center gap-x-4 gap-y-2" : "flex flex-col gap-2",
        className,
      )}
    >
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-muted-foreground">
          <span className={cn("flex items-center justify-center", it.color)}>
            {(!it.shape || it.shape === "dot") && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {it.shape === "line" && <span className="h-px w-3 bg-current" />}
            {it.shape === "square" && <span className="h-2 w-2 rounded-sm bg-current" />}
          </span>
          <span className="text-foreground/80">{it.label}</span>
          {it.value && <span className="text-mono tabular-nums text-muted-foreground/80 ml-1">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Reusable horizontal color ramp legend (e.g. Cp, velocity). */
interface ColorRampProps {
  label: string;
  min: string;
  max: string;
  /** Tailwind gradient classes, e.g. "from-destructive via-warning to-primary" */
  gradient?: string;
  className?: string;
  ticks?: string[];
}

export function ColorRamp({
  label,
  min,
  max,
  gradient = "from-destructive via-warning to-primary",
  className,
  ticks,
}: ColorRampProps) {
  return (
    <div className={cn("rounded-md border border-border bg-surface-1 p-3", className)}>
      <div className="flex items-center justify-between text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground/70 tabular-nums">{min} → {max}</span>
      </div>
      <div className={cn("mt-2 h-2 rounded-full bg-gradient-to-r", gradient)} />
      {ticks && (
        <div className="mt-1 flex justify-between text-mono text-[10px] text-muted-foreground/70 tabular-nums">
          {ticks.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
    </div>
  );
}
