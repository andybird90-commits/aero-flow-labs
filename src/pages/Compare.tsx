import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { Legend } from "@/components/Legend";
import {
  ChevronRight, ArrowRight, Plus, X, GitCompareArrows, Trophy, Gauge,
  Wind, Target, Scale, Filter, Eye, Layers, Crown, Sparkles,
  TrendingUp, TrendingDown, Minus, Download, Copy, ArrowUpRight, Zap,
  CircleCheck, CircleAlert, ChevronDown, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────── */
/*  Variant data                                                       */
/* ─────────────────────────────────────────────────────────────────── */
type ConfLevel = "low" | "medium" | "high";

interface Variant {
  id: string;
  name: string;
  pkg: string;
  tag: string;
  cd: number;
  drag: number;
  dfFront: number;
  dfRear: number;
  dfTotal: number;
  ld: number;
  balance: number;       // % front
  topSpeed: number;      // km/h
  trackScore: number;    // 0-100
  stabilityScore: number; // 0-100
  confidence: ConfLevel;
  // params for "changed only" diff
  params: {
    splitter: number;     // mm protrusion
    canards: boolean;
    skirts: boolean;
    wingChord: number;    // mm
    wingAoA: number;      // deg
    diffAngle: number;    // deg
    rideF: number;        // mm
    rideR: number;
  };
}

const ALL_VARIANTS: Variant[] = [
  {
    id: "v0", name: "Baseline OEM", pkg: "Stock body, no aero", tag: "Baseline",
    cd: 0.366, drag: 116, dfFront: 12, dfRear: -34, dfTotal: -22,
    ld: -0.19, balance: 100, topSpeed: 226, trackScore: 28, stabilityScore: 35, confidence: "high",
    params: { splitter: 0, canards: false, skirts: false, wingChord: 0, wingAoA: 0, diffAngle: 0, rideF: 130, rideR: 135 },
  },
  {
    id: "v1", name: "Street pack v1", pkg: "Splitter + small wing", tag: "Road",
    cd: 0.352, drag: 113, dfFront: 64, dfRear: 78, dfTotal: 142,
    ld: 1.26, balance: 45.1, topSpeed: 222, trackScore: 58, stabilityScore: 62, confidence: "high",
    params: { splitter: 35, canards: false, skirts: false, wingChord: 220, wingAoA: 4, diffAngle: 7, rideF: 120, rideR: 125 },
  },
  {
    id: "v2", name: "Track pack v2", pkg: "Full splitter, canards, GT wing", tag: "Track",
    cd: 0.348, drag: 114, dfFront: 108, dfRear: 142, dfTotal: 250,
    ld: 2.19, balance: 43.2, topSpeed: 220, trackScore: 78, stabilityScore: 71, confidence: "high",
    params: { splitter: 60, canards: true, skirts: true, wingChord: 280, wingAoA: 8, diffAngle: 9, rideF: 105, rideR: 115 },
  },
  {
    id: "v3", name: "Optimized v3 · current", pkg: "Refined GT package", tag: "Track",
    cd: 0.342, drag: 112, dfFront: 121, dfRear: 163, dfTotal: 284,
    ld: 2.54, balance: 42.6, topSpeed: 218, trackScore: 84, stabilityScore: 76, confidence: "high",
    params: { splitter: 65, canards: true, skirts: true, wingChord: 280, wingAoA: 8.5, diffAngle: 10, rideF: 105, rideR: 118 },
  },
  {
    id: "v4", name: "Optimized v4 · adjoint", pkg: "Adjoint sweep · best L/D", tag: "Track",
    cd: 0.328, drag: 108, dfFront: 138, dfRear: 178, dfTotal: 316,
    ld: 2.93, balance: 43.7, topSpeed: 222, trackScore: 91, stabilityScore: 82, confidence: "medium",
    params: { splitter: 70, canards: true, skirts: true, wingChord: 280, wingAoA: 7, diffAngle: 11, rideF: 105, rideR: 118 },
  },
  {
    id: "v5", name: "High-speed stability", pkg: "Low AoA wing, deep diffuser", tag: "High speed",
    cd: 0.336, drag: 110, dfFront: 96, dfRear: 142, dfTotal: 238,
    ld: 2.16, balance: 40.3, topSpeed: 224, trackScore: 72, stabilityScore: 88, confidence: "high",
    params: { splitter: 55, canards: false, skirts: true, wingChord: 280, wingAoA: 5, diffAngle: 12, rideF: 110, rideR: 118 },
  },
  {
    id: "v6", name: "Max rear grip", pkg: "Aggressive wing + ducktail", tag: "Track",
    cd: 0.358, drag: 118, dfFront: 102, dfRear: 198, dfTotal: 300,
    ld: 2.54, balance: 34.0, topSpeed: 214, trackScore: 80, stabilityScore: 74, confidence: "medium",
    params: { splitter: 60, canards: true, skirts: true, wingChord: 320, wingAoA: 11, diffAngle: 9, rideF: 105, rideR: 122 },
  },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Helpers                                                            */
/* ─────────────────────────────────────────────────────────────────── */
function fmtDelta(value: number, opts?: { invert?: boolean; pct?: boolean; suffix?: string; decimals?: number }) {
  const decimals = opts?.decimals ?? 1;
  const prefix = value > 0 ? "+" : "";
  const v = opts?.pct ? `${prefix}${value.toFixed(decimals)}%` : `${prefix}${value.toFixed(decimals)}${opts?.suffix ?? ""}`;
  const better = opts?.invert ? value < 0 : value > 0;
  const tone = value === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Icon = value === 0 ? Minus : better ? (opts?.invert ? TrendingDown : TrendingUp) : (opts?.invert ? TrendingUp : TrendingDown);
  return { v, tone, Icon };
}

const VARIANT_COLORS = ["text-muted-foreground", "text-primary", "text-success", "text-warning"];
const VARIANT_DOTS = ["bg-muted-foreground", "bg-primary", "bg-success", "bg-warning"];
const VARIANT_FILLS = ["hsl(215 14% 58%)", "hsl(188 95% 55%)", "hsl(150 70% 50%)", "hsl(38 95% 58%)"];

/* ─────────────────────────────────────────────────────────────────── */
/*  Variant selector                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function VariantSelector({
  selected, onAdd, onRemove,
}: {
  selected: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = ALL_VARIANTS.filter((v) => !selected.includes(v.id));

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Variants in comparison</h3>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {selected.length} of 4
          </span>
        </div>
        <div className="relative">
          <Button
            variant="glass"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            disabled={selected.length >= 4 || available.length === 0}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add variant
            <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
          </Button>
          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1.5 w-72 rounded-md border border-border bg-surface-1 shadow-elevated overflow-hidden">
                <div className="px-3 py-2 border-b border-border text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Available variants
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {available.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => { onAdd(v.id); setOpen(false); }}
                      className="w-full px-3 py-2.5 text-left hover:bg-primary/5 border-b border-border/50 last:border-b-0 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{v.name}</div>
                          <div className="text-mono text-[10px] text-muted-foreground truncate">{v.pkg}</div>
                        </div>
                        <span className="text-mono text-[9px] uppercase tracking-widest rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground group-hover:text-primary">
                          {v.tag}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="p-3 flex flex-wrap gap-2">
        {selected.map((id, i) => {
          const v = ALL_VARIANTS.find((x) => x.id === id)!;
          return (
            <div key={id} className="group inline-flex items-center gap-2 rounded-md border border-border bg-surface-1 pl-2 pr-1 py-1.5">
              <span className={cn("h-2 w-2 rounded-full", VARIANT_DOTS[i])} />
              <div className="leading-tight pr-1">
                <div className="text-xs font-medium">{v.name}</div>
                <div className="text-mono text-[9px] text-muted-foreground">{v.tag}</div>
              </div>
              {selected.length > 2 && (
                <button
                  onClick={() => onRemove(id)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Ranked performance cards                                           */
/* ─────────────────────────────────────────────────────────────────── */
function RankedCards({ variants, baseline }: { variants: Variant[]; baseline: Variant }) {
  // rank by L/D
  const ranked = [...variants].map((v, i) => ({ v, i })).sort((a, b) => b.v.ld - a.v.ld);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {ranked.map((r, rank) => {
        const v = r.v;
        const i = r.i;
        const dCd = ((v.cd - baseline.cd) / baseline.cd) * 100;
        const dDF = v.dfTotal - baseline.dfTotal;
        const dLD = v.ld - baseline.ld;
        const isLeader = rank === 0;

        return (
          <div
            key={v.id}
            className={cn(
              "glass rounded-xl overflow-hidden flex flex-col",
              isLeader && "ring-1 ring-primary/40 shadow-glow",
            )}
          >
            {/* Rank header */}
            <div className={cn(
              "px-4 py-2.5 flex items-center justify-between border-b border-border",
              isLeader ? "bg-primary/10" : "bg-surface-1/50",
            )}>
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-mono text-[11px] font-bold tabular-nums",
                  isLeader ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
                )}>
                  {isLeader ? <Crown className="h-3 w-3" /> : `#${rank + 1}`}
                </div>
                <span className={cn("h-2 w-2 rounded-full", VARIANT_DOTS[i])} />
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {v.tag}
                </span>
              </div>
              <ConfidenceBadge level={v.confidence} compact />
            </div>

            {/* Body */}
            <div className="p-4 flex-1 flex flex-col">
              <div className="text-base font-semibold tracking-tight truncate">{v.name}</div>
              <div className="text-mono text-[10px] text-muted-foreground mt-0.5 truncate">{v.pkg}</div>

              {/* Hero L/D */}
              <div className="mt-4 rounded-md border border-border bg-surface-1/60 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">L/D ratio</span>
                  {(() => { const d = fmtDelta(dLD, { decimals: 2 }); return (
                    <span className={cn("text-mono text-[10px] flex items-center gap-1", d.tone)}>
                      <d.Icon className="h-3 w-3" />{d.v}
                    </span>
                  ); })()}
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-mono">
                  {v.ld.toFixed(2)}
                </div>
              </div>

              {/* Stat grid */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Stat l="Cd" v={v.cd.toFixed(3)} delta={dCd} invert pct />
                <Stat l="Drag" v={`${v.drag}`} u="kgf" delta={v.drag - baseline.drag} invert />
                <Stat l="DF front" v={`+${v.dfFront}`} u="kgf" delta={v.dfFront - baseline.dfFront} />
                <Stat l="DF rear" v={`+${v.dfRear}`} u="kgf" delta={v.dfRear - baseline.dfRear} />
                <Stat l="DF total" v={`+${v.dfTotal}`} u="kgf" delta={dDF} highlight />
                <Stat l="Balance F" v={`${v.balance.toFixed(1)}%`} delta={v.balance - baseline.balance} suffix="pp" />
              </div>

              {/* Aero balance bar */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <span>Balance F/R</span>
                  <span className="text-foreground tabular-nums">{v.balance.toFixed(1)} / {(100 - v.balance).toFixed(1)}</span>
                </div>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary to-primary-glow" style={{ width: `${v.balance}%` }} />
                  <div className="absolute top-0 bottom-0 w-px bg-warning" style={{ left: "43%" }} />
                </div>
              </div>

              <div className="mt-auto pt-4 flex items-center gap-1.5">
                <Button variant="glass" size="sm" className="flex-1 h-8 text-xs">
                  <Eye className="mr-1.5 h-3 w-3" /> Open
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ l, v, u, delta, invert, pct, suffix, highlight }: {
  l: string; v: string; u?: string; delta: number; invert?: boolean; pct?: boolean; suffix?: string; highlight?: boolean;
}) {
  const d = fmtDelta(delta, { invert, pct, suffix, decimals: Math.abs(delta) < 1 ? 2 : 1 });
  return (
    <div className={cn("rounded border border-border/60 bg-surface-0/40 p-2", highlight && "border-primary/30 bg-primary/5")}>
      <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">{l}</div>
      <div className="flex items-baseline justify-between gap-1 mt-0.5">
        <span className={cn("text-mono tabular-nums", highlight ? "text-primary font-semibold" : "text-foreground")}>
          {v}{u && <span className="text-[9px] text-muted-foreground ml-0.5">{u}</span>}
        </span>
        <span className={cn("text-mono text-[9px] tabular-nums", d.tone)}>{d.v}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Drag vs Downforce scatter                                          */
/* ─────────────────────────────────────────────────────────────────── */
function DragDfChart({ variants, allVariants }: { variants: Variant[]; allVariants: Variant[] }) {
  // x: drag (100..120), y: total downforce (-50..350)
  const w = 600, h = 320, pad = 36;
  const xMin = 100, xMax = 120;
  const yMin = -50, yMax = 350;
  const x = (v: number) => pad + ((v - xMin) / (xMax - xMin)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - yMin) / (yMax - yMin)) * (h - pad * 2);

  // L/D iso-lines: DF / Drag = const  →  DF = c * Drag
  const isos = [1, 2, 3];

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Drag vs Downforce</h3>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Pareto frontier
          </span>
        </div>
        <Legend
          items={[
            { label: "Compared", color: "text-primary", shape: "dot" },
            { label: "Other", color: "text-muted-foreground", shape: "dot" },
            { label: "L/D iso", color: "text-warning", shape: "line" },
          ]}
        />
      </div>
      <div className="p-4">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[340px]">
          {/* grid */}
          {[100, 105, 110, 115, 120].map((tx) => (
            <g key={tx}>
              <line x1={x(tx)} y1={pad} x2={x(tx)} y2={h - pad} stroke="hsl(220 14% 18%)" strokeWidth="0.4" strokeDasharray="2 3" />
              <text x={x(tx)} y={h - pad + 14} textAnchor="middle" fill="hsl(215 14% 58%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>{tx}</text>
            </g>
          ))}
          {[0, 100, 200, 300].map((ty) => (
            <g key={ty}>
              <line x1={pad} y1={y(ty)} x2={w - pad} y2={y(ty)} stroke="hsl(220 14% 18%)" strokeWidth="0.4" strokeDasharray={ty === 0 ? "0" : "2 3"} />
              <text x={pad - 6} y={y(ty) + 3} textAnchor="end" fill="hsl(215 14% 58%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>{ty}</text>
            </g>
          ))}
          {/* axis labels */}
          <text x={w / 2} y={h - 6} textAnchor="middle" fill="hsl(215 14% 58%)" style={{ font: "10px 'JetBrains Mono', monospace" }}>
            Drag (kgf @ 200 km/h)
          </text>
          <text x={12} y={h / 2} transform={`rotate(-90 12 ${h / 2})`} textAnchor="middle" fill="hsl(215 14% 58%)" style={{ font: "10px 'JetBrains Mono', monospace" }}>
            Total downforce (kgf)
          </text>

          {/* L/D iso-lines */}
          {isos.map((c) => {
            const x1 = xMin, y1 = c * x1;
            const x2 = xMax, y2 = c * x2;
            if (y2 < yMin || y1 > yMax) return null;
            return (
              <g key={c}>
                <line
                  x1={x(x1)} y1={y(Math.max(yMin, Math.min(yMax, y1)))}
                  x2={x(x2)} y2={y(Math.max(yMin, Math.min(yMax, y2)))}
                  stroke="hsl(38 95% 58%)" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.5"
                />
                <text x={x(xMax) - 4} y={y(Math.min(yMax, y2)) - 2} textAnchor="end" fill="hsl(38 95% 58%)" style={{ font: "9px 'JetBrains Mono', monospace" }} opacity="0.7">
                  L/D {c}
                </text>
              </g>
            );
          })}

          {/* "better" arrow */}
          <g opacity="0.4">
            <line x1={pad + 10} y1={h - pad - 10} x2={pad + 50} y2={h - pad - 50} stroke="hsl(150 70% 50%)" strokeWidth="0.8" strokeDasharray="2 3" />
            <path d={`M${pad + 50},${h - pad - 50} l-3,1 l4,4 z`} fill="hsl(150 70% 50%)" />
            <text x={pad + 56} y={h - pad - 50} fill="hsl(150 70% 50%)" style={{ font: "9px 'JetBrains Mono', monospace" }}>better</text>
          </g>

          {/* faint other variants */}
          {allVariants.filter(v => !variants.find(x => x.id === v.id)).map((v) => (
            <circle key={v.id} cx={x(v.drag)} cy={y(v.dfTotal)} r="3" fill="hsl(215 14% 58%)" opacity="0.35" />
          ))}

          {/* compared variants */}
          {variants.map((v, i) => (
            <g key={v.id}>
              <circle cx={x(v.drag)} cy={y(v.dfTotal)} r="9" fill={VARIANT_FILLS[i]} opacity="0.18" />
              <circle cx={x(v.drag)} cy={y(v.dfTotal)} r="5" fill={VARIANT_FILLS[i]} stroke="hsl(220 26% 5%)" strokeWidth="1.5" />
              <text x={x(v.drag) + 9} y={y(v.dfTotal) - 8} fill={VARIANT_FILLS[i]} style={{ font: "10px 'JetBrains Mono', monospace" }}>
                {v.name.length > 18 ? v.name.slice(0, 18) + "…" : v.name}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Objective score ranking                                            */
/* ─────────────────────────────────────────────────────────────────── */
type Objective = "track" | "topspeed" | "balance" | "stability";

const OBJECTIVES: { id: Objective; label: string; icon: typeof Trophy; sub: string }[] = [
  { id: "track",     label: "Track use",     icon: Trophy,  sub: "DF · L/D · balance" },
  { id: "topspeed",  label: "Top speed",     icon: Zap,     sub: "Low Cd · low drag" },
  { id: "balance",   label: "Best balance",  icon: Scale,   sub: "Closest to 43% F" },
  { id: "stability", label: "High-speed stab.", icon: Wind, sub: "Rear bias · low Cd" },
];

function scoreFor(v: Variant, obj: Objective): number {
  switch (obj) {
    case "track":     return Math.round(v.trackScore);
    case "topspeed":  return Math.round(100 - (v.cd - 0.32) * 600 - (v.drag - 105) * 1.5);
    case "balance":   return Math.round(100 - Math.abs(v.balance - 43) * 5);
    case "stability": return Math.round(v.stabilityScore);
  }
}

function ObjectiveRanking({ variants, objective, setObjective }: {
  variants: Variant[]; objective: Objective; setObjective: (o: Objective) => void;
}) {
  const ranked = useMemo(
    () => [...variants].map((v, i) => ({ v, i, score: scoreFor(v, objective) })).sort((a, b) => b.score - a.score),
    [variants, objective],
  );
  const best = ranked[0];

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Objective score ranking</h3>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
          {OBJECTIVES.map((o) => {
            const Icon = o.icon;
            const active = o.id === objective;
            return (
              <button
                key={o.id}
                onClick={() => setObjective(o.id)}
                className={cn(
                  "rounded px-2.5 py-1.5 text-mono text-[10px] uppercase tracking-widest transition-colors flex items-center gap-1.5",
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3 w-3" /> {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-4">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
          Optimizing for · {OBJECTIVES.find(o => o.id === objective)?.sub}
        </div>
        <div className="space-y-2">
          {ranked.map((r, rank) => {
            const isWinner = r.v.id === best.v.id;
            return (
              <div
                key={r.v.id}
                className={cn(
                  "rounded-md border p-3 flex items-center gap-3",
                  isWinner ? "border-primary/40 bg-primary/5" : "border-border bg-surface-1/40",
                )}
              >
                <div className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-mono text-[11px] font-bold shrink-0",
                  isWinner ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
                )}>
                  {isWinner ? <Crown className="h-3.5 w-3.5" /> : `#${rank + 1}`}
                </div>
                <span className={cn("h-2 w-2 rounded-full shrink-0", VARIANT_DOTS[r.i])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{r.v.name}</span>
                    {isWinner && (
                      <span className="text-mono text-[9px] uppercase tracking-widest rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
                        Winner
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 relative h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={cn("absolute inset-y-0 left-0", isWinner ? "bg-gradient-to-r from-primary to-primary-glow" : "bg-muted-foreground/50")}
                      style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cn("text-mono text-lg font-semibold tabular-nums", isWinner ? "text-primary" : "text-foreground")}>
                    {r.score}
                  </div>
                  <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">/ 100</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Compare table                                                      */
/* ─────────────────────────────────────────────────────────────────── */
type Highlight = "topspeed" | "track" | "balance" | null;

function CompareTable({
  variants, baseline, changedOnly, setChangedOnly, highlight, setHighlight,
}: {
  variants: Variant[];
  baseline: Variant;
  changedOnly: boolean;
  setChangedOnly: (v: boolean) => void;
  highlight: Highlight;
  setHighlight: (h: Highlight) => void;
}) {
  type Row = {
    l: string; group: "perf" | "param";
    get: (v: Variant) => string | number;
    bestBy: "max" | "min" | "balance" | "none";
    unit?: string;
    isParam?: boolean;
  };
  const rows: Row[] = [
    { l: "Drag coefficient (Cd)", group: "perf",  get: (v) => v.cd.toFixed(3),    bestBy: "min" },
    { l: "Drag force",            group: "perf",  get: (v) => v.drag,             bestBy: "min", unit: "kgf" },
    { l: "Front downforce",       group: "perf",  get: (v) => `+${v.dfFront}`,    bestBy: "max", unit: "kgf" },
    { l: "Rear downforce",        group: "perf",  get: (v) => `+${v.dfRear}`,     bestBy: "max", unit: "kgf" },
    { l: "Total downforce",       group: "perf",  get: (v) => `+${v.dfTotal}`,    bestBy: "max", unit: "kgf" },
    { l: "L/D ratio",             group: "perf",  get: (v) => v.ld.toFixed(2),    bestBy: "max" },
    { l: "Aero balance · front",  group: "perf",  get: (v) => `${v.balance.toFixed(1)}%`, bestBy: "balance" },
    { l: "Top speed (calc)",      group: "perf",  get: (v) => v.topSpeed,         bestBy: "max", unit: "km/h" },
    { l: "Confidence",            group: "perf",  get: (v) => v.confidence,       bestBy: "none" },

    { l: "Splitter protrusion",   group: "param", get: (v) => v.params.splitter,  bestBy: "none", unit: "mm", isParam: true },
    { l: "Canards",               group: "param", get: (v) => v.params.canards ? "On" : "Off", bestBy: "none", isParam: true },
    { l: "Side skirts",           group: "param", get: (v) => v.params.skirts ? "On" : "Off", bestBy: "none", isParam: true },
    { l: "Wing chord",            group: "param", get: (v) => v.params.wingChord, bestBy: "none", unit: "mm", isParam: true },
    { l: "Wing AoA",              group: "param", get: (v) => v.params.wingAoA.toFixed(1), bestBy: "none", unit: "°", isParam: true },
    { l: "Diffuser angle",        group: "param", get: (v) => v.params.diffAngle.toFixed(1), bestBy: "none", unit: "°", isParam: true },
    { l: "Ride height F",         group: "param", get: (v) => v.params.rideF, bestBy: "none", unit: "mm", isParam: true },
    { l: "Ride height R",         group: "param", get: (v) => v.params.rideR, bestBy: "none", unit: "mm", isParam: true },
  ];

  // Determine which rows to show (changed-only filter for params)
  const visibleRows = rows.filter((r) => {
    if (!changedOnly) return true;
    if (!r.isParam) return true;
    const vals = variants.map((v) => String(r.get(v)));
    return new Set(vals).size > 1;
  });

  // best index per row
  const bestIndexOf = (r: Row): number | null => {
    if (r.bestBy === "none") return null;
    const nums = variants.map((v) => Number(String(r.get(v)).replace(/[^\d.\-]/g, "")));
    if (nums.some(isNaN)) return null;
    if (r.bestBy === "max") return nums.indexOf(Math.max(...nums));
    if (r.bestBy === "min") return nums.indexOf(Math.min(...nums));
    if (r.bestBy === "balance") {
      const dist = nums.map((n) => Math.abs(n - 43));
      return dist.indexOf(Math.min(...dist));
    }
    return null;
  };

  // highlight column
  const highlightCol = (() => {
    if (!highlight) return null;
    let key: "topSpeed" | "trackScore" | "balanceDist";
    const arr = variants.map((v, i) => ({ i, v }));
    if (highlight === "topspeed") return arr.sort((a, b) => b.v.topSpeed - a.v.topSpeed)[0].i;
    if (highlight === "track")    return arr.sort((a, b) => b.v.trackScore - a.v.trackScore)[0].i;
    if (highlight === "balance")  return arr.sort((a, b) => Math.abs(a.v.balance - 43) - Math.abs(b.v.balance - 43))[0].i;
    return null;
  })();

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Compare matrix</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Highlight buttons */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
            <span className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground px-2">Highlight</span>
            {[
              { id: "topspeed" as const, label: "Top speed", icon: Zap },
              { id: "track" as const,    label: "Track",     icon: Trophy },
              { id: "balance" as const,  label: "Balance",   icon: Scale },
            ].map((b) => {
              const Icon = b.icon;
              const active = highlight === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setHighlight(active ? null : b.id)}
                  className={cn(
                    "rounded px-2 py-1 text-mono text-[10px] uppercase tracking-widest flex items-center gap-1 transition-colors",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3 w-3" /> {b.label}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 cursor-pointer">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Changed params only
            </span>
            <Switch checked={changedOnly} onCheckedChange={setChangedOnly} className="data-[state=checked]:bg-primary scale-75" />
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-1/40">
              <th className="text-left text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-4 py-2.5 sticky left-0 bg-surface-1/40">
                Metric
              </th>
              <th className="text-right text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-3 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  Baseline
                </div>
              </th>
              {variants.map((v, i) => (
                <th
                  key={v.id}
                  className={cn(
                    "text-right text-mono text-[10px] uppercase tracking-widest font-normal px-3 py-2.5",
                    VARIANT_COLORS[i],
                    highlightCol === i && "bg-primary/10",
                  )}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", VARIANT_DOTS[i])} />
                    <span className="truncate max-w-[120px]" title={v.name}>{v.name.split(" · ")[0]}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visibleRows.map((r, idx) => {
              const isGroupStart = idx === 0 || visibleRows[idx - 1].group !== r.group;
              const bestIdx = bestIndexOf(r);
              return (
                <>
                  {isGroupStart && (
                    <tr key={`g-${r.group}`} className="bg-surface-1/20">
                      <td colSpan={2 + variants.length} className="px-4 py-1.5 text-mono text-[9px] uppercase tracking-widest text-primary/70">
                        {r.group === "perf" ? "Performance metrics" : "Parameters"}
                      </td>
                    </tr>
                  )}
                  <tr key={r.l} className="hover:bg-surface-1/30 transition-colors">
                    <td className="px-4 py-2 text-foreground/90 sticky left-0 bg-surface-0/80 backdrop-blur">
                      <div className="flex items-center gap-2">
                        {r.l}
                        {r.unit && <span className="text-mono text-[9px] text-muted-foreground">({r.unit})</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-mono tabular-nums text-muted-foreground">
                      {r.l === "Confidence" ? (
                        <span className="text-mono text-[10px] uppercase tracking-widest">{baseline.confidence}</span>
                      ) : String(r.get(baseline))}
                    </td>
                    {variants.map((v, i) => {
                      const val = r.get(v);
                      const isBest = bestIdx === i;
                      const isHighlighted = highlightCol === i;
                      return (
                        <td
                          key={v.id}
                          className={cn(
                            "px-3 py-2 text-right text-mono tabular-nums transition-colors",
                            isHighlighted && "bg-primary/[0.07]",
                            isBest ? "text-primary font-semibold" : "text-foreground",
                          )}
                        >
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {r.l === "Confidence" ? (
                              <span className={cn(
                                "text-[10px] uppercase tracking-widest",
                                v.confidence === "high" && "text-success",
                                v.confidence === "medium" && "text-primary",
                                v.confidence === "low" && "text-warning",
                              )}>
                                {v.confidence}
                              </span>
                            ) : (
                              <span>{val}</span>
                            )}
                            {isBest && <CircleCheck className="h-3 w-3 text-primary" />}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-4 py-2.5 flex items-center justify-between text-mono text-[10px] text-muted-foreground">
        <span>{visibleRows.length} rows · ✓ marks per-metric leader</span>
        <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground -mr-2">
          <Download className="mr-1.5 h-3 w-3" /> CSV
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Overlay visualizations                                             */
/* ─────────────────────────────────────────────────────────────────── */
function OverlayVisualization({ variants }: { variants: Variant[] }) {
  const [overlay, setOverlay] = useState(true);

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Result overlay</h3>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Streamlines · all variants
          </span>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Overlay</span>
          <Switch checked={overlay} onCheckedChange={setOverlay} className="data-[state=checked]:bg-primary scale-90" />
        </label>
      </div>
      <div className="p-4">
        <div className={cn("relative overflow-hidden rounded-md border border-border bg-surface-0", overlay ? "h-[260px]" : "h-[260px]")}>
          <div className="absolute inset-0 grid-bg opacity-30" />
          {overlay ? (
            <svg viewBox="0 0 600 260" className="absolute inset-0 h-full w-full">
              {/* ground */}
              <line x1="20" y1="220" x2="580" y2="220" stroke="hsl(188 95% 55%)" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.4" />
              {/* car body */}
              <path d="M120,210 L160,180 L240,160 L350,155 L430,170 L490,195 L540,210 L120,210 Z"
                fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.6" />
              <path d="M240,160 L300,140 L380,145 L430,160 Z"
                fill="hsl(220 24% 9%)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" opacity="0.5" />
              {/* wing */}
              <path d="M440,140 L535,135 L535,145 L440,150 Z" fill="hsl(188 95% 55% / 0.3)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />

              {/* streamlines per variant */}
              {variants.map((v, i) => {
                const yOffset = i * 6 - (variants.length - 1) * 3;
                const intensity = v.dfTotal / 350;
                return (
                  <g key={v.id} opacity="0.85">
                    {Array.from({ length: 8 }).map((_, k) => {
                      const baseY = 105 + k * 14 + yOffset;
                      const dip = 8 + intensity * 14;
                      return (
                        <path
                          key={k}
                          d={`M20,${baseY} Q160,${baseY - dip * 0.4} 300,${baseY - dip} T580,${baseY - dip * 0.5}`}
                          stroke={VARIANT_FILLS[i]}
                          strokeWidth="0.7"
                          fill="none"
                          opacity="0.55"
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 h-full">
              {variants.map((v, i) => (
                <div key={v.id} className="relative border-r last:border-r-0 border-border/50">
                  <div className="absolute inset-0 grid-bg opacity-25" />
                  <svg viewBox="0 0 200 260" className="absolute inset-0 h-full w-full">
                    <line x1="10" y1="220" x2="190" y2="220" stroke={VARIANT_FILLS[i]} strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4" />
                    <path d="M30,210 L55,180 L100,165 L150,170 L180,210 L30,210 Z" fill="hsl(220 24% 11%)" stroke={VARIANT_FILLS[i]} strokeWidth="0.8" opacity="0.7" />
                    {Array.from({ length: 6 }).map((_, k) => (
                      <path
                        key={k}
                        d={`M10,${110 + k * 18} Q70,${100 + k * 18} 100,${95 + k * 18} T190,${105 + k * 18}`}
                        stroke={VARIANT_FILLS[i]} strokeWidth="0.7" fill="none" opacity="0.6"
                      />
                    ))}
                  </svg>
                  <div className="absolute top-2 left-2 right-2">
                    <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">{v.tag}</div>
                    <div className="text-xs font-medium truncate">{v.name}</div>
                  </div>
                  <div className="absolute bottom-2 left-2 text-mono text-[9px] tabular-nums" style={{ color: VARIANT_FILLS[i] }}>
                    L/D {v.ld.toFixed(2)} · DF {v.dfTotal}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-mono text-[10px]">
          {variants.map((v, i) => (
            <div key={v.id} className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm" style={{ backgroundColor: VARIANT_FILLS[i] }} />
              <span className="text-foreground">{v.name.split(" · ")[0]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Trade-off notes                                                    */
/* ─────────────────────────────────────────────────────────────────── */
function TradeoffNotes({ variants }: { variants: Variant[] }) {
  const sorted = [...variants];
  const bestLD = sorted.sort((a, b) => b.ld - a.ld)[0];
  const lowestDrag = [...variants].sort((a, b) => a.drag - b.drag)[0];
  const mostRear = [...variants].sort((a, b) => a.balance - b.balance)[0];

  const notes = [
    {
      tone: "tip" as const, icon: Sparkles, title: `${bestLD.name} leads efficiency`,
      body: `Best L/D at ${bestLD.ld.toFixed(2)} — it gains ${(bestLD.dfTotal - lowestDrag.dfTotal)} kgf downforce while staying within ${(bestLD.drag - lowestDrag.drag)} kgf of the lowest-drag variant.`,
    },
    {
      tone: "warn" as const, icon: CircleAlert, title: "Track vs top-speed trade-off",
      body: `High-DF variants lose 4–8 km/h top speed compared to baseline. Acceptable on technical tracks; reconsider for ovals or long straights.`,
    },
    {
      tone: "ok" as const, icon: CircleCheck, title: "Balance window holds",
      body: `All compared variants sit between 40–46% front balance — well inside the stable handling window. ${mostRear.name} is the most rear-biased at ${mostRear.balance.toFixed(1)}%.`,
    },
    {
      tone: "tip" as const, icon: Sparkles, title: "Confidence reminder",
      body: `Adjoint-derived variants (e.g. v4) are flagged medium confidence pending a full URANS verification. Promote only after a confirmation run.`,
    },
  ];

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Notes on trade-offs</h3>
        </div>
        <StatusChip tone="medium" size="sm" dot={false}>{notes.length} insights</StatusChip>
      </div>
      <div className="p-3 space-y-2">
        {notes.map((n) => (
          <div key={n.title} className={cn(
            "rounded-md border p-3",
            n.tone === "ok" && "border-success/25 bg-success/5",
            n.tone === "tip" && "border-primary/25 bg-primary/5",
            n.tone === "warn" && "border-warning/25 bg-warning/5",
          )}>
            <div className="flex items-start gap-2.5">
              <n.icon className={cn(
                "h-3.5 w-3.5 shrink-0 mt-0.5",
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
const Compare = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>(["v1", "v3", "v4"]);
  const [objective, setObjective] = useState<Objective>("track");
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [changedOnly, setChangedOnly] = useState(false);

  const variants = selectedIds.map((id) => ALL_VARIANTS.find((v) => v.id === id)!).filter(Boolean);
  const baseline = ALL_VARIANTS[0];

  const onAdd = (id: string) => setSelectedIds((s) => (s.length < 4 ? [...s, id] : s));
  const onRemove = (id: string) => setSelectedIds((s) => (s.length > 2 ? s.filter((x) => x !== id) : s));

  // best variant for promote button
  const promoteBest = useMemo(() => {
    return [...variants].sort((a, b) => scoreFor(b, objective) - scoreFor(a, objective))[0];
  }, [variants, objective]);

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
            <span className="text-foreground">Compare</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone="solver" size="sm">{variants.length} variants</StatusChip>
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm" asChild>
              <Link to="/results"><ArrowUpRight className="mr-2 h-3.5 w-3.5" /> Open results</Link>
            </Button>
            <Button variant="hero" size="sm">
              Promote {promoteBest?.name.split(" · ")[0]} <Check className="ml-2 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 05 · Variant comparison
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Compare variants</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Side-by-side analysis of selected variants. All deltas are computed against the OEM baseline at 200 km/h, 0° yaw, ρ 1.225.
            </p>
          </div>
          <Button variant="glass" size="sm" asChild>
            <Link to="/exports"><Download className="mr-2 h-3.5 w-3.5" /> Export comparison</Link>
          </Button>
        </div>

        {/* Variant selector */}
        <VariantSelector selected={selectedIds} onAdd={onAdd} onRemove={onRemove} />

        {/* Ranked cards */}
        <div className="mt-4">
          <RankedCards variants={variants} baseline={baseline} />
        </div>

        {/* Chart + Objective ranking */}
        <div className="mt-4 grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <DragDfChart variants={variants} allVariants={ALL_VARIANTS} />
          </div>
          <div className="xl:col-span-2">
            <ObjectiveRanking variants={variants} objective={objective} setObjective={setObjective} />
          </div>
        </div>

        {/* Compare table */}
        <div className="mt-4">
          <CompareTable
            variants={variants}
            baseline={baseline}
            changedOnly={changedOnly}
            setChangedOnly={setChangedOnly}
            highlight={highlight}
            setHighlight={setHighlight}
          />
        </div>

        {/* Overlay + notes */}
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <OverlayVisualization variants={variants} />
          </div>
          <div className="xl:col-span-1">
            <TradeoffNotes variants={variants} />
          </div>
        </div>

        {/* Bottom action bar */}
        <div className="mt-6 glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
              <Trophy className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-medium">
                Recommended · {promoteBest?.name}
              </div>
              <div className="text-mono text-[11px] text-muted-foreground">
                Best for {OBJECTIVES.find((o) => o.id === objective)?.label.toLowerCase()} · score {scoreFor(promoteBest, objective)}/100
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="glass" size="sm" asChild>
              <Link to="/results"><Eye className="mr-2 h-3.5 w-3.5" /> View in results</Link>
            </Button>
            <Button variant="glass" size="sm">
              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate as new variant
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/exports">
                Export comparison <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Compare;
