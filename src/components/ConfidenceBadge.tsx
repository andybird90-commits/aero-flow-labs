import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";

type Level = "low" | "medium" | "high";

const config: Record<Level, { label: string; tone: string; icon: typeof Shield; bars: number }> = {
  low:    { label: "Low confidence",    tone: "border-warning/30 bg-warning/10 text-warning",      icon: ShieldAlert, bars: 1 },
  medium: { label: "Medium confidence", tone: "border-primary/25 bg-primary/10 text-primary",      icon: Shield,      bars: 2 },
  high:   { label: "High confidence",   tone: "border-success/30 bg-success/10 text-success",      icon: ShieldCheck, bars: 3 },
};

interface ConfidenceBadgeProps {
  level: Level;
  label?: string;
  detail?: string;
  className?: string;
  compact?: boolean;
}

export function ConfidenceBadge({ level, label, detail, compact, className }: ConfidenceBadgeProps) {
  const c = config[level];
  const Icon = c.icon;

  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-mono text-[10px] uppercase tracking-widest", c.tone, className)}>
        <Icon className="h-3 w-3" />
        {label ?? c.label}
      </span>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-3 rounded-md border bg-surface-1/60 px-3 py-2", c.tone, className)}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="leading-tight">
        <div className="text-mono text-[10px] uppercase tracking-widest">{label ?? c.label}</div>
        {detail && <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>}
      </div>
      <div className="ml-2 flex items-end gap-0.5">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "w-1 rounded-sm",
              i <= c.bars ? "bg-current" : "bg-current/20",
              i === 1 && "h-2",
              i === 2 && "h-3",
              i === 3 && "h-4",
            )}
          />
        ))}
      </div>
    </div>
  );
}
