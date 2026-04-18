import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface ViewerPlaceholderProps {
  label?: string;
  badge?: string;
  overlay?: ReactNode;
  className?: string;
  variant?: "geometry" | "pressure" | "velocity" | "wake";
}

const viewerCopy: Record<string, { title: string; sub: string }> = {
  geometry: { title: "GEOMETRY VIEWPORT", sub: "Mesh · 1.84M cells · LOD adaptive" },
  pressure: { title: "PRESSURE FIELD", sub: "Cp range −2.1 to +1.0 · iso-surfaces" },
  velocity: { title: "VELOCITY STREAMLINES", sub: "U∞ 180 km/h · seeded planes ×6" },
  wake: { title: "WAKE STRUCTURE", sub: "Q-criterion 1500 · vorticity ω̄" },
};

export function ViewerPlaceholder({
  label,
  badge,
  overlay,
  className,
  variant = "geometry",
}: ViewerPlaceholderProps) {
  const copy = viewerCopy[variant];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-surface-0",
        "min-h-[420px]",
        className,
      )}
    >
      {/* Grid backdrop */}
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_50%,hsl(188_95%_55%/0.08),transparent_70%)]" />

      {/* Faux car silhouette */}
      <svg
        viewBox="0 0 800 300"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="carBody" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(220 80% 30%)" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="flow" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
            <stop offset="50%" stopColor="hsl(188 95% 55%)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Streamlines */}
        {variant !== "geometry" &&
          [...Array(14)].map((_, i) => (
            <path
              key={i}
              d={`M0,${60 + i * 15} C200,${50 + i * 14} 380,${120 + i * 10} 600,${90 + i * 12} S800,${110 + i * 11} 800,${110 + i * 11}`}
              stroke="url(#flow)"
              strokeWidth="1"
              fill="none"
              opacity={0.6 - i * 0.025}
            />
          ))}

        {/* Car silhouette */}
        <path
          d="M120,210 L180,170 L300,150 L420,140 L520,148 L600,170 L680,210 L120,210 Z"
          fill="url(#carBody)"
          stroke="hsl(188 95% 55%)"
          strokeWidth="1"
          opacity="0.85"
        />
        <path d="M250,150 L370,130 L470,135 L530,150 Z" fill="hsl(220 24% 12%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.7" />
        <circle cx="220" cy="215" r="22" fill="hsl(220 26% 8%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.6" />
        <circle cx="580" cy="215" r="22" fill="hsl(220 26% 8%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.6" />

        {/* Pressure dots */}
        {variant === "pressure" &&
          [...Array(40)].map((_, i) => (
            <circle
              key={i}
              cx={140 + (i % 10) * 55}
              cy={150 + Math.floor(i / 10) * 18}
              r="2"
              fill={`hsl(${i % 2 === 0 ? "188" : "0"} 95% ${50 + (i % 4) * 8}%)`}
              opacity="0.8"
            />
          ))}
      </svg>

      {/* Corner labels */}
      <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
        <div>
          <div className="text-mono text-[10px] tracking-widest text-primary/90">{copy.title}</div>
          <div className="text-mono text-[10px] text-muted-foreground mt-0.5">{copy.sub}</div>
        </div>
        {badge && (
          <span className="text-mono text-[10px] uppercase tracking-widest rounded border border-primary/30 bg-primary/5 px-2 py-0.5 text-primary">
            {badge}
          </span>
        )}
      </div>

      <div className="absolute bottom-3 left-3 flex items-center gap-3 text-mono text-[10px] text-muted-foreground">
        <span>X</span>
        <span>Y</span>
        <span>Z</span>
        <span className="text-primary">●</span>
        <span>FRAME 218 / 240</span>
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-2 text-mono text-[10px] text-muted-foreground">
        <span>U∞</span>
        <span className="text-foreground">180 km/h</span>
        <span className="mx-1">·</span>
        <span>ρ</span>
        <span className="text-foreground">1.225</span>
      </div>

      {label && (
        <div className="absolute inset-x-0 bottom-12 text-center text-xs text-muted-foreground/60">
          {label}
        </div>
      )}

      {overlay}
    </div>
  );
}
