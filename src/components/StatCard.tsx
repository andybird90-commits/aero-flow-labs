import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; good?: "up" | "down" };
  hint?: string;
  accent?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, unit, delta, hint, accent, icon, className }: StatCardProps) {
  const goodDir = delta?.good ?? "up";
  const isGood = delta && delta.direction === goodDir;
  const isBad = delta && delta.direction !== "flat" && delta.direction !== goodDir;

  return (
    <div
      className={cn(
        "glass relative overflow-hidden rounded-lg p-4 transition-all hover:border-primary/30",
        accent && "ring-1 ring-primary/30",
        className,
      )}
    >
      {accent && <div className="absolute inset-x-0 top-0 h-px stat-line" />}
      <div className="flex items-start justify-between">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {icon && <div className="text-muted-foreground/70">{icon}</div>}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className={cn("text-3xl font-semibold tabular-nums tracking-tight", accent && "text-primary")}>
          {value}
        </span>
        {unit && <span className="text-mono text-xs text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        {delta ? (
          <span
            className={cn(
              "text-mono inline-flex items-center gap-1",
              isGood && "text-success",
              isBad && "text-destructive",
              delta.direction === "flat" && "text-muted-foreground",
            )}
          >
            {delta.direction === "up" && <TrendingUp className="h-3 w-3" />}
            {delta.direction === "down" && <TrendingDown className="h-3 w-3" />}
            {delta.direction === "flat" && <Minus className="h-3 w-3" />}
            {delta.value}
          </span>
        ) : (
          <span />
        )}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
