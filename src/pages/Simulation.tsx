import { Link } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ParamSlider } from "@/components/ParamSlider";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { JobProgress } from "@/components/JobProgress";
import {
  ChevronRight, ChevronLeft, ArrowRight, PlayCircle, ListPlus, X, Plus,
  Wind, Gauge, Target, ShieldCheck, Server, Clock, Cpu, Database, Zap,
  Thermometer, CloudFog, Compass, Layers, Box, AlertTriangle, Info,
  CircleDot, Settings2, FileCheck2, Coins, Sparkles, Activity, RotateCcw,
  TrendingUp, ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────── */
/*  Mode definitions                                                   */
/* ─────────────────────────────────────────────────────────────────── */
type Mode = "preview" | "full" | "optim";

const MODES: {
  id: Mode; label: string; sub: string; icon: typeof Wind;
  runtime: string; cost: string; cells: string; confidence: "low" | "medium" | "high" | "optimized";
  tone: "warning" | "primary" | "success"; tag: string;
}[] = [
  {
    id: "preview", label: "Preview Estimate", sub: "Surrogate model · seconds",
    icon: Sparkles, runtime: "≈ 8 s", cost: "0.05 cr", cells: "ROM",
    confidence: "low", tone: "warning", tag: "Surrogate",
  },
  {
    id: "full",    label: "Full Simulation", sub: "Solver-backed CFD · single point",
    icon: Server,  runtime: "≈ 18 min", cost: "12 cr",  cells: "1.84M",
    confidence: "high", tone: "primary", tag: "RANS · k-ω SST",
  },
  {
    id: "optim",   label: "Optimization Run", sub: "DOE sweep · multi-point",
    icon: TrendingUp, runtime: "≈ 3 h 40 min", cost: "120 cr", cells: "1.84M × 16",
    confidence: "optimized", tone: "success", tag: "Adjoint · 16 designs",
  },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Section card                                                       */
/* ─────────────────────────────────────────────────────────────────── */
function SectionCard({
  icon: Icon, title, sub, right, children,
}: {
  icon: typeof Wind; title: string; sub?: string;
  right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
            {sub && <div className="text-mono text-[10px] text-muted-foreground truncate">{sub}</div>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Field row helpers                                                  */
/* ─────────────────────────────────────────────────────────────────── */
function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        {hint && <span className="text-mono text-[10px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="inline-flex w-full items-center gap-0.5 rounded-md border border-border bg-surface-1 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex-1 rounded px-2.5 py-1.5 text-mono text-[10px] uppercase tracking-widest transition-colors",
            value === o.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  value, onChange, suffix, step = 1,
}: { value: number; onChange: (v: number) => void; suffix?: string; step?: number }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 h-9 focus-within:border-primary/40">
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-transparent text-mono text-sm tabular-nums text-foreground outline-none"
      />
      {suffix && <span className="text-mono text-[10px] text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  );
}

function ToggleRow({
  label, sub, checked, onChange,
}: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2.5">
      <div className="min-w-0 pr-3">
        <div className="text-sm">{label}</div>
        {sub && <div className="text-mono text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="data-[state=checked]:bg-primary" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Mode selector                                                      */
/* ─────────────────────────────────────────────────────────────────── */
function ModeSelector({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = m.id === value;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              "group relative overflow-hidden rounded-xl border p-4 text-left transition-all",
              active
                ? "border-primary/50 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.25),0_8px_30px_-12px_hsl(var(--primary)/0.4)]"
                : "border-border bg-surface-1 hover:border-primary/30 hover:bg-surface-2/60",
            )}
          >
            {active && (
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
            )}
            <div className="flex items-start justify-between">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md border",
                active ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface-2 text-muted-foreground",
              )}>
                <Icon className="h-4 w-4" />
              </div>
              <StatusChip tone={m.tone} size="sm" dot={false}>{m.tag}</StatusChip>
            </div>
            <div className="mt-3">
              <div className="text-base font-semibold tracking-tight">{m.label}</div>
              <div className="text-mono text-[11px] text-muted-foreground mt-0.5">{m.sub}</div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-mono text-[10px] tabular-nums">
              <div>
                <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Runtime</div>
                <div className="text-foreground mt-0.5">{m.runtime}</div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Cost</div>
                <div className="text-foreground mt-0.5">{m.cost}</div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Cells</div>
                <div className="text-foreground mt-0.5">{m.cells}</div>
              </div>
            </div>
            {m.id === "preview" && (
              <div className="mt-3 flex items-start gap-1.5 text-mono text-[10px] text-warning leading-relaxed">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>Surrogate estimate · use for iteration, not final commit</span>
              </div>
            )}
            {m.id === "full" && (
              <div className="mt-3 flex items-start gap-1.5 text-mono text-[10px] text-primary leading-relaxed">
                <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5" />
                <span>Solver-backed result · publishable confidence</span>
              </div>
            )}
            {m.id === "optim" && (
              <div className="mt-3 flex items-start gap-1.5 text-mono text-[10px] text-success leading-relaxed">
                <ArrowUpRight className="h-3 w-3 shrink-0 mt-0.5" />
                <span>16-design DOE · returns Pareto frontier</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Speed sweep editor                                                 */
/* ─────────────────────────────────────────────────────────────────── */
function SpeedSweep({ points, setPoints }: { points: number[]; setPoints: (p: number[]) => void }) {
  const add = () => setPoints([...points, Math.min(320, (points[points.length - 1] ?? 100) + 40)]);
  const remove = (i: number) => setPoints(points.filter((_, j) => j !== i));
  const update = (i: number, v: number) => setPoints(points.map((p, j) => j === i ? v : p));

  return (
    <div className="space-y-2">
      {points.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground w-8">P{i + 1}</span>
          <div className="flex-1">
            <NumberField value={p} onChange={(v) => update(i, v)} suffix="km/h" />
          </div>
          {points.length > 1 && (
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => remove(i)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="w-full justify-center text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/40">
        <Plus className="mr-2 h-3.5 w-3.5" /> Add speed point
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Objective selector                                                 */
/* ─────────────────────────────────────────────────────────────────── */
type Objective = "topspeed" | "track" | "balanced" | "stability" | "rear" | "custom";

const OBJECTIVES: { id: Objective; label: string; sub: string; icon: typeof Wind; weights: { df: number; dr: number; bal: number; stab: number } }[] = [
  { id: "topspeed",  label: "Top speed",            sub: "Min Cd · trim DF",   icon: Wind,        weights: { df: 10, dr: 70, bal: 5,  stab: 15 } },
  { id: "track",     label: "Track day",            sub: "Max grip · usable",  icon: Gauge,       weights: { df: 60, dr: 10, bal: 20, stab: 10 } },
  { id: "balanced",  label: "Balanced",             sub: "DF/Drag · 50/50",    icon: Target,      weights: { df: 35, dr: 35, bal: 20, stab: 10 } },
  { id: "stability", label: "High-speed stability", sub: "Yaw resistance",     icon: ShieldCheck, weights: { df: 25, dr: 30, bal: 15, stab: 30 } },
  { id: "rear",      label: "Rear grip bias",       sub: "Front share ≤ 38%",  icon: ArrowUpRight,weights: { df: 50, dr: 10, bal: 30, stab: 10 } },
  { id: "custom",    label: "Custom weighted",      sub: "User-defined",       icon: Settings2,   weights: { df: 30, dr: 30, bal: 20, stab: 20 } },
];

function ObjectiveSelector({ value, onChange }: { value: Objective; onChange: (v: Objective) => void }) {
  const active = OBJECTIVES.find(o => o.id === value)!;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {OBJECTIVES.map((o) => {
          const Icon = o.icon;
          const isOn = o.id === value;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              className={cn(
                "rounded-md border p-2.5 text-left transition-all",
                isOn
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-surface-1 hover:border-primary/30",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-3.5 w-3.5 shrink-0", isOn ? "text-primary" : "text-muted-foreground")} />
                <div className="text-sm font-medium truncate">{o.label}</div>
              </div>
              <div className="mt-1 text-mono text-[10px] text-muted-foreground truncate">{o.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Weights bar */}
      <div className="rounded-md border border-border bg-surface-1 p-3">
        <div className="flex items-center justify-between text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          <span>Objective weights</span>
          {value === "custom" ? <span className="text-primary">editable</span> : <span>locked preset</span>}
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="bg-primary"        style={{ width: `${active.weights.df}%` }}   title={`DF ${active.weights.df}%`} />
          <div className="bg-warning"        style={{ width: `${active.weights.dr}%` }}   title={`Drag ${active.weights.dr}%`} />
          <div className="bg-success"        style={{ width: `${active.weights.bal}%` }}  title={`Balance ${active.weights.bal}%`} />
          <div className="bg-primary-glow"   style={{ width: `${active.weights.stab}%` }} title={`Stability ${active.weights.stab}%`} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-mono text-[10px]">
          {[
            { l: "Downforce", v: active.weights.df,  c: "bg-primary" },
            { l: "Drag",      v: active.weights.dr,  c: "bg-warning" },
            { l: "Balance",   v: active.weights.bal, c: "bg-success" },
            { l: "Stability", v: active.weights.stab,c: "bg-primary-glow" },
          ].map((w) => (
            <div key={w.l} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-sm", w.c)} />
              <span className="text-muted-foreground">{w.l}</span>
              <span className="ml-auto text-foreground tabular-nums">{w.v}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Simulation = () => {
  const [mode, setMode] = useState<Mode>("full");
  const [speeds, setSpeeds] = useState<number[]>([120, 200, 260]);
  const [yaw, setYaw] = useState(0);
  const [density, setDensity] = useState(1.225);
  const [temp, setTemp] = useState(20);
  const [pressure, setPressure] = useState(1013);
  const [wind, setWind] = useState<"calm" | "gust" | "head" | "cross">("calm");
  const [ground, setGround] = useState<"static" | "moving" | "porous">("moving");

  const [rideF, setRideF] = useState(78);
  const [rideR, setRideR] = useState(82);
  const [rotWheels, setRotWheels] = useState(true);
  const [underbody, setUnderbody] = useState(true);
  const [steady, setSteady] = useState(true);

  const [objective, setObjective] = useState<Objective>("track");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(34);

  const activeMode = MODES.find(m => m.id === mode)!;

  return (
    <AppLayout>
      {/* Sticky workspace header */}
      <div className="sticky top-14 z-20 border-b border-border bg-surface-0/80 backdrop-blur">
        <div className="px-6 py-3 flex flex-wrap items-center gap-3">
          <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest">
            <Link to="/garage" className="text-muted-foreground hover:text-foreground transition-colors">Garage</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <Link to="/build" className="text-muted-foreground hover:text-foreground transition-colors">GR86 Track Build</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-foreground">Simulation</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone={activeMode.tone} size="sm">{activeMode.tag}</StatusChip>
            <ConfidenceBadge level={activeMode.confidence} compact />
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm" asChild>
              <Link to="/parts"><ChevronLeft className="mr-2 h-3.5 w-3.5" /> Aero parts</Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/results">Continue to Results <ArrowRight className="ml-2 h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 03 · Solver setup
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Simulation Setup</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Define the operating envelope, vehicle state and objective. Each variant runs as an independent CFD
              job on the cluster — pick a mode that matches the decision you need to make.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-1/60 px-3 py-2">
            <div className="leading-tight">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Variant</div>
              <div className="text-mono text-[11px] text-foreground">Optimized Package v3</div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="leading-tight">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Mesh</div>
              <div className="text-mono text-[11px] text-foreground">1.84M · solver-ready</div>
            </div>
          </div>
        </div>

        {/* Mode selector */}
        <ModeSelector value={mode} onChange={setMode} />

        {/* Main 12-col layout */}
        <div className="mt-5 grid gap-4 xl:grid-cols-12">
          {/* Left column — settings (8) */}
          <div className="xl:col-span-8 space-y-4">
            {/* Environment */}
            <SectionCard
              icon={CloudFog}
              title="Environment"
              sub="Free-stream conditions"
              right={<StatusChip tone="primary" size="sm" dot={false}>ISA · sea level</StatusChip>}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <FieldRow label="Speed points" hint={`${speeds.length} ${speeds.length === 1 ? "point" : "points"}`}>
                    <SpeedSweep points={speeds} setPoints={setSpeeds} />
                  </FieldRow>
                </div>

                <FieldRow label="Yaw angle" hint="±12° max">
                  <ParamSlider label="" value={yaw} min={-12} max={12} onChange={setYaw} unit="°" />
                </FieldRow>

                <FieldRow label="Air density (ρ)" hint="1.225 ISA">
                  <NumberField value={density} step={0.001} onChange={setDensity} suffix="kg/m³" />
                </FieldRow>

                <FieldRow label="Temperature" hint="ambient">
                  <NumberField value={temp} onChange={setTemp} suffix="°C" />
                </FieldRow>

                <FieldRow label="Pressure" hint="static">
                  <NumberField value={pressure} onChange={setPressure} suffix="hPa" />
                </FieldRow>

                <FieldRow label="Wind condition">
                  <Segmented<typeof wind>
                    value={wind}
                    onChange={setWind}
                    options={[
                      { id: "calm",  label: "Calm" },
                      { id: "head",  label: "Headwind" },
                      { id: "gust",  label: "Gust" },
                      { id: "cross", label: "Crosswind" },
                    ]}
                  />
                </FieldRow>

                <FieldRow label="Ground plane">
                  <Segmented<typeof ground>
                    value={ground}
                    onChange={setGround}
                    options={[
                      { id: "static", label: "Static" },
                      { id: "moving", label: "Moving belt" },
                      { id: "porous", label: "Porous" },
                    ]}
                  />
                </FieldRow>
              </div>
            </SectionCard>

            {/* Vehicle */}
            <SectionCard
              icon={Box}
              title="Vehicle state"
              sub="Geometry assumptions for this run"
              right={<StatusChip tone="success" size="sm" dot={false}>Geometry locked</StatusChip>}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <FieldRow label="Ride height · front" hint="OEM 100">
                  <ParamSlider label="" value={rideF} min={40} max={140} onChange={setRideF} unit=" mm" />
                </FieldRow>
                <FieldRow label="Ride height · rear" hint="OEM 110">
                  <ParamSlider label="" value={rideR} min={40} max={140} onChange={setRideR} unit=" mm" />
                </FieldRow>
                <ToggleRow
                  label="Wheel rotation"
                  sub={rotWheels ? "MRF · ω derived from U∞" : "Static walls · faster, lower fidelity"}
                  checked={rotWheels}
                  onChange={setRotWheels}
                />
                <ToggleRow
                  label="Detailed underbody"
                  sub={underbody ? "Closed approximation · −4% Cl confidence" : "Smoothed plate · fastest"}
                  checked={underbody}
                  onChange={setUnderbody}
                />
                <ToggleRow
                  label="Steady-state solver"
                  sub={steady ? "RANS · k-ω SST · converge to residuals" : "URANS · time-averaged · 4× cost"}
                  checked={steady}
                  onChange={setSteady}
                />
                <div className="rounded-md border border-border bg-surface-1 px-3 py-2.5 flex items-center justify-between">
                  <div className="leading-tight">
                    <div className="text-sm">Reference area</div>
                    <div className="text-mono text-[10px] text-muted-foreground">Auto · frontal projection</div>
                  </div>
                  <div className="text-mono text-sm tabular-nums text-foreground">1.98 m²</div>
                </div>
              </div>
            </SectionCard>

            {/* Objective */}
            <SectionCard
              icon={Target}
              title="Objective"
              sub="What the solver should optimise toward"
              right={<StatusChip tone="primary" size="sm" dot={false}>{OBJECTIVES.find(o => o.id === objective)?.label}</StatusChip>}
            >
              <ObjectiveSelector value={objective} onChange={setObjective} />
            </SectionCard>

            {/* Assumptions */}
            <SectionCard
              icon={FileCheck2}
              title="Assumptions & honest disclosures"
              sub="Inherited from geometry validation"
            >
              <ul className="space-y-2 text-sm">
                {[
                  { ok: true,  k: "Symmetry plane",        v: "Half-body Y+ mirror · 2× speedup" },
                  { ok: true,  k: "Turbulence model",      v: "k-ω SST · y+ avg 2.3" },
                  { ok: false, k: "Underbody simplification", v: "Diffuser tunnel approximated · ±4% Cl" },
                  { ok: true,  k: "Cooling flow",          v: "Modelled as porous medium" },
                  { ok: false, k: "Rolling resistance",    v: "Excluded · pure aero forces only" },
                  { ok: true,  k: "Convergence target",    v: "Residuals < 1e-4 · forces stable 200 it." },
                ].map((a) => (
                  <li key={a.k} className="flex items-start gap-2.5 rounded-md border border-border bg-surface-1 px-3 py-2.5">
                    {a.ok
                      ? <CircleDot className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{a.k}</div>
                      <div className="text-mono text-[10px] text-muted-foreground mt-0.5">{a.v}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          {/* Right column — run panel + queue + cost (4) */}
          <aside className="xl:col-span-4 space-y-4">
            {/* Run summary / launch */}
            <div className="glass-strong rounded-xl overflow-hidden">
              <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold tracking-tight">Run summary</h3>
                </div>
                <StatusChip tone={activeMode.tone} size="sm">{activeMode.tag}</StatusChip>
              </div>

              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { l: "Mode",        v: activeMode.label,    icon: Sparkles },
                    { l: "Est. runtime",v: activeMode.runtime,  icon: Clock },
                    { l: "Mesh cells",  v: activeMode.cells,    icon: Layers },
                    { l: "Speed pts",   v: `${speeds.length}`,  icon: Wind },
                  ].map((s) => {
                    const Ic = s.icon;
                    return (
                      <div key={s.l} className="rounded-md border border-border bg-surface-1 p-2.5">
                        <div className="flex items-center gap-1.5 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          <Ic className="h-3 w-3" /> {s.l}
                        </div>
                        <div className="mt-1 text-mono text-sm tabular-nums text-foreground truncate">{s.v}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Confidence + preview/solver disclosure */}
                <div className={cn(
                  "rounded-md border p-3",
                  mode === "preview" ? "border-warning/30 bg-warning/5" :
                  mode === "full"    ? "border-primary/30 bg-primary/5" :
                                        "border-success/30 bg-success/5",
                )}>
                  <div className="flex items-start gap-2.5">
                    {mode === "preview"
                      ? <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                      : <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {mode === "preview" && "Surrogate preview · approximate"}
                        {mode === "full"    && "Solver-backed result · publishable"}
                        {mode === "optim"   && "Optimization sweep · Pareto frontier"}
                      </div>
                      <div className="text-mono text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        {mode === "preview" && "Returned from the trained ROM in seconds. Use to iterate on parameters; do not commit a variant on preview alone."}
                        {mode === "full"    && "Full RANS solve on the cluster. Forces and pressure fields suitable for design freeze and reporting."}
                        {mode === "optim"   && "Runs 16 design variants in parallel. Returns convergent designs along the chosen objective frontier."}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <ConfidenceBadge level={activeMode.confidence} compact />
                    <span className="text-mono text-[10px] text-muted-foreground">
                      {mode === "preview" ? "ROM v4.2 · trained on 1240 runs" : mode === "full" ? "OpenFOAM 11 · k-ω SST" : "Adjoint · DOE"}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="grid gap-2">
                  <Button
                    variant="hero"
                    size="lg"
                    onClick={() => { setRunning(true); setProgress(2); }}
                    disabled={running}
                    className="w-full justify-center"
                  >
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {mode === "preview" ? "Run preview now" : mode === "full" ? "Run simulation" : "Launch optimization"}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="glass" size="sm">
                      <ListPlus className="mr-2 h-3.5 w-3.5" /> Add to queue
                    </Button>
                    <Button
                      variant="glass"
                      size="sm"
                      onClick={() => { setRunning(false); setProgress(0); }}
                      className={cn(!running && "opacity-50 pointer-events-none")}
                    >
                      <X className="mr-2 h-3.5 w-3.5" /> Cancel job
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Queue / job status */}
            <SectionCard
              icon={Server}
              title="Queue & solver cluster"
              right={<StatusChip tone="success" size="sm">Online</StatusChip>}
            >
              <div className="space-y-3">
                {running ? (
                  <JobProgress
                    label="GR86 · Optimized v3 · point 2/3"
                    progress={progress}
                    eta="11 min"
                    status="solving"
                    metrics={[
                      { l: "Iter", v: "2,340" },
                      { l: "Res", v: "8.2e-5" },
                      { l: "CPU", v: "64 c" },
                    ]}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-surface-1/40 px-3 py-4 text-center">
                    <Clock className="mx-auto h-4 w-4 text-muted-foreground" />
                    <div className="mt-1.5 text-mono text-[11px] text-muted-foreground">No active job</div>
                  </div>
                )}

                <div className="rounded-md border border-border bg-surface-1">
                  <div className="border-b border-border px-3 py-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Cluster · live
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-border">
                    {[
                      { i: Cpu,      l: "Workers",  v: "12 / 16" },
                      { i: Database, l: "Queue",    v: "3 jobs" },
                      { i: Zap,      l: "Util",     v: "74%" },
                    ].map((r) => {
                      const Ic = r.i;
                      return (
                        <div key={r.l} className="p-3">
                          <div className="flex items-center gap-1.5 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                            <Ic className="h-3 w-3" /> {r.l}
                          </div>
                          <div className="mt-1 text-mono text-sm tabular-nums">{r.v}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <ul className="space-y-1.5">
                  {[
                    { id: "JOB-2186", name: "GR86 · v3 · point 2", state: "solving" as const, eta: "11 min", iter: "2,340" },
                    { id: "JOB-2185", name: "GR86 · v3 · point 1", state: "queued"  as const, eta: "in queue", iter: "—" },
                    { id: "JOB-2184", name: "M2 · ducktail trial", state: "done"    as const, eta: "12 min ago", iter: "converged" },
                  ].map((j) => (
                    <li key={j.id} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm truncate">{j.name}</div>
                        <div className="text-mono text-[10px] text-muted-foreground">{j.id} · {j.iter}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-mono text-[10px] text-muted-foreground">{j.eta}</span>
                        <StatusChip
                          tone={j.state === "solving" ? "primary" : j.state === "queued" ? "neutral" : "success"}
                          size="sm"
                          dot={j.state === "solving"}
                        >
                          {j.state}
                        </StatusChip>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </SectionCard>

            {/* Cost / credits */}
            <SectionCard
              icon={Coins}
              title="Compute credits"
              right={<span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">team plan</span>}
            >
              <div className="space-y-3">
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Used this cycle</span>
                    <span className="text-mono text-sm tabular-nums">
                      <span className="text-foreground">684</span>
                      <span className="text-muted-foreground"> / 2,000 cr</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full bg-gradient-primary" style={{ width: "34%" }} />
                  </div>
                </div>

                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">This run</div>
                      <div className="text-mono text-xl font-semibold tabular-nums text-primary mt-0.5">
                        {activeMode.cost}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Remaining</div>
                      <div className="text-mono text-sm tabular-nums text-foreground mt-0.5">1,316 cr</div>
                    </div>
                  </div>
                  <div className="mt-2 text-mono text-[10px] text-muted-foreground leading-relaxed">
                    {mode === "preview" && "Surrogate previews are heavily discounted — iterate freely."}
                    {mode === "full"    && "Includes mesh handoff, solve, and post-processing artifacts."}
                    {mode === "optim"   && "Charged per converged design × 16 — billed only on success."}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-mono text-[10px]">
                  <div className="rounded-md border border-border bg-surface-1 p-2">
                    <div className="text-muted-foreground uppercase tracking-widest">Avg / day</div>
                    <div className="text-foreground tabular-nums mt-0.5">38 cr</div>
                  </div>
                  <div className="rounded-md border border-border bg-surface-1 p-2">
                    <div className="text-muted-foreground uppercase tracking-widest">Renews</div>
                    <div className="text-foreground tabular-nums mt-0.5">in 12 d</div>
                  </div>
                </div>
              </div>
            </SectionCard>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
};

export default Simulation;
