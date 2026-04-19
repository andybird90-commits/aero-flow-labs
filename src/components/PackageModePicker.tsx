import { cn } from "@/lib/utils";
import { PACKAGE_MODES, type PackageMode, getPackageMode } from "@/lib/aero-package-modes";

interface PackageModePickerProps {
  value: PackageMode;
  onChange: (mode: PackageMode) => void;
  className?: string;
  compact?: boolean;
}

export function PackageModePicker({ value, onChange, className, compact }: PackageModePickerProps) {
  if (compact) {
    return (
      <div className={cn("inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5", className)}>
        {PACKAGE_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors",
              value === m.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.short}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid gap-2 md:grid-cols-3", className)}>
      {PACKAGE_MODES.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              "relative overflow-hidden rounded-lg border p-3 text-left transition-all",
              active
                ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-surface-1 hover:border-primary/30",
            )}
          >
            {active && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />}
            <div className="flex items-center justify-between">
              <span className={cn("text-sm font-semibold", active ? "text-primary" : "text-foreground")}>
                {m.label}
              </span>
              <span className={cn("text-mono text-[9px] uppercase tracking-widest", m.accent)}>
                {Math.round(m.intensity * 100)}%
              </span>
            </div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
              {m.tagline}
            </div>
            <p className="text-[11px] text-muted-foreground/90 mt-2 leading-relaxed">{m.description}</p>
          </button>
        );
      })}
    </div>
  );
}

export { getPackageMode };
