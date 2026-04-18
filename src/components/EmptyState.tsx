import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1/40 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="absolute inset-0 grid-bg-fine opacity-30 rounded-xl pointer-events-none" />
      <div className="relative z-10 flex flex-col items-center">
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted-foreground">
            {icon}
          </div>
        )}
        <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
