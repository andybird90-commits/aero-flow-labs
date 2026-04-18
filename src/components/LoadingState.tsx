import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  variant?: "line" | "block" | "viewer";
}

export function Skeleton({ className, variant = "line" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-2",
        variant === "line" && "h-3",
        variant === "block" && "h-24",
        variant === "viewer" && "h-[420px] border border-border bg-surface-0",
        className,
      )}
    >
      <div
        className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-primary/10 to-transparent"
        style={{ backgroundSize: "200% 100%" }}
      />
    </div>
  );
}

interface LoadingStateProps {
  label?: string;
  sublabel?: string;
  variant?: "panel" | "viewer" | "inline";
  className?: string;
}

export function LoadingState({ label = "Loading", sublabel, variant = "panel", className }: LoadingStateProps) {
  if (variant === "inline") {
    return (
      <div className={cn("inline-flex items-center gap-2 text-mono text-[11px] text-muted-foreground", className)}>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        {label}
      </div>
    );
  }

  if (variant === "viewer") {
    return (
      <div className={cn("relative overflow-hidden rounded-lg border border-border bg-surface-0 min-h-[420px] grid-bg", className)}>
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_50%,hsl(188_95%_55%/0.08),transparent_70%)]" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="relative h-14 w-14">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
            <div className="absolute inset-3 rounded-full bg-primary/10 animate-pulse-soft" />
          </div>
          <div className="text-center">
            <div className="text-mono text-[11px] uppercase tracking-widest text-primary">{label}</div>
            {sublabel && <div className="text-mono text-[10px] text-muted-foreground mt-1">{sublabel}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("glass rounded-lg p-5 space-y-3", className)}>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="text-mono text-[11px] uppercase tracking-widest text-primary">{label}</span>
      </div>
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}
