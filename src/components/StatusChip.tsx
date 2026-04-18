import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border text-mono text-[10px] font-medium uppercase tracking-[0.12em] whitespace-nowrap",
  {
    variants: {
      tone: {
        // Run / job lifecycle
        preview:    "border-muted-foreground/25 bg-muted-foreground/5 text-muted-foreground",
        simulating: "border-primary/30 bg-primary/10 text-primary",
        solver:     "border-primary/40 bg-primary/[0.07] text-primary-glow",
        warning:    "border-warning/30 bg-warning/10 text-warning",
        failed:     "border-destructive/30 bg-destructive/10 text-destructive",
        success:    "border-success/30 bg-success/10 text-success",
        // Confidence
        low:        "border-warning/30 bg-warning/10 text-warning",
        medium:     "border-primary/25 bg-primary/[0.06] text-primary",
        high:       "border-success/30 bg-success/10 text-success",
        optimized:  "border-primary/40 bg-gradient-to-r from-primary/15 to-primary/5 text-primary",
        // Generic
        neutral:    "border-border bg-surface-2 text-muted-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[9px]",
        md: "px-2.5 py-0.5 text-[10px]",
        lg: "px-3 py-1 text-[11px]",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

const dotColor: Record<NonNullable<StatusChipProps["tone"]>, string> = {
  preview: "bg-muted-foreground/60",
  simulating: "bg-primary animate-pulse-soft",
  solver: "bg-primary-glow",
  warning: "bg-warning",
  failed: "bg-destructive",
  success: "bg-success",
  low: "bg-warning",
  medium: "bg-primary",
  high: "bg-success",
  optimized: "bg-primary",
  neutral: "bg-muted-foreground/60",
};

export interface StatusChipProps extends VariantProps<typeof chipVariants> {
  children: ReactNode;
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function StatusChip({ tone = "neutral", size, dot = true, icon, children, className }: StatusChipProps) {
  return (
    <span className={cn(chipVariants({ tone, size }), className)}>
      {icon}
      {!icon && dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor[tone ?? "neutral"])} />
      )}
      <span>{children}</span>
    </span>
  );
}
