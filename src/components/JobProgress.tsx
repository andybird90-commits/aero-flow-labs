import { cn } from "@/lib/utils";
import { StatusChip } from "./StatusChip";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";

export type JobState = "queued" | "running" | "converged" | "failed";

interface JobProgressProps {
  state: JobState;
  label?: string;
  iteration?: number;
  totalIterations?: number;
  eta?: string;
  residual?: string;
  className?: string;
}

export function JobProgress({
  state,
  label = "Run",
  iteration = 0,
  totalIterations = 2400,
  eta,
  residual,
  className,
}: JobProgressProps) {
  const pct = Math.min(100, Math.round((iteration / totalIterations) * 100));
  const isRunning = state === "running";

  const meta = {
    queued:    { tone: "preview"    as const, Icon: Clock,        text: "Queued" },
    running:   { tone: "simulating" as const, Icon: Loader2,      text: "Simulating" },
    converged: { tone: "success"    as const, Icon: CheckCircle2, text: "Converged" },
    failed:    { tone: "failed"     as const, Icon: XCircle,      text: "Failed" },
  }[state];

  return (
    <div className={cn("glass relative overflow-hidden rounded-lg p-4", className)}>
      {isRunning && <div className="absolute inset-x-0 top-0 h-px stat-line" />}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <meta.Icon className={cn("h-4 w-4", isRunning && "animate-spin text-primary",
            state === "converged" && "text-success",
            state === "failed" && "text-destructive",
            state === "queued" && "text-muted-foreground")} />
          <div>
            <div className="text-sm font-medium">{label}</div>
            {residual && <div className="text-mono text-[10px] text-muted-foreground">{residual}</div>}
          </div>
        </div>
        <StatusChip tone={meta.tone}>{meta.text}</StatusChip>
      </div>

      <div className="mt-3 relative h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            state === "failed" ? "bg-destructive/70" : "bg-gradient-primary",
          )}
          style={{ width: `${state === "failed" ? 100 : pct}%` }}
        />
        {isRunning && (
          <div
            className="absolute inset-y-0 w-1/3 -translate-x-full bg-gradient-to-r from-transparent via-primary-glow/40 to-transparent animate-shimmer"
            style={{ backgroundSize: "200% 100%" }}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-mono text-[10px] text-muted-foreground tabular-nums">
        <span>iter {iteration.toLocaleString()} / {totalIterations.toLocaleString()}</span>
        <span>{pct}%</span>
        {eta && <span>ETA {eta}</span>}
      </div>
    </div>
  );
}
