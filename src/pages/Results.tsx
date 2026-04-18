import { Link } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ColorRamp, Legend } from "@/components/Legend";
import { ParamSlider } from "@/components/ParamSlider";
import {
  ChevronRight, ChevronLeft, ArrowRight, Download, FileDown, Copy,
  GitCompareArrows, Wind, Gauge, Layers, Activity, Eye, EyeOff, Grid3x3,
  Maximize2, RotateCcw, Settings2, Camera, Share2, Sparkles, Target,
  TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, Info,
  CheckCircle2, AlertTriangle, ShieldCheck, Wrench, Crosshair, Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────── */
/*  Variants                                                           */
/* ─────────────────────────────────────────────────────────────────── */
type VariantId = "baseline" | "current" | "optimized";

interface VariantData {
  id: VariantId;
  name: string;
  sub: string;
  cd: number;
  drag: number;     // kgf @ 200 km/h
  dfFront: number;  // kgf
  dfRear: number;
  dfTotal: number;
  ld: number;
  balance: number;  // % front
  topSpeed: number; // km/h
}

const VARIANTS: Record<VariantId, VariantData> = {
  baseline: {
    id: "baseline", name: "Baseline OEM", sub: "ZN8 · stock",
    cd: 0.366, drag: 116, dfFront: 12, dfRear: -34, dfTotal: -22,
    ld: -0.19, balance: 100, topSpeed: 226,
  },
  current: {
    id: "current", name: "Optimized v3 · current", sub: "Track package",
    cd: 0.342, drag: 112, dfFront: 121, dfRear: 163, dfTotal: 284,
    ld: 2.54, balance: 42.6, topSpeed: 218,
  },
  optimized: {
    id: "optimized", name: "Optimized v4 · suggested", sub: "Adjoint sweep · best L/D",
    cd: 0.328, drag: 108, dfFront: 138, dfRear: 178, dfTotal: 316,
    ld: 2.93, balance: 43.7, topSpeed: 222,
  },
};

const RUN = {
  id: "RUN-2186",
  car: "Toyota GR86 (ZN8)",
  variant: "Optimized Package v3",
  speed: "200 km/h",
  yaw: "0°",
  density: "1.225 kg/m³",
  iterations: "2,400",
  walltime: "18 m 04 s",
  solver: "OpenFOAM 11 · k-ω SST",
  residual: "8.2e-5",
};

/* ─────────────────────────────────────────────────────────────────── */
/*  Display modes                                                      */
/* ─────────────────────────────────────────────────────────────────── */
type Mode = "streamlines" | "pressure" | "velocity" | "wake" | "forces";

const MODES: { id: Mode; label: string; icon: typeof Wind; sub: string }[] = [
  { id: "streamlines", label: "Streamlines", icon: Wind,     sub: "Flow paths" },
  { id: "pressure",    label: "Pressure",    icon: Activity, sub: "Cp surface" },
  { id: "velocity",    label: "Velocity",    icon: Gauge,    sub: "|U| field" },
  { id: "wake",        label: "Wake",        icon: Layers,   sub: "Iso-surface λ₂" },
  { id: "forces",      label: "Forces",      icon: Target,   sub: "Pressure × area" },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Delta helper                                                       */
/* ─────────────────────────────────────────────────────────────────── */
function fmtDelta(value: number, opts?: { invert?: boolean; pct?: boolean; suffix?: string; decimals?: number }) {
  const decimals = opts?.decimals ?? 1;
  const prefix = value > 0 ? "+" : value < 0 ? "" : "";
  const v = opts?.pct ? `${prefix}${value.toFixed(decimals)}%` : `${prefix}${value.toFixed(decimals)}${opts?.suffix ?? ""}`;
  // Better = green; for invert (e.g. drag, Cd), lower is better
  const better = opts?.invert ? value < 0 : value > 0;
  const tone = value === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Icon = value === 0 ? Minus : better ? (opts?.invert ? TrendingDown : TrendingUp) : (opts?.invert ? TrendingUp : TrendingDown);
  return { v, tone, Icon };
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Variant pill switcher                                              */
/* ─────────────────────────────────────────────────────────────────── */
function VariantSwitcher({ value, onChange }: { value: VariantId; onChange: (v: VariantId) => void }) {
  const items: { id: VariantId; label: string; tone: string }[] = [
    { id: "baseline",  label: "Baseline",  tone: "text-muted-foreground" },
    { id: "current",   label: "Current",   tone: "text-primary" },
    { id: "optimized", label: "Optimized", tone: "text-success" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={cn(
            "rounded px-3 py-1.5 text-mono text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1.5",
            value === it.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full",
            it.id === "baseline" ? "bg-muted-foreground" :
            it.id === "current" ? "bg-primary" : "bg-success",
          )} />
          {it.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Main viewer                                                        */
/* ─────────────────────────────────────────────────────────────────── */
function ResultViewer({
  mode, variant, settings,
}: {
  mode: Mode; variant: VariantId;
  settings: { density: number; intensity: number; clip: boolean; labels: boolean };
}) {
  const tint = variant === "baseline" ? "0.5" : variant === "current" ? "0.8" : "1.0";

  return (
    <div className="relative h-full">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_55%,hsl(188_95%_55%/0.08),transparent_70%)]" />

      <svg viewBox="0 0 1000 560" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Pressure: red→yellow→green→cyan→blue */}
          <linearGradient id="cpGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"   stopColor="hsl(0 80% 60%)" />
            <stop offset="25%"  stopColor="hsl(38 95% 58%)" />
            <stop offset="50%"  stopColor="hsl(150 70% 50%)" />
            <stop offset="75%"  stopColor="hsl(188 95% 55%)" />
            <stop offset="100%" stopColor="hsl(220 90% 60%)" />
          </linearGradient>
          {/* Pressure body fill — pretend it samples Cp on body */}
          <linearGradient id="pBody" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"  stopColor="hsl(0 80% 60%)"   stopOpacity="0.7" />
            <stop offset="20%" stopColor="hsl(38 95% 58%)"  stopOpacity="0.5" />
            <stop offset="50%" stopColor="hsl(150 70% 50%)" stopOpacity="0.35" />
            <stop offset="85%" stopColor="hsl(188 95% 55%)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="hsl(220 90% 60%)" stopOpacity="0.6" />
          </linearGradient>
          {/* Velocity: dark→cyan→white */}
          <linearGradient id="vGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"   stopColor="hsl(220 60% 18%)" />
            <stop offset="40%"  stopColor="hsl(188 95% 45%)" />
            <stop offset="80%"  stopColor="hsl(188 95% 70%)" />
            <stop offset="100%" stopColor="hsl(0 0% 100%)" />
          </linearGradient>
          {/* Streamline stroke gradient */}
          <linearGradient id="streamGrad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%"   stopColor="hsl(188 95% 55%)" stopOpacity="0" />
            <stop offset="40%"  stopColor="hsl(188 95% 55%)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="hsl(38 95% 58%)"  stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="bodyOutline" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"   stopColor="hsl(188 95% 55%)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Ground line */}
        <line x1="40" y1="420" x2="960" y2="420" stroke="hsl(188 95% 55%)" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.4" />

        {/* ── PRESSURE / VELOCITY field plumes ── */}
        {mode === "velocity" && (
          <g opacity="0.85">
            <path d="M40,260 Q260,250 500,255 T960,250 L960,420 L40,420 Z" fill="url(#vGrad)" opacity={Number(tint) * 0.45} />
            {Array.from({ length: 16 }).map((_, i) => (
              <line key={i} x1={40 + i * 60} y1="200" x2={40 + i * 60} y2="420"
                stroke="hsl(188 95% 55%)" strokeWidth="0.2" opacity="0.15" />
            ))}
          </g>
        )}

        {/* ── PRESSURE contour rings around body ── */}
        {mode === "pressure" && (
          <g opacity={settings.intensity / 100}>
            {/* stagnation high pressure at front */}
            <ellipse cx="200" cy="380" rx="80" ry="40" fill="hsl(0 80% 60%)" opacity="0.25" />
            <ellipse cx="200" cy="380" rx="55" ry="28" fill="hsl(0 80% 60%)" opacity="0.35" />
            {/* roof low pressure */}
            <ellipse cx="500" cy="270" rx="120" ry="35" fill="hsl(220 90% 60%)" opacity="0.25" />
            <ellipse cx="500" cy="275" rx="80" ry="22" fill="hsl(220 90% 60%)" opacity="0.4" />
            {/* wing suction */}
            <ellipse cx="820" cy="260" rx="55" ry="18" fill="hsl(188 95% 55%)" opacity="0.4" />
            {/* under-floor */}
            <ellipse cx="500" cy="425" rx="200" ry="14" fill="hsl(188 95% 55%)" opacity="0.3" />
          </g>
        )}

        {/* ── WAKE iso-surface ── */}
        {mode === "wake" && (
          <g opacity={settings.intensity / 100}>
            {/* Vortex ribbons */}
            {[0, 1, 2, 3, 4].map((i) => (
              <path key={i}
                d={`M860,${280 + i * 12} q40,${20 + i * 5} 80,${i * 8} q60,${-10 - i * 4} 20,${-30 - i * 6}`}
                fill="none"
                stroke={i < 2 ? "hsl(38 95% 58%)" : "hsl(188 95% 55%)"}
                strokeWidth="0.7"
                strokeDasharray="3 3"
                opacity={0.6 - i * 0.07}
              />
            ))}
            {/* λ₂ blob */}
            <ellipse cx="900" cy="320" rx="60" ry="35" fill="hsl(38 95% 58%)" opacity="0.15" />
            <ellipse cx="900" cy="320" rx="40" ry="22" fill="hsl(38 95% 58%)" opacity="0.25" />
          </g>
        )}

        {/* ── STREAMLINES ── */}
        {mode === "streamlines" && (
          <g opacity={settings.intensity / 100}>
            {Array.from({ length: Math.round(8 + (settings.density / 100) * 22) }).map((_, i) => {
              const y = 200 + i * (220 / Math.round(8 + (settings.density / 100) * 22));
              return (
                <path key={i}
                  d={`M30,${y} Q260,${y - 10} 500,${y - 14} T960,${y - 8}`}
                  stroke="url(#streamGrad)" strokeWidth="0.9" fill="none" />
              );
            })}
            {/* downwash off wing */}
            {[0,1,2,3].map(i => (
              <path key={i} d={`M820,${230 + i * 8} q40,${10 + i * 4} 80,${i * 6}`}
                stroke="hsl(38 95% 58%)" strokeWidth="0.6" fill="none" strokeDasharray="2 3" opacity="0.7" />
            ))}
          </g>
        )}

        {/* ── FORCES vectors ── */}
        {mode === "forces" && (
          <g opacity={settings.intensity / 100}>
            {/* drag arrow (rear) */}
            <line x1="880" y1="350" x2="970" y2="350" stroke="hsl(38 95% 58%)" strokeWidth="2" />
            <path d="M970,350 L960,345 L960,355 Z" fill="hsl(38 95% 58%)" />
            <text x="930" y="340" fill="hsl(38 95% 58%)" textAnchor="middle" style={{ font: "10px 'JetBrains Mono', monospace" }}>D 112 kgf</text>
            {/* downforce front */}
            <line x1="280" y1="300" x2="280" y2="380" stroke="hsl(188 95% 55%)" strokeWidth="2" />
            <path d="M280,380 L275,370 L285,370 Z" fill="hsl(188 95% 55%)" />
            <text x="280" y="295" fill="hsl(188 95% 55%)" textAnchor="middle" style={{ font: "10px 'JetBrains Mono', monospace" }}>DF-F 121</text>
            {/* downforce rear */}
            <line x1="780" y1="270" x2="780" y2="380" stroke="hsl(188 95% 55%)" strokeWidth="2" />
            <path d="M780,380 L775,370 L785,370 Z" fill="hsl(188 95% 55%)" />
            <text x="780" y="265" fill="hsl(188 95% 55%)" textAnchor="middle" style={{ font: "10px 'JetBrains Mono', monospace" }}>DF-R 163</text>
            {/* CoP marker */}
            <circle cx="540" cy="380" r="6" fill="hsl(188 95% 55%)" opacity="0.3" />
            <circle cx="540" cy="380" r="3" fill="hsl(188 95% 55%)" />
            <text x="540" y="402" textAnchor="middle" fill="hsl(0 0% 95%)" style={{ font: "10px 'JetBrains Mono', monospace" }}>CoP · 42.6% F</text>
          </g>
        )}

        {/* Body */}
        <g>
          <path d="M180,400 L240,360 L380,330 L560,318 L700,338 L800,365 L880,400 L180,400 Z"
            fill={mode === "pressure" ? "url(#pBody)" : "url(#bodyOutline)"}
            stroke="hsl(188 95% 55%)" strokeWidth="1.2" opacity="0.95" />
          {/* Cabin */}
          <path d="M380,330 L500,300 L620,308 L700,330 Z"
            fill={mode === "pressure" ? "hsl(220 90% 60% / 0.4)" : "hsl(220 24% 11%)"}
            stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.85" />
          {/* mirrors */}
          <path d="M395,335 L405,330 L412,335 L405,340 Z" fill="hsl(188 95% 55%)" opacity="0.5" />
          <path d="M680,335 L688,330 L695,335 L688,340 Z" fill="hsl(188 95% 55%)" opacity="0.5" />
          {/* Splitter */}
          <path d="M150,406 L250,406 L260,412 L150,412 Z" fill="hsl(188 95% 55% / 0.3)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" />
          {/* Diffuser */}
          <path d="M780,408 L860,388 L860,418 L780,418 Z" fill="hsl(188 95% 55% / 0.4)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" />
          {/* Rear wing */}
          <path d="M740,290 L900,278 L900,292 L740,306 Z" fill="hsl(188 95% 55% / 0.5)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
          <path d="M790,350 L795,290 L800,290 L795,350 Z" fill="hsl(188 95% 55% / 0.4)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
          <path d="M840,350 L845,290 L850,290 L845,350 Z" fill="hsl(188 95% 55% / 0.4)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
          {/* Wheels */}
          <circle cx="290" cy="405" r="32" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
          <circle cx="290" cy="405" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
          <circle cx="780" cy="405" r="32" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
          <circle cx="780" cy="405" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" />
        </g>

        {/* Clipping plane */}
        {settings.clip && (
          <g>
            <line x1="500" y1="160" x2="500" y2="450" stroke="hsl(38 95% 58%)" strokeWidth="0.6" strokeDasharray="6 4" opacity="0.7" />
            <text x="508" y="175" fill="hsl(38 95% 58%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>clip · x = 0</text>
          </g>
        )}

        {/* Probe labels */}
        {settings.labels && (
          <g style={{ font: "9px 'JetBrains Mono', monospace" }}>
            <circle cx="200" cy="380" r="3" fill="hsl(0 80% 60%)" />
            <text x="208" y="376" fill="hsl(0 80% 60%)">Cp +0.94 · stagnation</text>
            <circle cx="500" cy="285" r="3" fill="hsl(220 90% 60%)" />
            <text x="508" y="281" fill="hsl(220 90% 60%)">Cp −1.18 · roof peak</text>
            <circle cx="820" cy="290" r="3" fill="hsl(188 95% 55%)" />
            <text x="828" y="286" fill="hsl(188 95% 55%)">Cp −1.62 · wing suction</text>
          </g>
        )}
      </svg>

      {/* HUD */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
        <StatusChip tone="solver" size="sm">Solver-backed</StatusChip>
        <StatusChip tone="success" size="sm">Converged · 8.2e-5</StatusChip>
      </div>
      <div className="absolute top-3 right-3 flex items-center gap-3 rounded-md border border-border bg-surface-1/80 px-3 py-1.5 backdrop-blur text-mono text-[10px]">
        <div><span className="text-muted-foreground">U∞ </span><span className="text-foreground">{RUN.speed}</span></div>
        <div><span className="text-muted-foreground">α </span><span className="text-foreground">{RUN.yaw}</span></div>
        <div><span className="text-muted-foreground">ρ </span><span className="text-foreground">1.225</span></div>
      </div>
      <div className="absolute bottom-3 left-3 flex items-center gap-3 text-mono text-[10px]">
        <div className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-destructive" /><span className="text-foreground">X</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-success" /><span className="text-foreground">Y</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-primary" /><span className="text-foreground">Z</span>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 text-mono text-[10px] text-muted-foreground/70">
        drag · orbit  /  shift+drag · pan  /  scroll · zoom
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Left summary                                                       */
/* ─────────────────────────────────────────────────────────────────── */
function ResultSummary({ variant, baseline }: { variant: VariantData; baseline: VariantData }) {
  const stats = [
    { l: "Drag coefficient",    v: variant.cd.toFixed(3),               u: "Cd",  delta: ((variant.cd - baseline.cd) / baseline.cd) * 100, invert: true,  big: true },
    { l: "Drag force",          v: variant.drag.toFixed(0),             u: "kgf", delta: ((variant.drag - baseline.drag) / baseline.drag) * 100, invert: true },
    { l: "Front downforce",     v: `+${variant.dfFront.toFixed(0)}`,    u: "kgf", delta: variant.dfFront - baseline.dfFront, invert: false },
    { l: "Rear downforce",      v: `+${variant.dfRear.toFixed(0)}`,     u: "kgf", delta: variant.dfRear - baseline.dfRear, invert: false },
    { l: "Total downforce",     v: `+${variant.dfTotal.toFixed(0)}`,    u: "kgf", delta: variant.dfTotal - baseline.dfTotal, invert: false, big: true },
    { l: "L/D ratio",           v: variant.ld.toFixed(2),               u: "",    delta: variant.ld - baseline.ld, invert: false },
    { l: "Aero balance · front",v: `${variant.balance.toFixed(1)}`,     u: "%",   delta: variant.balance - baseline.balance, invert: false },
    { l: "Top speed (calc)",    v: variant.topSpeed.toFixed(0),         u: "km/h",delta: variant.topSpeed - baseline.topSpeed, invert: false },
  ];

  return (
    <div className="glass rounded-xl flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Result summary</h3>
          </div>
          <ConfidenceBadge level="high" compact />
        </div>
        <div className="mt-1.5 text-mono text-[10px] text-muted-foreground truncate">
          {variant.name} · vs {baseline.name}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {stats.map((s) => {
          const d = fmtDelta(s.delta, { invert: s.invert, decimals: Math.abs(s.delta) < 1 ? 2 : 1, suffix: s.l.includes("balance") ? "pp" : s.u === "%" || s.l.includes("Drag co") ? "%" : "" });
          return (
            <div key={s.l} className={cn("px-4 py-3", s.big && "bg-primary/[0.03]")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("text-mono text-[10px] uppercase tracking-widest", s.big ? "text-primary/80" : "text-muted-foreground")}>
                  {s.l}
                </span>
                <span className={cn("text-mono tabular-nums", d.tone, "text-[10px] flex items-center gap-1")}>
                  <d.Icon className="h-3 w-3" />
                  {d.v}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className={cn("text-mono tabular-nums font-semibold",
                  s.big ? "text-2xl text-foreground" : "text-base text-foreground"
                )}>
                  {s.v}
                </span>
                {s.u && <span className="text-mono text-[10px] text-muted-foreground">{s.u}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Aero balance bar */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-between text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span>Balance · F / R</span>
          <span className="text-foreground tabular-nums">{variant.balance.toFixed(1)} / {(100 - variant.balance).toFixed(1)}</span>
        </div>
        <div className="relative mt-2 h-2 rounded-full bg-surface-2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary-glow" style={{ width: `${variant.balance}%` }} />
          {/* target marker @ 43% */}
          <div className="absolute top-0 bottom-0 w-px bg-warning" style={{ left: "43%" }} />
        </div>
        <div className="mt-1 flex justify-between text-mono text-[10px] text-muted-foreground/70">
          <span>front-loaded</span>
          <span>target 43%</span>
          <span>rear-loaded</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Right legend / display panel                                       */
/* ─────────────────────────────────────────────────────────────────── */
function DisplayPanel({
  mode, settings, setSettings,
}: {
  mode: Mode;
  settings: { density: number; intensity: number; clip: boolean; labels: boolean };
  setSettings: (s: typeof settings) => void;
}) {
  const ramp = {
    streamlines: { label: "Velocity · |U|", min: "0", max: "240 km/h", grad: "from-[hsl(220_60%_18%)] via-[hsl(188_95%_55%)] to-white", ticks: ["0", "60", "120", "180", "240"] },
    pressure:    { label: "Pressure · Cp",  min: "−1.8", max: "+1.0", grad: "from-[hsl(220_90%_60%)] via-[hsl(150_70%_50%)] via-[hsl(38_95%_58%)] to-[hsl(0_80%_60%)]", ticks: ["−1.8", "−0.9", "0", "+0.5", "+1.0"] },
    velocity:    { label: "Velocity · |U|", min: "0", max: "240 km/h", grad: "from-[hsl(220_60%_18%)] via-[hsl(188_95%_55%)] to-white", ticks: ["0", "60", "120", "180", "240"] },
    wake:        { label: "Vorticity · ω",  min: "0", max: "180 1/s", grad: "from-[hsl(220_24%_10%)] via-[hsl(38_95%_58%)] to-[hsl(0_80%_60%)]", ticks: ["0", "60", "120", "180"] },
    forces:      { label: "Force magnitude", min: "0", max: "180 kgf", grad: "from-[hsl(220_60%_18%)] via-[hsl(188_95%_55%)] to-[hsl(38_95%_58%)]", ticks: ["0", "60", "120", "180"] },
  }[mode];

  return (
    <div className="glass rounded-xl flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Display</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{mode}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <ColorRamp label={ramp.label} min={ramp.min} max={ramp.max} gradient={ramp.grad} ticks={ramp.ticks} />

        <div className="space-y-3">
          <ParamSlider
            label={mode === "streamlines" ? "Streamline density" : mode === "wake" ? "Iso-surface count" : "Probe density"}
            value={settings.density} min={0} max={100} unit="%"
            onChange={(v) => setSettings({ ...settings, density: v })}
          />
          <ParamSlider
            label="Contour intensity"
            value={settings.intensity} min={10} max={100} unit="%"
            onChange={(v) => setSettings({ ...settings, intensity: v })}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <div className="text-sm">Clip plane</div>
                <div className="text-mono text-[10px] text-muted-foreground">x = 0 · symmetry</div>
              </div>
            </div>
            <Switch
              checked={settings.clip}
              onCheckedChange={(v) => setSettings({ ...settings, clip: v })}
              className="data-[state=checked]:bg-primary"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <div className="text-sm">Probe labels</div>
                <div className="text-mono text-[10px] text-muted-foreground">Cp peaks &amp; CoP</div>
              </div>
            </div>
            <Switch
              checked={settings.labels}
              onCheckedChange={(v) => setSettings({ ...settings, labels: v })}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </div>

        <div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Layers</div>
          <div className="space-y-1.5">
            {[
              { l: "Body surface",   on: true },
              { l: "Aero parts",     on: true },
              { l: "Streamlines",    on: mode === "streamlines" },
              { l: "Pressure field", on: mode === "pressure" },
              { l: "Velocity field", on: mode === "velocity" },
              { l: "λ₂ iso-surface", on: mode === "wake" },
              { l: "Force vectors",  on: mode === "forces" },
            ].map((l) => (
              <div key={l.l} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-1.5">
                <span className="text-xs">{l.l}</span>
                {l.on ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground/60" />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Run metadata</div>
          <dl className="rounded-md border border-border bg-surface-1 divide-y divide-border/60">
            {[
              ["Run", RUN.id], ["Solver", RUN.solver], ["Iterations", RUN.iterations],
              ["Wall time", RUN.walltime], ["Residual", RUN.residual],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between px-3 py-1.5">
                <dt className="text-mono text-[10px] text-muted-foreground">{k}</dt>
                <dd className="text-mono text-[10px] text-foreground tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Pressure distribution chart                                        */
/* ─────────────────────────────────────────────────────────────────── */
function PressureDistribution() {
  // simple sampled Cp curve along x
  const pts: [number, number][] = [
    [0, 0.94], [0.05, 0.6], [0.1, 0.1], [0.18, -0.4], [0.28, -1.0],
    [0.38, -1.18], [0.5, -0.9], [0.62, -0.55], [0.72, -0.3], [0.82, -1.62],
    [0.88, -0.8], [0.95, -0.2], [1, 0.05],
  ];
  const w = 320, h = 120, pad = 18;
  const minY = -1.8, maxY = 1.0;
  const x = (t: number) => pad + t * (w - pad * 2);
  const y = (cp: number) => pad + (1 - (cp - minY) / (maxY - minY)) * (h - pad * 2);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p[0])},${y(p[1])}`).join(" ");
  const area = `${path} L${x(1)},${y(0)} L${x(0)},${y(0)} Z`;

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Pressure distribution</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Cp · centre line</span>
      </div>
      <div className="p-4">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[150px]">
          {/* gridlines */}
          {[-1.5, -1, -0.5, 0, 0.5, 1].map((g) => (
            <line key={g} x1={pad} y1={y(g)} x2={w - pad} y2={y(g)}
              stroke="hsl(220 14% 18%)" strokeWidth="0.4" strokeDasharray={g === 0 ? "0" : "2 3"} />
          ))}
          <text x={pad} y={y(1.0)} fill="hsl(215 14% 58%)" style={{ font: "8px 'JetBrains Mono', monospace" }}>+1.0</text>
          <text x={pad} y={y(-1.5) + 4} fill="hsl(215 14% 58%)" style={{ font: "8px 'JetBrains Mono', monospace" }}>−1.5</text>
          <text x={w - pad - 4} y={h - 4} textAnchor="end" fill="hsl(215 14% 58%)" style={{ font: "8px 'JetBrains Mono', monospace" }}>x/L</text>

          <path d={area} fill="hsl(188 95% 55% / 0.12)" />
          <path d={path} stroke="hsl(188 95% 55%)" strokeWidth="1.4" fill="none" />
          {/* peaks */}
          <circle cx={x(0.38)} cy={y(-1.18)} r="3" fill="hsl(220 90% 60%)" />
          <circle cx={x(0.82)} cy={y(-1.62)} r="3" fill="hsl(188 95% 55%)" />
          <circle cx={x(0)}    cy={y(0.94)}  r="3" fill="hsl(0 80% 60%)" />
        </svg>
        <div className="mt-2 grid grid-cols-3 gap-2 text-mono text-[10px]">
          <div className="rounded border border-border bg-surface-1 p-2">
            <div className="text-muted-foreground uppercase tracking-widest">Stag</div>
            <div className="text-destructive tabular-nums">+0.94</div>
          </div>
          <div className="rounded border border-border bg-surface-1 p-2">
            <div className="text-muted-foreground uppercase tracking-widest">Roof</div>
            <div className="text-[hsl(220_90%_60%)] tabular-nums">−1.18</div>
          </div>
          <div className="rounded border border-border bg-surface-1 p-2">
            <div className="text-muted-foreground uppercase tracking-widest">Wing</div>
            <div className="text-primary tabular-nums">−1.62</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Wake card                                                          */
/* ─────────────────────────────────────────────────────────────────── */
function WakeCard() {
  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Wake structure</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">3D iso-surface</span>
      </div>
      <div className="p-4">
        <div className="relative h-[150px] overflow-hidden rounded-md border border-border bg-surface-0">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <svg viewBox="0 0 320 150" className="absolute inset-0 h-full w-full">
            {/* car silhouette */}
            <path d="M40,110 L70,90 L160,80 L220,82 L260,95 L290,110 L40,110 Z"
              fill="hsl(220 24% 9%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.85" />
            {/* wake ribbons */}
            {Array.from({ length: 8 }).map((_, i) => (
              <ellipse key={i} cx={290 + i * 4} cy={88 + (i % 2) * 6} rx={26 + i * 3} ry={9 - i * 0.4}
                fill="none" stroke="hsl(38 95% 58%)" strokeWidth="0.5" opacity={0.7 - i * 0.07} />
            ))}
            {/* coherent vortex */}
            <ellipse cx="245" cy="60" rx="18" ry="10" fill="hsl(188 95% 55% / 0.25)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
            <ellipse cx="245" cy="60" rx="9" ry="5" fill="hsl(188 95% 55% / 0.4)" />
          </svg>
          <div className="absolute bottom-2 left-2 text-mono text-[9px] text-muted-foreground">λ₂ = −250</div>
          <div className="absolute bottom-2 right-2 text-mono text-[9px] text-muted-foreground">view · side</div>
        </div>
        <div className="mt-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Wake width</span>
            <span className="text-mono tabular-nums">1.82 m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Coherent length</span>
            <span className="text-mono tabular-nums">3.4 m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Vortex pair sep.</span>
            <span className="text-mono tabular-nums">1.18 m</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Energy ratio</span>
            <span className="text-mono tabular-nums text-success">0.31 ↓</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Force breakdown                                                    */
/* ─────────────────────────────────────────────────────────────────── */
function ForceBreakdown() {
  const parts = [
    { l: "Front splitter", df: 38,  dr: 4,  c: "bg-primary" },
    { l: "Canards",        df: 12,  dr: 2,  c: "bg-primary-glow" },
    { l: "Underbody",      df: 22,  dr: -1, c: "bg-success" },
    { l: "Rear diffuser",  df: 46,  dr: 1,  c: "bg-primary" },
    { l: "Rear wing",      df: 148, dr: 18, c: "bg-warning" },
    { l: "Body residual",  df: 18,  dr: 88, c: "bg-muted-foreground" },
  ];
  const totalDF = parts.reduce((s, p) => s + p.df, 0);
  const totalDR = parts.reduce((s, p) => s + Math.abs(p.dr), 0);

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Force breakdown</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">By component</span>
      </div>
      <div className="p-4">
        {/* DF stacked bar */}
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex justify-between">
          <span>Downforce contribution</span>
          <span className="text-primary tabular-nums">{totalDF} kgf</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 mb-3">
          {parts.map((p) => (
            <div key={p.l} className={p.c} style={{ width: `${(p.df / totalDF) * 100}%` }} title={`${p.l}: ${p.df} kgf`} />
          ))}
        </div>
        {/* DR stacked bar */}
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex justify-between">
          <span>Drag contribution</span>
          <span className="text-warning tabular-nums">{totalDR} kgf</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 mb-3">
          {parts.map((p) => (
            <div key={p.l} className={cn(p.c, "opacity-70")} style={{ width: `${(Math.abs(p.dr) / totalDR) * 100}%` }} title={`${p.l}: ${p.dr} kgf`} />
          ))}
        </div>

        <ul className="space-y-1.5">
          {parts.map((p) => (
            <li key={p.l} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className={cn("h-2 w-2 rounded-sm shrink-0", p.c)} />
                <span className="truncate">{p.l}</span>
              </div>
              <div className="flex items-center gap-3 text-mono text-[11px] tabular-nums shrink-0">
                <span className="text-success">+{p.df}</span>
                <span className={cn(p.dr > 0 ? "text-warning" : "text-success")}>{p.dr > 0 ? "+" : ""}{p.dr}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Comparison table                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function ComparisonTable() {
  const rows: { l: string; baseline: string; current: string; optimized: string; deltaCur: number; deltaOpt: number; invert?: boolean; unit?: string }[] = [
    { l: "Drag coefficient (Cd)",  baseline: "0.366", current: "0.342", optimized: "0.328", deltaCur: -6.6,  deltaOpt: -10.4, invert: true,  unit: "%" },
    { l: "Drag force",             baseline: "116",   current: "112",   optimized: "108",   deltaCur: -3.4,  deltaOpt: -6.9,  invert: true,  unit: "%" },
    { l: "Front downforce (kgf)",  baseline: "+12",   current: "+121",  optimized: "+138",  deltaCur: 109,   deltaOpt: 126 },
    { l: "Rear downforce (kgf)",   baseline: "−34",   current: "+163",  optimized: "+178",  deltaCur: 197,   deltaOpt: 212 },
    { l: "Total downforce (kgf)",  baseline: "−22",   current: "+284",  optimized: "+316",  deltaCur: 306,   deltaOpt: 338 },
    { l: "L/D ratio",              baseline: "−0.19", current: "2.54",  optimized: "2.93",  deltaCur: 2.73,  deltaOpt: 3.12, unit: "" },
    { l: "Aero balance · front",   baseline: "100%",  current: "42.6%", optimized: "43.7%", deltaCur: -57.4, deltaOpt: -56.3, unit: "pp" },
    { l: "Top speed (calc)",       baseline: "226",   current: "218",   optimized: "222",   deltaCur: -8,    deltaOpt: -4, invert: true, unit: " km/h" },
  ];

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Performance comparison</h3>
        </div>
        <div className="flex items-center gap-2">
          <Legend
            items={[
              { label: "Baseline",  color: "text-muted-foreground", shape: "square" },
              { label: "Current",   color: "text-primary",          shape: "square" },
              { label: "Optimized", color: "text-success",          shape: "square" },
            ]}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-1/50">
              <th className="text-left text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-4 py-2">Metric</th>
              <th className="text-right text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-3 py-2">Baseline</th>
              <th className="text-right text-mono text-[10px] uppercase tracking-widest text-primary font-normal px-3 py-2">Current</th>
              <th className="text-right text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-2 py-2">Δ vs base</th>
              <th className="text-right text-mono text-[10px] uppercase tracking-widest text-success font-normal px-3 py-2">Optimized</th>
              <th className="text-right text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-2 py-2">Δ vs base</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => {
              const dCur = fmtDelta(r.deltaCur, { invert: r.invert, suffix: r.unit ?? "", decimals: Math.abs(r.deltaCur) < 10 ? 2 : 1 });
              const dOpt = fmtDelta(r.deltaOpt, { invert: r.invert, suffix: r.unit ?? "", decimals: Math.abs(r.deltaOpt) < 10 ? 2 : 1 });
              return (
                <tr key={r.l} className="hover:bg-surface-1/40 transition-colors">
                  <td className="px-4 py-2.5 text-foreground">{r.l}</td>
                  <td className="px-3 py-2.5 text-right text-mono tabular-nums text-muted-foreground">{r.baseline}</td>
                  <td className="px-3 py-2.5 text-right text-mono tabular-nums text-foreground font-medium">{r.current}</td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={cn("inline-flex items-center gap-1 text-mono text-[11px] tabular-nums", dCur.tone)}>
                      <dCur.Icon className="h-3 w-3" /> {dCur.v}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-mono tabular-nums text-foreground font-medium">{r.optimized}</td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={cn("inline-flex items-center gap-1 text-mono text-[11px] tabular-nums", dOpt.tone)}>
                      <dOpt.Icon className="h-3 w-3" /> {dOpt.v}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-4 py-2.5 text-mono text-[10px] text-muted-foreground flex items-center justify-between">
        <span>All values · 200 km/h · 0° yaw · ρ 1.225 · solver-backed</span>
        <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground -mr-2">
          <Download className="mr-1.5 h-3 w-3" /> CSV
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Notes & recommendations                                            */
/* ─────────────────────────────────────────────────────────────────── */
function NotesPanel() {
  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Notes &amp; recommendations</h3>
        </div>
        <StatusChip tone="medium" size="sm" dot={false}>3 suggestions</StatusChip>
      </div>
      <div className="p-3 space-y-2">
        {[
          { tone: "ok",   icon: CheckCircle2, title: "Balance within target",
            body: "Front share 42.6% sits 0.4 pp under the 43% target — well inside the stable window." },
          { tone: "tip",  icon: Sparkles,     title: "Reduce wing AoA by 1.5°",
            body: "Adjoint sweep predicts +0.39 L/D and −4 kgf drag with negligible balance shift." },
          { tone: "warn", icon: AlertTriangle, title: "Wing in roof wake at α > 4°",
            body: "Yaw runs show wing efficiency drops 12% at +6° α. Consider raising mount by 25 mm." },
          { tone: "tip",  icon: Sparkles,     title: "Diffuser strake count optimal",
            body: "4 strakes resolves to within 1% of 5 — keep current count to save mass." },
        ].map((n) => (
          <div key={n.title} className={cn(
            "rounded-md border p-3",
            n.tone === "ok"   && "border-success/25 bg-success/5",
            n.tone === "tip"  && "border-primary/25 bg-primary/5",
            n.tone === "warn" && "border-warning/25 bg-warning/5",
          )}>
            <div className="flex items-start gap-2.5">
              <n.icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5",
                n.tone === "ok" && "text-success",
                n.tone === "tip" && "text-primary",
                n.tone === "warn" && "text-warning",
              )} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{n.title}</div>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{n.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Results = () => {
  const [variant, setVariant] = useState<VariantId>("current");
  const [mode, setMode] = useState<Mode>("streamlines");
  const [settings, setSettings] = useState({ density: 60, intensity: 70, clip: false, labels: true });

  const activeVariant = VARIANTS[variant];
  const baseline = VARIANTS.baseline;

  return (
    <AppLayout>
      {/* Sticky header */}
      <div className="sticky top-14 z-20 border-b border-border bg-surface-0/80 backdrop-blur">
        <div className="px-6 py-3 flex flex-wrap items-center gap-3">
          <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest">
            <Link to="/garage" className="text-muted-foreground hover:text-foreground transition-colors">Garage</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <Link to="/build" className="text-muted-foreground hover:text-foreground transition-colors">GR86 Track Build</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-foreground">Results</span>
            <span className="text-muted-foreground/50">· {RUN.id}</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone="solver" size="sm">Solver-backed</StatusChip>
            <StatusChip tone="success" size="sm">Converged</StatusChip>
            <ConfidenceBadge level="high" compact />
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm" asChild>
              <Link to="/compare"><GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare</Link>
            </Button>
            <Button variant="glass" size="sm">
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate as new variant
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/exports">
                <FileDown className="mr-2 h-3.5 w-3.5" /> Export report
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 04 · CFD results
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Results</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              {RUN.car} · {RUN.variant} · {RUN.speed} · {RUN.yaw} · {RUN.iterations} iter · {RUN.walltime}
            </p>
          </div>
          <VariantSwitcher value={variant} onChange={setVariant} />
        </div>

        {/* Main grid: summary | viewer | display */}
        <div className="grid gap-4 xl:grid-cols-12">
          {/* Left summary */}
          <div className="xl:col-span-3">
            <ResultSummary variant={activeVariant} baseline={baseline} />
          </div>

          {/* Center viewer */}
          <div className="xl:col-span-6">
            <div className="glass-strong overflow-hidden rounded-xl shadow-elevated">
              {/* Mode toolbar */}
              <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface-0/80 px-3 py-2 backdrop-blur">
                <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const active = m.id === mode;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setMode(m.id)}
                        className={cn(
                          "rounded px-2.5 py-1.5 text-mono text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1.5",
                          active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Camera className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Grid3x3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="relative h-[560px]">
                <ResultViewer mode={mode} variant={variant} settings={settings} />
              </div>
              <div className="border-t border-border px-3 py-2 flex items-center justify-between text-mono text-[10px] text-muted-foreground">
                <span>{MODES.find(m => m.id === mode)?.sub} · sampled at z = 0.6 m</span>
                <span>OpenFOAM 11 · k-ω SST · steady-state</span>
              </div>
            </div>
          </div>

          {/* Right display panel */}
          <div className="xl:col-span-3">
            <DisplayPanel mode={mode} settings={settings} setSettings={setSettings} />
          </div>
        </div>

        {/* Bottom analysis row */}
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <PressureDistribution />
          <WakeCard />
          <ForceBreakdown />
        </div>

        {/* Comparison + notes */}
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ComparisonTable />
          </div>
          <div className="xl:col-span-1">
            <NotesPanel />
          </div>
        </div>

        {/* Bottom action bar */}
        <div className="mt-6 glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
              <ShieldCheck className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-medium">Run converged · solver-backed</div>
              <div className="text-mono text-[11px] text-muted-foreground">
                {RUN.id} · residual {RUN.residual} · {RUN.iterations} iter · {RUN.walltime}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="glass" size="sm" asChild>
              <Link to="/simulation"><ChevronLeft className="mr-2 h-3.5 w-3.5" /> Back to setup</Link>
            </Button>
            <Button variant="glass" size="sm">
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate as new variant
            </Button>
            <Button variant="glass" size="sm" asChild>
              <Link to="/compare"><GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare variants</Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/exports">
                Export report <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Results;
