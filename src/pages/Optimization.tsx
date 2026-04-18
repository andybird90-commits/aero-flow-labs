import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ParamSlider } from "@/components/ParamSlider";
import {
  ChevronRight, ArrowRight, Sparkles, Target, Shield, Wrench, Wind,
  Gauge, Trophy, Crown, Zap, Scale, Layers, Play, Pause, Square,
  Sliders, CircleCheck, CircleAlert, ChevronDown, Lightbulb, Crosshair,
  Cpu, Activity, TrendingUp, TrendingDown, Hash, Minus, Plus, Eye,
  ShieldCheck, Info, GitBranch, Lock, Unlock, BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────── */
/*  Types & data                                                       */
/* ─────────────────────────────────────────────────────────────────── */
type Objective = "track" | "topspeed" | "balanced" | "stability" | "rear_grip";

const OBJECTIVES: {
  id: Objective;
  label: string;
  icon: typeof Trophy;
  desc: string;
  weights: { df: number; drag: number; balance: number; stability: number };
}[] = [
  { id: "track",     label: "Track use",            icon: Trophy, desc: "Maximize lap-time downforce within drag budget.",       weights: { df: 60, drag: 15, balance: 15, stability: 10 } },
  { id: "topspeed",  label: "Top speed",            icon: Zap,    desc: "Minimize Cd and frontal-area drag, allow low DF.",       weights: { df: 5,  drag: 75, balance: 10, stability: 10 } },
  { id: "balanced",  label: "Balanced",             icon: Scale,  desc: "Equal-weighted compromise across all metrics.",          weights: { df: 30, drag: 30, balance: 25, stability: 15 } },
  { id: "stability", label: "High-speed stability", icon: Wind,   desc: "Rear-biased load with low drag for long straights.",     weights: { df: 35, drag: 25, balance: 10, stability: 30 } },
  { id: "rear_grip", label: "Rear grip bias",       icon: Target, desc: "Push aero balance rearward for traction-limited cars.",  weights: { df: 45, drag: 15, balance: 30, stability: 10 } },
];

interface Constraints {
  maxDragIncrease: number;     // %
  minGroundClearance: number;  // mm
  maxWingHeight: number;       // mm above roofline
  manufacturability: number;   // 0..100
  roadLegal: boolean;
  balanceTarget: number;       // % front
  balanceTolerance: number;    // ± pp
  speedRange: [number, number];// km/h
  yawRange: [number, number];  // deg
}

const COMPONENTS = [
  { id: "splitter",  label: "Front splitter",  desc: "Adds front load, low drag cost",       road: true,  defaultOn: true  },
  { id: "canards",   label: "Canards",         desc: "Front DF, modest drag, fragile",       road: false, defaultOn: true  },
  { id: "skirts",    label: "Side skirts",     desc: "Seal underbody, no drag cost",         road: true,  defaultOn: true  },
  { id: "wing",      label: "Rear wing (GT)",  desc: "Large rear DF, drag-heavy",            road: false, defaultOn: true  },
  { id: "ducktail",  label: "Ducktail",        desc: "Subtle rear lift kill, road-legal",    road: true,  defaultOn: false },
  { id: "diffuser",  label: "Rear diffuser",   desc: "Underbody DF, low drag",               road: true,  defaultOn: true  },
  { id: "underbody", label: "Flat underbody",  desc: "Critical for diffuser to work",        road: true,  defaultOn: true  },
  { id: "louvers",   label: "Fender louvers",  desc: "Reduces wheel-arch pressure",          road: true,  defaultOn: false },
];

interface Candidate {
  id: string;
  rank: number;
  score: number;       // 0..100 against active objective
  cd: number;
  drag: number;        // kgf
  dfFront: number;
  dfRear: number;
  dfTotal: number;
  ld: number;
  balance: number;     // % front
  topSpeed: number;
  confidence: "low" | "medium" | "high";
  parts: string[];     // component ids enabled
  manufacturability: number; // 0..100
  notes: string;
}

const ALL_CANDIDATES: Candidate[] = [
  {
    id: "C-04A", rank: 1, score: 94, cd: 0.328, drag: 108, dfFront: 138, dfRear: 178, dfTotal: 316,
    ld: 2.93, balance: 43.7, topSpeed: 222, confidence: "high",
    parts: ["splitter", "canards", "skirts", "wing", "diffuser", "underbody"],
    manufacturability: 78,
    notes: "Adjoint-derived geometry · within all constraints · 0.4pp from balance target",
  },
  {
    id: "C-12B", rank: 2, score: 89, cd: 0.336, drag: 110, dfFront: 122, dfRear: 168, dfTotal: 290,
    ld: 2.64, balance: 42.1, topSpeed: 220, confidence: "high",
    parts: ["splitter", "canards", "skirts", "wing", "diffuser", "underbody"],
    manufacturability: 84,
    notes: "Slightly lower DF, simpler wing profile · easier to fabricate · matches manufacturability bias",
  },
  {
    id: "C-21D", rank: 3, score: 86, cd: 0.342, drag: 112, dfFront: 121, dfRear: 163, dfTotal: 284,
    ld: 2.54, balance: 42.6, topSpeed: 218, confidence: "high",
    parts: ["splitter", "canards", "skirts", "wing", "diffuser", "underbody"],
    manufacturability: 81,
    notes: "Mirrors current optimized v3 · validated on URANS · safe baseline pick",
  },
  {
    id: "C-08F", rank: 4, score: 82, cd: 0.334, drag: 110, dfFront: 108, dfRear: 162, dfTotal: 270,
    ld: 2.45, balance: 40.0, topSpeed: 221, confidence: "medium",
    parts: ["splitter", "skirts", "wing", "diffuser", "underbody", "louvers"],
    manufacturability: 71,
    notes: "Drops canards · uses louvers · trades 12 DF for legality and durability",
  },
  {
    id: "C-33C", rank: 5, score: 78, cd: 0.348, drag: 114, dfFront: 105, dfRear: 158, dfTotal: 263,
    ld: 2.31, balance: 39.9, topSpeed: 216, confidence: "medium",
    parts: ["splitter", "canards", "skirts", "wing", "diffuser", "underbody"],
    manufacturability: 68,
    notes: "Aggressive AoA · approaches drag ceiling · medium confidence pending verification",
  },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Small UI helpers                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function NumberField({ label, value, unit, onChange, min, max, step = 1, hint }: {
  label: string; value: number; unit?: string; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="relative flex items-center rounded-md border border-border bg-surface-1">
        <button
          onClick={() => onChange(Math.max(min ?? -Infinity, value - step))}
          className="px-2 py-1.5 text-muted-foreground hover:text-foreground border-r border-border"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="number" value={value} min={min} max={max} step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full bg-transparent px-2 py-1.5 text-mono text-sm text-foreground tabular-nums text-center focus:outline-none"
        />
        <span className="px-2 text-mono text-[10px] text-muted-foreground border-l border-border">{unit}</span>
        <button
          onClick={() => onChange(Math.min(max ?? Infinity, value + step))}
          className="px-2 py-1.5 text-muted-foreground hover:text-foreground border-l border-border"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {hint && <div className="text-mono text-[10px] text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

function ToggleRow({ icon: Icon, label, sub, checked, onChange, locked }: {
  icon: typeof Lock; label: string; sub?: string; checked: boolean;
  onChange: (v: boolean) => void; locked?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center justify-between rounded-md border p-3 transition-colors",
      checked ? "border-primary/30 bg-primary/5" : "border-border bg-surface-1",
      locked && "opacity-60",
    )}>
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className={cn("h-4 w-4 shrink-0", checked ? "text-primary" : "text-muted-foreground")} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{label}</div>
          {sub && <div className="text-mono text-[10px] text-muted-foreground truncate">{sub}</div>}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={locked}
        className="data-[state=checked]:bg-primary"
      />
    </div>
  );
}

function RangeField({ label, value, min, max, unit, onChange }: {
  label: string; value: [number, number]; min: number; max: number; unit?: string;
  onChange: (v: [number, number]) => void;
}) {
  const pctA = ((value[0] - min) / (max - min)) * 100;
  const pctB = ((value[1] - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        <span className="text-mono text-sm tabular-nums">
          {value[0]} – {value[1]}<span className="text-[10px] text-muted-foreground ml-1">{unit}</span>
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-surface-2">
        <div
          className="absolute inset-y-0 rounded-full bg-gradient-primary"
          style={{ left: `${pctA}%`, width: `${pctB - pctA}%` }}
        />
        <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border border-primary bg-background shadow-glow" style={{ left: `${pctA}%` }} />
        <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full border border-primary bg-background shadow-glow" style={{ left: `${pctB}%` }} />
        <input type="range" min={min} max={max} value={value[0]}
          onChange={(e) => onChange([Math.min(Number(e.target.value), value[1] - 1), value[1]])}
          className="absolute inset-0 w-full cursor-pointer opacity-0" />
        <input type="range" min={min} max={max} value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0] + 1)])}
          className="absolute inset-0 w-full cursor-pointer opacity-0" />
      </div>
      <div className="flex justify-between text-mono text-[10px] text-muted-foreground/60">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Card shell                                                         */
/* ─────────────────────────────────────────────────────────────────── */
function Card({ icon: Icon, title, hint, children, action }: {
  icon: typeof Sparkles; title: string; hint?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          {hint && <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">{hint}</span>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Objective selector                                                 */
/* ─────────────────────────────────────────────────────────────────── */
function ObjectiveSelector({ value, onChange }: { value: Objective; onChange: (o: Objective) => void }) {
  const active = OBJECTIVES.find((o) => o.id === value)!;
  return (
    <Card icon={Target} title="Objective" hint="What should the optimizer maximize">
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
        {OBJECTIVES.map((o) => {
          const Icon = o.icon;
          const selected = o.id === value;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              className={cn(
                "rounded-md border p-3 text-left transition-all relative",
                selected ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
              )}
            >
              {selected && (
                <span className="absolute top-2 right-2">
                  <CircleCheck className="h-3.5 w-3.5 text-primary" />
                </span>
              )}
              <Icon className={cn("h-5 w-5 mb-2", selected ? "text-primary" : "text-muted-foreground")} />
              <div className="text-sm font-medium">{o.label}</div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">{o.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Weight visualization */}
      <div className="mt-4 rounded-md border border-border bg-surface-1/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Optimizer weights</span>
          <span className="text-mono text-[10px] text-foreground">{active.label}</span>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="bg-primary"        style={{ width: `${active.weights.df}%` }}        title={`Downforce ${active.weights.df}%`} />
          <div className="bg-warning"        style={{ width: `${active.weights.drag}%` }}      title={`Drag ${active.weights.drag}%`} />
          <div className="bg-primary-glow"   style={{ width: `${active.weights.balance}%` }}   title={`Balance ${active.weights.balance}%`} />
          <div className="bg-success"        style={{ width: `${active.weights.stability}%` }} title={`Stability ${active.weights.stability}%`} />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-mono text-[10px]">
          <Legend dot="bg-primary"      label={`Downforce ${active.weights.df}%`} />
          <Legend dot="bg-warning"      label={`Drag ${active.weights.drag}%`} />
          <Legend dot="bg-primary-glow" label={`Balance ${active.weights.balance}%`} />
          <Legend dot="bg-success"      label={`Stability ${active.weights.stability}%`} />
        </div>
      </div>
    </Card>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-sm", dot)} />
      <span className="text-foreground">{label}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Constraints card                                                   */
/* ─────────────────────────────────────────────────────────────────── */
function ConstraintsCard({ c, setC }: { c: Constraints; setC: (c: Constraints) => void }) {
  return (
    <Card icon={Shield} title="Parameter constraints" hint="Hard limits the optimizer must respect">
      <div className="grid gap-4 lg:grid-cols-2">
        <ParamSlider label="Max drag increase" value={c.maxDragIncrease} min={0} max={30} unit="%" hint="vs baseline"
          onChange={(v) => setC({ ...c, maxDragIncrease: v })} />
        <ParamSlider label="Manufacturability priority" value={c.manufacturability} min={0} max={100} unit="%" hint="prefers simple shapes"
          onChange={(v) => setC({ ...c, manufacturability: v })} />
        <NumberField label="Min ground clearance" value={c.minGroundClearance} unit="mm" min={50} max={150} step={5}
          hint="Floor-to-tarmac at static ride"
          onChange={(v) => setC({ ...c, minGroundClearance: v })} />
        <NumberField label="Max wing height (above roof)" value={c.maxWingHeight} unit="mm" min={0} max={400} step={10}
          hint="0 = wing must stay below roof line"
          onChange={(v) => setC({ ...c, maxWingHeight: v })} />
        <NumberField label="Aero balance target" value={c.balanceTarget} unit="% F" min={30} max={55} step={1}
          hint={`Tolerance ±${c.balanceTolerance} pp`}
          onChange={(v) => setC({ ...c, balanceTarget: v })} />
        <NumberField label="Balance tolerance" value={c.balanceTolerance} unit="pp" min={0.5} max={5} step={0.5}
          hint="Acceptable deviation"
          onChange={(v) => setC({ ...c, balanceTolerance: v })} />
        <RangeField label="Speed range" value={c.speedRange} min={80} max={300} unit=" km/h"
          onChange={(v) => setC({ ...c, speedRange: v })} />
        <RangeField label="Yaw range" value={c.yawRange} min={0} max={15} unit="°"
          onChange={(v) => setC({ ...c, yawRange: v })} />
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <ToggleRow
          icon={c.roadLegal ? BadgeCheck : Unlock}
          label="Road-legal constraints"
          sub={c.roadLegal ? "Filters non-homologated parts (canards, GT wing)" : "Race-only parts allowed"}
          checked={c.roadLegal}
          onChange={(v) => setC({ ...c, roadLegal: v })}
        />
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-1 p-3">
          <div className="flex items-center gap-2.5">
            <Crosshair className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Active constraints</div>
              <div className="text-mono text-[10px] text-muted-foreground">{c.roadLegal ? "8" : "7"} hard · 3 soft</div>
            </div>
          </div>
          <span className="text-mono text-[10px] uppercase tracking-widest rounded border border-success/30 bg-success/10 px-2 py-0.5 text-success">
            Valid
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Components allowed                                                 */
/* ─────────────────────────────────────────────────────────────────── */
function ComponentsCard({ enabled, setEnabled, roadLegal }: {
  enabled: Set<string>; setEnabled: (s: Set<string>) => void; roadLegal: boolean;
}) {
  const toggle = (id: string) => {
    const s = new Set(enabled);
    s.has(id) ? s.delete(id) : s.add(id);
    setEnabled(s);
  };
  return (
    <Card icon={Wrench} title="Allowed aero components" hint={`${enabled.size} of ${COMPONENTS.length} enabled`}
      action={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-mono text-[10px] uppercase tracking-widest text-muted-foreground"
            onClick={() => setEnabled(new Set(COMPONENTS.filter(c => !roadLegal || c.road).map(c => c.id)))}>
            All
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-mono text-[10px] uppercase tracking-widest text-muted-foreground"
            onClick={() => setEnabled(new Set())}>
            None
          </Button>
        </div>
      }>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {COMPONENTS.map((comp) => {
          const isOn = enabled.has(comp.id);
          const blocked = roadLegal && !comp.road;
          return (
            <button
              key={comp.id}
              onClick={() => !blocked && toggle(comp.id)}
              disabled={blocked}
              className={cn(
                "rounded-md border p-3 text-left transition-all relative group",
                blocked
                  ? "border-border bg-surface-1/30 opacity-50 cursor-not-allowed"
                  : isOn
                    ? "border-primary/40 bg-primary/5 hover:bg-primary/10"
                    : "border-border bg-surface-1 hover:border-primary/30",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{comp.label}</div>
                {blocked ? (
                  <Lock className="h-3.5 w-3.5 text-warning shrink-0" />
                ) : isOn ? (
                  <CircleCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded border border-border shrink-0" />
                )}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug">{comp.desc}</div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className={cn(
                  "text-mono text-[9px] uppercase tracking-widest rounded border px-1.5 py-0.5",
                  comp.road ? "border-success/30 text-success" : "border-warning/30 text-warning",
                )}>
                  {comp.road ? "Road OK" : "Race only"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {roadLegal && (
        <div className="mt-3 rounded-md border border-warning/25 bg-warning/5 p-2.5 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Road-legal mode is on. Race-only parts (canards, GT wing) are locked out of the search space.
          </p>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Optimization range / strategy                                      */
/* ─────────────────────────────────────────────────────────────────── */
function StrategyCard({
  strategy, setStrategy, candidatesTarget, setCandidatesTarget, surrogate, setSurrogate,
}: {
  strategy: "adjoint" | "ga" | "bayes"; setStrategy: (s: "adjoint" | "ga" | "bayes") => void;
  candidatesTarget: number; setCandidatesTarget: (n: number) => void;
  surrogate: boolean; setSurrogate: (v: boolean) => void;
}) {
  const strategies = [
    { id: "adjoint" as const, label: "Adjoint sweep",      desc: "Gradient-based · fast convergence · best near a known good design", est: "~ 18 min", cost: "8 cr" },
    { id: "ga"      as const, label: "Genetic algorithm", desc: "Population search · explores diverse topologies · slower",            est: "~ 42 min", cost: "20 cr" },
    { id: "bayes"   as const, label: "Bayesian opt",      desc: "Surrogate-driven · sample-efficient · best for small budgets",        est: "~ 26 min", cost: "12 cr" },
  ];
  return (
    <Card icon={Sliders} title="Optimization range" hint="Search strategy & sample budget">
      <div className="grid gap-2 md:grid-cols-3">
        {strategies.map((s) => {
          const sel = s.id === strategy;
          return (
            <button key={s.id} onClick={() => setStrategy(s.id)}
              className={cn(
                "rounded-md border p-3 text-left transition-all",
                sel ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
              )}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{s.label}</div>
                {sel && <CircleCheck className="h-3.5 w-3.5 text-primary" />}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">{s.desc}</div>
              <div className="mt-2 flex items-center gap-2 text-mono text-[10px] text-muted-foreground">
                <span>{s.est}</span><span className="text-border">·</span><span className="text-warning">{s.cost}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <ParamSlider label="Candidates to evaluate" value={candidatesTarget} min={20} max={500} step={10} unit=""
          hint={`${Math.round(candidatesTarget * 0.6)} surrogate · ${Math.round(candidatesTarget * 0.4)} solver`}
          onChange={setCandidatesTarget} />
        <ToggleRow icon={Cpu} label="Surrogate pre-screen"
          sub="ML model filters candidates before expensive solver runs (recommended)"
          checked={surrogate} onChange={setSurrogate} />
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Job progress                                                       */
/* ─────────────────────────────────────────────────────────────────── */
type JobState = "idle" | "running" | "paused" | "complete";

function JobCard({
  state, setState, progress, candidatesEvaluated, candidatesTarget, eta, residual,
}: {
  state: JobState; setState: (s: JobState) => void;
  progress: number; candidatesEvaluated: number; candidatesTarget: number;
  eta: string; residual: string;
}) {
  const stages = [
    { id: 1, label: "Sampling design space", min: 0,  max: 15 },
    { id: 2, label: "Surrogate pre-screen",  min: 15, max: 35 },
    { id: 3, label: "Solver evaluation",     min: 35, max: 80 },
    { id: 4, label: "Pareto refinement",     min: 80, max: 95 },
    { id: 5, label: "Final ranking",         min: 95, max: 100 },
  ];
  const currentStage = stages.find((s) => progress >= s.min && progress < s.max) ?? stages[stages.length - 1];

  return (
    <Card icon={Activity} title="Optimization job"
      hint={state === "running" ? "RUNNING" : state === "complete" ? "COMPLETE" : state === "paused" ? "PAUSED" : "IDLE"}
      action={
        <div className="flex items-center gap-1.5">
          {state !== "running" && state !== "complete" && (
            <Button size="sm" variant="hero" onClick={() => setState("running")}>
              <Play className="mr-1.5 h-3 w-3" /> {state === "paused" ? "Resume" : "Start"}
            </Button>
          )}
          {state === "running" && (
            <>
              <Button size="sm" variant="glass" onClick={() => setState("paused")}>
                <Pause className="mr-1.5 h-3 w-3" /> Pause
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setState("idle")}>
                <Square className="mr-1.5 h-3 w-3" /> Cancel
              </Button>
            </>
          )}
          {state === "complete" && (
            <StatusChip tone="success" size="sm">Converged</StatusChip>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {currentStage.label}
            </span>
            <span className="text-mono text-[10px] tabular-nums text-foreground">
              {progress.toFixed(1)}% · ETA {eta}
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-surface-2 overflow-hidden">
            <div
              className={cn(
                "absolute inset-y-0 left-0 transition-all duration-500",
                state === "running" ? "bg-gradient-primary" : state === "complete" ? "bg-success" : "bg-muted-foreground/40",
              )}
              style={{ width: `${progress}%` }}
            />
            {state === "running" && (
              <div className="absolute inset-y-0 left-0 bg-primary/20 animate-pulse-soft" style={{ width: `${progress}%` }} />
            )}
          </div>
          {/* Stage markers */}
          <div className="mt-2 flex justify-between text-[9px]">
            {stages.map((s) => (
              <div key={s.id} className="flex flex-col items-center" style={{ width: `${100 / stages.length}%` }}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  progress >= s.max ? "bg-success" : progress >= s.min ? "bg-primary animate-pulse-soft" : "bg-muted-foreground/30",
                )} />
                <span className={cn(
                  "mt-1 text-mono uppercase tracking-widest text-center leading-tight",
                  progress >= s.min ? "text-foreground/80" : "text-muted-foreground/50",
                )}>
                  {s.label.split(" ")[0]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live metrics */}
        <div className="grid gap-2 md:grid-cols-4">
          <Metric label="Candidates" value={`${candidatesEvaluated}`} sub={`/ ${candidatesTarget}`} icon={Hash} />
          <Metric label="Best score" value={state === "idle" ? "—" : "94"}  sub="/ 100" icon={Trophy} tone="primary" />
          <Metric label="Residual"   value={state === "idle" ? "—" : residual} sub="L2 norm" icon={Activity} />
          <Metric label="Wall time"  value={state === "idle" ? "—" : "12 m 18 s"} sub={`ETA ${eta}`} icon={Cpu} />
        </div>

        {/* Live candidate stream */}
        {state !== "idle" && (
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Recent candidates
            </div>
            <div className="rounded-md border border-border bg-surface-1/40 max-h-32 overflow-y-auto">
              {Array.from({ length: 6 }).map((_, i) => {
                const score = (94 - i * 1.2 - (state === "running" ? 0 : 0)).toFixed(1);
                const ld = (2.93 - i * 0.05).toFixed(2);
                return (
                  <div key={i} className="flex items-center justify-between border-b border-border/40 last:border-b-0 px-3 py-1.5 text-mono text-[11px] tabular-nums">
                    <span className="text-muted-foreground">C-{(2186 - i).toString(16).toUpperCase().slice(-3)}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-foreground">L/D <span className="text-primary">{ld}</span></span>
                      <span className="text-foreground">DF <span className="text-success">+{316 - i * 4}</span></span>
                      <span className={cn("rounded px-1.5 py-0.5", i === 0 ? "bg-primary/15 text-primary" : "bg-surface-2 text-foreground")}>
                        {score}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Metric({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string; icon: typeof Hash; tone?: "primary" | "default";
}) {
  return (
    <div className={cn(
      "rounded-md border p-3",
      tone === "primary" ? "border-primary/30 bg-primary/5" : "border-border bg-surface-1/40",
    )}>
      <div className="flex items-center gap-1.5 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={cn("text-mono text-xl font-semibold tabular-nums",
          tone === "primary" ? "text-primary" : "text-foreground")}>
          {value}
        </span>
        {sub && <span className="text-mono text-[10px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Candidate results panel                                            */
/* ─────────────────────────────────────────────────────────────────── */
function CandidateResults({
  candidates, selected, setSelected, baseline,
}: {
  candidates: Candidate[]; selected: string; setSelected: (id: string) => void;
  baseline: { cd: number; drag: number; dfTotal: number; ld: number };
}) {
  return (
    <Card icon={Layers} title="Candidate results" hint={`Top ${candidates.length} of 248 evaluated`}>
      <div className="space-y-2">
        {candidates.map((c) => {
          const sel = c.id === selected;
          const dCd  = ((c.cd - baseline.cd) / baseline.cd) * 100;
          const dLD  = c.ld - baseline.ld;
          const dDF  = c.dfTotal - baseline.dfTotal;
          return (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={cn(
                "w-full text-left rounded-md border p-3 transition-all",
                sel ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
              )}
            >
              <div className="flex items-center gap-3">
                {/* Rank */}
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-mono text-xs font-bold tabular-nums shrink-0",
                  c.rank === 1 ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
                )}>
                  {c.rank === 1 ? <Crown className="h-4 w-4" /> : `#${c.rank}`}
                </div>

                {/* Identity */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-mono text-[11px] text-muted-foreground">{c.id}</span>
                    <ConfidenceBadge level={c.confidence} compact />
                    {c.rank === 1 && (
                      <span className="text-mono text-[9px] uppercase tracking-widest rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-mono text-[11px] tabular-nums">
                    <span className="text-foreground">Cd <span className="text-foreground">{c.cd.toFixed(3)}</span> <DeltaInline v={dCd} pct invert /></span>
                    <span className="text-foreground">L/D <span className="text-primary">{c.ld.toFixed(2)}</span> <DeltaInline v={dLD} dec={2} /></span>
                    <span className="text-foreground">DF <span className="text-success">+{c.dfTotal}</span> <DeltaInline v={dDF} /></span>
                    <span className="text-foreground">Bal <span className="text-foreground">{c.balance.toFixed(1)}%</span></span>
                  </div>
                </div>

                {/* Score */}
                <div className="text-right shrink-0">
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Score</div>
                  <div className={cn("text-mono text-2xl font-semibold tabular-nums", c.rank === 1 ? "text-primary" : "text-foreground")}>
                    {c.score}
                  </div>
                </div>
              </div>

              {/* Score bar */}
              <div className="mt-2.5 relative h-1 rounded-full bg-surface-2 overflow-hidden">
                <div className={cn(
                  "absolute inset-y-0 left-0",
                  c.rank === 1 ? "bg-gradient-to-r from-primary to-primary-glow" : "bg-muted-foreground/40",
                )} style={{ width: `${c.score}%` }} />
              </div>

              {/* Component chips */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1">
                {c.parts.map((p) => {
                  const comp = COMPONENTS.find((x) => x.id === p)!;
                  return (
                    <span key={p} className="text-mono text-[9px] uppercase tracking-widest rounded border border-border/60 bg-surface-2/40 px-1.5 py-0.5 text-muted-foreground">
                      {comp?.label ?? p}
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function DeltaInline({ v, pct, invert, dec = 1 }: { v: number; pct?: boolean; invert?: boolean; dec?: number }) {
  const better = invert ? v < 0 : v > 0;
  const tone = v === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Icon = v === 0 ? Minus : better ? (invert ? TrendingDown : TrendingUp) : (invert ? TrendingUp : TrendingDown);
  const text = `${v > 0 ? "+" : ""}${v.toFixed(dec)}${pct ? "%" : ""}`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] ml-0.5", tone)}>
      <Icon className="h-2.5 w-2.5" />{text}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Best solution summary                                              */
/* ─────────────────────────────────────────────────────────────────── */
function BestSolution({ candidate, baseline, objective }: {
  candidate: Candidate; baseline: { cd: number; drag: number; dfTotal: number; ld: number };
  objective: Objective;
}) {
  const obj = OBJECTIVES.find((o) => o.id === objective)!;
  const dCd = ((candidate.cd - baseline.cd) / baseline.cd) * 100;
  const dDrag = ((candidate.drag - baseline.drag) / baseline.drag) * 100;
  const dDF = candidate.dfTotal - baseline.dfTotal;
  const dLD = candidate.ld - baseline.ld;

  const reasons = [
    { icon: Trophy,   text: `Highest objective score for ${obj.label.toLowerCase()} — ${candidate.score}/100, beating #2 by 5 points.` },
    { icon: Shield,   text: `Sits inside all hard constraints — drag +${dDrag.toFixed(1)}% under ${obj.label.toLowerCase()} budget, balance 0.4 pp from target.` },
    { icon: Sparkles, text: `Adjoint search converged near a smooth local optimum — surrogate variance on Cd is below 1.4%.` },
    { icon: Wrench,   text: `Manufacturability ${candidate.manufacturability}/100 — feasible with stock GT wing profile and 2-axis CNC splitter.` },
  ];

  return (
    <Card icon={Crown} title="Best solution"
      hint={`${candidate.id} · score ${candidate.score}/100`}
      action={<ConfidenceBadge level={candidate.confidence} compact />}
    >
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Visual / metrics */}
        <div className="lg:col-span-2">
          <div className="relative h-[180px] rounded-md border border-border bg-surface-0 overflow-hidden">
            <div className="absolute inset-0 grid-bg opacity-30" />
            <svg viewBox="0 0 320 180" className="absolute inset-0 h-full w-full">
              <line x1="20" y1="150" x2="300" y2="150" stroke="hsl(188 95% 55%)" strokeWidth="0.4" strokeDasharray="3 4" opacity="0.4" />
              <path d="M70,140 L95,118 L155,105 L220,108 L260,125 L290,140 L70,140 Z"
                fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.7" />
              <path d="M155,105 L195,90 L240,98 L260,108 Z" fill="hsl(220 24% 9%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.5" />
              <path d="M70,144 L100,144 L106,148 L70,148 Z" fill="hsl(188 95% 55% / 0.4)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
              <path d="M255,148 L290,135 L290,150 L255,150 Z" fill="hsl(188 95% 55% / 0.4)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" />
              <path d="M245,90 L295,86 L295,94 L245,98 Z" fill="hsl(188 95% 55% / 0.5)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" />
              {Array.from({ length: 5 }).map((_, k) => (
                <path key={k} d={`M20,${65 + k * 12} Q150,${60 + k * 12} 300,${60 + k * 12}`}
                  stroke="hsl(188 95% 55%)" strokeWidth="0.5" fill="none" opacity={0.5 - k * 0.06} />
              ))}
            </svg>
            <div className="absolute top-2 left-2 text-mono text-[10px] uppercase tracking-widest text-primary/80">{candidate.id}</div>
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-mono text-[10px]">
              <span className="text-muted-foreground">streamlines · preview</span>
              <span className="text-foreground">{candidate.parts.length} parts</span>
            </div>
          </div>

          {/* Hero metrics */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <HeroStat l="L/D ratio" v={candidate.ld.toFixed(2)} delta={dLD} dec={2} />
            <HeroStat l="Total DF" v={`+${candidate.dfTotal}`} u="kgf" delta={dDF} />
            <HeroStat l="Drag" v={`${candidate.drag}`} u="kgf" delta={dDrag} pct invert />
            <HeroStat l="Cd" v={candidate.cd.toFixed(3)} delta={dCd} pct invert />
          </div>
        </div>

        {/* Why this was chosen */}
        <div className="lg:col-span-3 space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">Why this was chosen</h4>
            </div>
            <ul className="space-y-2">
              {reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-md border border-border bg-surface-1/40 p-2.5">
                  <r.icon className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground/90 leading-relaxed">{r.text}</p>
                </li>
              ))}
            </ul>
          </div>

          {/* Confidence + assumptions */}
          <div className="rounded-md border border-border bg-surface-1/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-success" />
              <h4 className="text-sm font-semibold">Confidence &amp; assumptions</h4>
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
              <li className="flex items-start gap-2">
                <CircleCheck className="h-3 w-3 text-success shrink-0 mt-0.5" />
                <span>Solver-validated · k-ω SST · steady-state · residual converged at 8.2e-5.</span>
              </li>
              <li className="flex items-start gap-2">
                <CircleCheck className="h-3 w-3 text-success shrink-0 mt-0.5" />
                <span>Yaw-swept across {2}° increments — performance holds within 6% degradation at +6° yaw.</span>
              </li>
              <li className="flex items-start gap-2">
                <CircleAlert className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                <span>Wheel rotation modelled as MRF (simplified). Real degradation may be 3–5% higher on rear DF.</span>
              </li>
              <li className="flex items-start gap-2">
                <CircleAlert className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                <span>Driver and tyre deformation not modelled — affects underbody clearance estimate by ±5 mm.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}

function HeroStat({ l, v, u, delta, pct, invert, dec = 1 }: {
  l: string; v: string; u?: string; delta: number; pct?: boolean; invert?: boolean; dec?: number;
}) {
  const better = invert ? delta < 0 : delta > 0;
  const tone = delta === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Icon = delta === 0 ? Minus : better ? (invert ? TrendingDown : TrendingUp) : (invert ? TrendingUp : TrendingDown);
  return (
    <div className="rounded-md border border-border bg-surface-1/60 p-3">
      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{l}</div>
      <div className="mt-1 flex items-baseline justify-between">
        <div className="flex items-baseline gap-1">
          <span className="text-mono text-lg font-semibold tabular-nums">{v}</span>
          {u && <span className="text-mono text-[10px] text-muted-foreground">{u}</span>}
        </div>
        <span className={cn("inline-flex items-center gap-0.5 text-mono text-[10px]", tone)}>
          <Icon className="h-3 w-3" />
          {delta > 0 ? "+" : ""}{delta.toFixed(dec)}{pct ? "%" : ""}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const baseline = { cd: 0.366, drag: 116, dfTotal: -22, ld: -0.19 };

const Optimization = () => {
  const [objective, setObjective] = useState<Objective>("track");
  const [strategy, setStrategy] = useState<"adjoint" | "ga" | "bayes">("adjoint");
  const [candidatesTarget, setCandidatesTarget] = useState(248);
  const [surrogate, setSurrogate] = useState(true);
  const [constraints, setConstraints] = useState<Constraints>({
    maxDragIncrease: 8,
    minGroundClearance: 90,
    maxWingHeight: 0,
    manufacturability: 60,
    roadLegal: false,
    balanceTarget: 43,
    balanceTolerance: 2,
    speedRange: [120, 240],
    yawRange: [0, 6],
  });
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(COMPONENTS.filter((c) => c.defaultOn).map((c) => c.id)),
  );

  const [jobState, setJobState] = useState<JobState>("complete");
  const [progress, setProgress] = useState(100);

  // animate progress when running
  useEffect(() => {
    if (jobState !== "running") return;
    const t = setInterval(() => {
      setProgress((p) => {
        const next = Math.min(100, p + 0.6);
        if (next >= 100) {
          setJobState("complete");
          return 100;
        }
        return next;
      });
    }, 120);
    return () => clearInterval(t);
  }, [jobState]);

  // restart progress when starting
  useEffect(() => {
    if (jobState === "running" && progress >= 100) setProgress(0);
  }, [jobState, progress]);

  const candidatesEvaluated = Math.round((progress / 100) * candidatesTarget);
  const eta = jobState === "complete" ? "0s" : jobState === "idle" ? "—" : `${Math.max(1, Math.round((100 - progress) / 6))} min`;

  const candidates = ALL_CANDIDATES;
  const [selectedCandidateId, setSelectedCandidateId] = useState(candidates[0].id);
  const selectedCandidate = candidates.find((c) => c.id === selectedCandidateId)!;

  // when road-legal is on, prune disallowed components
  const filteredEnabled = useMemo(() => {
    if (!constraints.roadLegal) return enabled;
    const s = new Set<string>();
    enabled.forEach((id) => {
      const c = COMPONENTS.find((x) => x.id === id);
      if (c && c.road) s.add(id);
    });
    return s;
  }, [enabled, constraints.roadLegal]);

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
            <span className="text-foreground">Optimization</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone="solver" size="sm">
              <Sparkles className="mr-1 h-3 w-3" /> Adjoint solver
            </StatusChip>
            <StatusChip tone="warning" size="sm">{strategy === "ga" ? "20" : strategy === "bayes" ? "12" : "8"} cr est.</StatusChip>
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm" asChild>
              <Link to="/simulation"><Gauge className="mr-2 h-3.5 w-3.5" /> Manual setup</Link>
            </Button>
            <Button variant="hero" size="sm" disabled={jobState !== "complete"}>
              <BadgeCheck className="mr-2 h-3.5 w-3.5" /> Apply best to build
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 03b · AI optimization
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Optimize aero package</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              The optimizer searches the parameter space across enabled components, respecting your hard constraints,
              and returns the best-scoring candidates for your chosen objective.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="glass" size="sm">
              <GitBranch className="mr-2 h-3.5 w-3.5" /> Save preset
            </Button>
          </div>
        </div>

        {/* Setup section */}
        <div className="space-y-4">
          <ObjectiveSelector value={objective} onChange={setObjective} />

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ConstraintsCard c={constraints} setC={setConstraints} />
            </div>
            <div className="xl:col-span-1">
              <ComponentsCard
                enabled={filteredEnabled}
                setEnabled={setEnabled}
                roadLegal={constraints.roadLegal}
              />
            </div>
          </div>

          <StrategyCard
            strategy={strategy} setStrategy={setStrategy}
            candidatesTarget={candidatesTarget} setCandidatesTarget={setCandidatesTarget}
            surrogate={surrogate} setSurrogate={setSurrogate}
          />
        </div>

        {/* Run section */}
        <div className="mt-6 space-y-4">
          <JobCard
            state={jobState} setState={setJobState}
            progress={progress}
            candidatesEvaluated={candidatesEvaluated}
            candidatesTarget={candidatesTarget}
            eta={eta}
            residual="8.2e-5"
          />
        </div>

        {/* Results section */}
        {jobState === "complete" && (
          <div className="mt-6 space-y-4">
            <BestSolution candidate={selectedCandidate} baseline={baseline} objective={objective} />

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <CandidateResults
                  candidates={candidates}
                  selected={selectedCandidateId}
                  setSelected={setSelectedCandidateId}
                  baseline={baseline}
                />
              </div>
              <div className="xl:col-span-1">
                <Card icon={Lightbulb} title="Recommendations" hint="Next steps">
                  <ul className="space-y-2">
                    {[
                      { tone: "tip" as const, icon: Sparkles,
                        title: "Promote C-04A to current variant",
                        body: "It's the highest scoring candidate within all your constraints. Promoting will create a new variant on this build." },
                      { tone: "tip" as const, icon: Eye,
                        title: "Inspect top 3 in Compare",
                        body: "View C-04A, C-12B and C-21D side-by-side to weigh manufacturability vs raw performance." },
                      { tone: "warn" as const, icon: CircleAlert,
                        title: "Run URANS verification",
                        body: "Adjoint estimates can drift on the rear wing in dirty air. A 3,000-iter unsteady run will validate." },
                    ].map((n) => (
                      <li key={n.title} className={cn(
                        "rounded-md border p-3",
                        n.tone === "tip" && "border-primary/25 bg-primary/5",
                        n.tone === "warn" && "border-warning/25 bg-warning/5",
                      )}>
                        <div className="flex items-start gap-2.5">
                          <n.icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5",
                            n.tone === "tip" && "text-primary",
                            n.tone === "warn" && "text-warning",
                          )} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{n.title}</div>
                            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{n.body}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>

            {/* Bottom action bar */}
            <div className="glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
                  <Crown className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-medium">
                    Recommended · {selectedCandidate.id} · score {selectedCandidate.score}/100
                  </div>
                  <div className="text-mono text-[11px] text-muted-foreground">
                    L/D {selectedCandidate.ld.toFixed(2)} · DF +{selectedCandidate.dfTotal} kgf · {selectedCandidate.confidence} confidence
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="glass" size="sm" asChild>
                  <Link to="/compare"><Eye className="mr-2 h-3.5 w-3.5" /> Compare top 3</Link>
                </Button>
                <Button variant="glass" size="sm" asChild>
                  <Link to="/results"><Gauge className="mr-2 h-3.5 w-3.5" /> Inspect candidate</Link>
                </Button>
                <Button variant="hero" size="sm" asChild>
                  <Link to="/build">
                    Apply to build <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Optimization;
