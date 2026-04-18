import { cn } from "@/lib/utils";

interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  step?: number;
  onChange?: (v: number) => void;
  hint?: string;
  className?: string;
}

export function ParamSlider({
  label,
  value,
  min,
  max,
  unit,
  step = 1,
  onChange,
  hint,
  className,
}: ParamSliderProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        <div className="flex items-center gap-1.5">
          <span className="text-mono text-sm tabular-nums text-foreground">{value}</span>
          {unit && <span className="text-mono text-[10px] text-muted-foreground">{unit}</span>}
        </div>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-primary"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border border-primary bg-background shadow-glow"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="flex justify-between text-mono text-[10px] text-muted-foreground/60">
        <span>{min}{unit}</span>
        {hint && <span>{hint}</span>}
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}
