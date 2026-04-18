import { Link } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { EmptyState } from "@/components/EmptyState";
import {
  Plus, Filter, ArrowRight, Wind, Lock, Car, Layers, Wrench, PlayCircle,
  BarChart3, GitCompareArrows, FileDown, Clock, Star, Sparkles, MoreHorizontal,
  ChevronRight, Target, Zap, Activity,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Mock data                                                          */
/* ─────────────────────────────────────────────────────────────────── */
const cars = [
  { id: "civic-fk8", make: "Honda",      model: "Civic Type R",      year: "2020 · FK8", supported: true, builds: 3 },
  { id: "gt86",      make: "Toyota",     model: "GR86",              year: "2023 · ZN8", supported: true, builds: 1 },
  { id: "m2",        make: "BMW",        model: "M2 Competition",    year: "2019 · F87", supported: true, builds: 2 },
  { id: "cayman",    make: "Porsche",    model: "718 Cayman GT4",    year: "2022 · 982", supported: true, builds: 1 },
  { id: "supra",     make: "Toyota",     model: "GR Supra",          year: "2024 · A90", supported: true, builds: 0 },
  { id: "evo",       make: "Mitsubishi", model: "Lancer Evo X",      year: "2015 · CZ4A", supported: false, builds: 0 },
];

type BuildStatus = "ready" | "simulating" | "draft" | "warning" | "optimized";
type Confidence = "low" | "medium" | "high";
type Objective = "Top speed" | "Track use" | "Balance";

const builds: {
  id: string;
  name: string;
  car: string;
  carId: string;
  trim: string;
  objective: Objective;
  status: BuildStatus;
  confidence: Confidence;
  modified: string;
  df: number;
  dr: number;
  ld: number;
  delta: { df: string; dr: string };
  starred?: boolean;
}[] = [
  {
    id: "b-2184", name: "Track pack v3", car: "Honda Civic Type R", carId: "civic-fk8", trim: "FK8 · 2020",
    objective: "Track use", status: "optimized", confidence: "high", modified: "2h ago",
    df: 284, dr: 112, ld: 2.54, delta: { df: "+18.4%", dr: "+4.1%" }, starred: true,
  },
  {
    id: "b-2183", name: "Standing-mile trim", car: "BMW M2 Competition", carId: "m2", trim: "F87 · 2019",
    objective: "Top speed", status: "simulating", confidence: "medium", modified: "running · 06:42",
    df: 96, dr: 88, ld: 1.09, delta: { df: "−12.0%", dr: "−7.4%" },
  },
  {
    id: "b-2180", name: "Time-attack draft", car: "Toyota GR86", carId: "gt86", trim: "ZN8 · 2023",
    objective: "Track use", status: "ready", confidence: "high", modified: "yesterday",
    df: 218, dr: 104, ld: 2.10, delta: { df: "+24.6%", dr: "+6.0%" },
  },
  {
    id: "b-2176", name: "Street balance", car: "Porsche 718 Cayman GT4", carId: "cayman", trim: "982 · 2022",
    objective: "Balance", status: "ready", confidence: "medium", modified: "3d ago",
    df: 152, dr: 96, ld: 1.58, delta: { df: "+6.2%", dr: "+1.8%" },
  },
  {
    id: "b-2171", name: "Diffuser study", car: "Honda Civic Type R", carId: "civic-fk8", trim: "FK8 · 2020",
    objective: "Track use", status: "warning", confidence: "low", modified: "5d ago",
    df: 198, dr: 118, ld: 1.68, delta: { df: "+9.0%", dr: "+12.4%" },
  },
  {
    id: "b-2168", name: "Splitter sweep A", car: "Honda Civic Type R", carId: "civic-fk8", trim: "FK8 · 2020",
    objective: "Balance", status: "draft", confidence: "low", modified: "1w ago",
    df: 162, dr: 102, ld: 1.59, delta: { df: "+2.1%", dr: "+0.4%" },
  },
];

const recentRuns = [
  { id: "#2184", build: "Track pack v3",        car: "Civic FK8", state: "converged",  iters: 1820, time: "12:48", when: "2h ago" },
  { id: "#2183", build: "Standing-mile trim",   car: "BMW M2",    state: "running",    iters: 940,  time: "06:42", when: "now" },
  { id: "#2182", build: "Diffuser study",       car: "Civic FK8", state: "warning",    iters: 1500, time: "11:02", when: "5h ago" },
  { id: "#2181", build: "Street balance",       car: "Cayman GT4",state: "converged",  iters: 1620, time: "10:18", when: "yesterday" },
  { id: "#2180", build: "Time-attack draft",    car: "GR86",      state: "converged",  iters: 1750, time: "11:24", when: "yesterday" },
  { id: "#2179", build: "Splitter sweep A",     car: "Civic FK8", state: "failed",     iters: 320,  time: "02:08", when: "3d ago" },
];

const savedVariants = [
  { name: "TP-V3 · Wing 14°",  parent: "Track pack v3",      df: 284, ld: 2.54, tag: "optimized" as const },
  { name: "TP-V3 · Wing 12°",  parent: "Track pack v3",      df: 268, ld: 2.46, tag: "high" as const },
  { name: "SM · Splitter −5",  parent: "Standing-mile trim", df: 96,  ld: 1.09, tag: "medium" as const },
  { name: "SB · Skirt closed", parent: "Street balance",     df: 152, ld: 1.58, tag: "high" as const },
];

const recommendations = [
  { icon: PlayCircle,       title: "Re-run Diffuser study",  body: "Convergence stalled at 1500 iter. Increase mesh density on the diffuser tunnel." , tone: "warning" as const, to: "/simulation" },
  { icon: GitCompareArrows, title: "Compare TP-V3 variants", body: "You have 4 saved variants under Track pack v3. Promote a winner to export.",       tone: "primary" as const, to: "/compare"    },
  { icon: Sparkles,         title: "Try canard sweep",       body: "Surrogate suggests +6% DF on FK8 with canards at α 8–12°. Queue a sweep run.",     tone: "primary" as const, to: "/parts"      },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Helpers                                                            */
/* ─────────────────────────────────────────────────────────────────── */
const statusToTone: Record<BuildStatus, Parameters<typeof StatusChip>[0]["tone"]> = {
  ready:      "success",
  simulating: "simulating",
  draft:      "preview",
  warning:    "warning",
  optimized:  "optimized",
};

const statusLabel: Record<BuildStatus, string> = {
  ready: "Ready", simulating: "Simulating", draft: "Draft", warning: "Needs review", optimized: "Optimized",
};

const objectiveIcon: Record<Objective, typeof Target> = {
  "Top speed": Zap, "Track use": Target, "Balance": Activity,
};

/* ─────────────────────────────────────────────────────────────────── */
/*  Car silhouette (compact)                                           */
/* ─────────────────────────────────────────────────────────────────── */
function CarSilhouette({ supported = true, accent = false }: { supported?: boolean; accent?: boolean }) {
  const stroke = supported ? (accent ? "hsl(188 95% 55%)" : "hsl(188 95% 55%)") : "hsl(215 14% 40%)";
  return (
    <svg viewBox="0 0 400 120" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
      {/* streamlines */}
      {[...Array(8)].map((_, i) => (
        <path key={i}
          d={`M0,${20 + i * 10} C140,${15 + i * 9} 260,${70 + i * 6} 400,${60 + i * 8}`}
          stroke={stroke} strokeWidth="0.5" fill="none" opacity={0.25 - i * 0.02} />
      ))}
      {/* body */}
      <path d="M50,90 L90,68 L160,58 L240,55 L300,62 L340,72 L360,90 L50,90 Z"
        fill={accent ? "hsl(188 95% 55% / 0.18)" : "hsl(188 95% 55% / 0.08)"} stroke={stroke} strokeWidth="1" />
      <path d="M150,58 L220,46 L280,52 L300,62 Z"
        fill="hsl(220 24% 11%)" stroke={stroke} strokeWidth="0.7" opacity="0.9" />
      {/* wing */}
      {accent && <path d="M310,48 L355,50 L355,55 L310,53 Z" fill={stroke} opacity="0.7" />}
      {/* wheels */}
      <circle cx="110" cy="93" r="11" fill="hsl(220 26% 6%)" stroke={stroke} strokeWidth="0.7" />
      <circle cx="290" cy="93" r="11" fill="hsl(220 26% 6%)" stroke={stroke} strokeWidth="0.7" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Build card                                                         */
/* ─────────────────────────────────────────────────────────────────── */
function BuildCard({ b }: { b: typeof builds[number] }) {
  const ObjectiveIcon = objectiveIcon[b.objective];
  const accent = b.status === "optimized";

  return (
    <div className={`group relative overflow-hidden rounded-xl border bg-card transition-all hover:border-primary/40 hover:shadow-glow ${accent ? "border-primary/30 ring-1 ring-primary/20" : "border-border"}`}>
      {accent && <div className="absolute inset-x-0 top-0 h-px stat-line" />}

      {/* Header strip */}
      <div className="flex items-start justify-between border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{b.id}</span>
            {b.starred && <Star className="h-3 w-3 fill-primary text-primary" />}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold tracking-tight">{b.name}</div>
          <div className="text-mono text-[11px] text-muted-foreground truncate">{b.car} · {b.trim}</div>
        </div>
        <button className="text-muted-foreground/60 hover:text-foreground transition-colors">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Visual */}
      <div className="relative h-28 overflow-hidden border-b border-border/60 bg-surface-0">
        <div className="absolute inset-0 grid-bg-fine opacity-30" />
        <CarSilhouette accent={accent} />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <StatusChip tone={statusToTone[b.status]} size="sm">{statusLabel[b.status]}</StatusChip>
        </div>
        <div className="absolute top-2 right-2">
          <ConfidenceBadge level={b.confidence} compact />
        </div>
        <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1/80 px-2 py-0.5 backdrop-blur">
          <ObjectiveIcon className="h-3 w-3 text-primary" />
          <span className="text-mono text-[10px] uppercase tracking-widest text-foreground">{b.objective}</span>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 divide-x divide-border/60 border-b border-border/60">
        {[
          { l: "DF",  v: b.df,  u: "kgf", d: b.delta.df, good: true  },
          { l: "DR",  v: b.dr,  u: "kgf", d: b.delta.dr, good: false },
          { l: "L/D", v: b.ld,  u: "",    d: "",         good: true  },
        ].map((m) => (
          <div key={m.l} className="px-3 py-3">
            <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">{m.l}</div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className={`text-mono text-base font-semibold tabular-nums ${accent && m.l === "L/D" ? "text-primary" : "text-foreground"}`}>
                {m.v}
              </span>
              {m.u && <span className="text-mono text-[9px] text-muted-foreground">{m.u}</span>}
            </div>
            {m.d && (
              <div className={`text-mono text-[10px] mt-0.5 ${m.good ? (m.d.startsWith("+") ? "text-success" : "text-destructive") : (m.d.startsWith("+") ? "text-destructive" : "text-success")}`}>
                {m.d}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1.5 text-mono text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {b.modified}
        </div>
        <Button asChild size="sm" variant={accent ? "hero" : "glass"}>
          <Link to="/build">Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Car selector strip                                                 */
/* ─────────────────────────────────────────────────────────────────── */
function CarStrip({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string | null) => void }) {
  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Your garage · {cars.length} vehicles</div>
        <button className="text-mono text-[10px] uppercase tracking-widest text-primary/80 hover:text-primary transition-colors inline-flex items-center gap-1">
          Manage <ChevronRight className="h-3 w-3" />
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => onSelect(null)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${activeId === null ? "border-primary/50 bg-primary/10" : "border-border bg-surface-1 hover:border-primary/30"}`}
        >
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">View</div>
          <div className="text-sm font-medium">All vehicles</div>
        </button>
        {cars.map((c) => {
          const active = activeId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              disabled={!c.supported}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors min-w-[180px] ${active ? "border-primary/50 bg-primary/10" : "border-border bg-surface-1 hover:border-primary/30"} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center justify-between">
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{c.make}</span>
                {!c.supported && <Lock className="h-3 w-3 text-muted-foreground" />}
              </div>
              <div className="text-sm font-medium truncate">{c.model}</div>
              <div className="mt-0.5 flex items-center justify-between">
                <span className="text-mono text-[10px] text-muted-foreground">{c.year}</span>
                <span className="text-mono text-[10px] text-primary">{c.builds} builds</span>
              </div>
            </button>
          );
        })}
        <button className="shrink-0 inline-flex items-center justify-center rounded-lg border border-dashed border-border bg-surface-1/30 px-3 py-2 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Recent simulations panel                                           */
/* ─────────────────────────────────────────────────────────────────── */
function RecentSimulations() {
  const stateChip = (s: string) => {
    if (s === "converged") return <StatusChip tone="success" size="sm">Converged</StatusChip>;
    if (s === "running")   return <StatusChip tone="simulating" size="sm">Running</StatusChip>;
    if (s === "warning")   return <StatusChip tone="warning" size="sm">Review</StatusChip>;
    return <StatusChip tone="failed" size="sm">Failed</StatusChip>;
  };

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Recent simulations</h3>
        </div>
        <Link to="/results" className="text-mono text-[10px] uppercase tracking-widest text-primary/80 hover:text-primary transition-colors inline-flex items-center gap-1">
          All runs <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="divide-y divide-border/60">
        {recentRuns.map((r) => (
          <div key={r.id} className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 hover:bg-surface-2/40 transition-colors">
            <div className="col-span-2 text-mono text-[11px] text-muted-foreground">{r.id}</div>
            <div className="col-span-4 min-w-0">
              <div className="truncate text-sm">{r.build}</div>
              <div className="text-mono text-[10px] text-muted-foreground truncate">{r.car}</div>
            </div>
            <div className="col-span-2">{stateChip(r.state)}</div>
            <div className="col-span-2 text-mono text-[11px] text-muted-foreground tabular-nums">
              {r.iters.toLocaleString()} it
            </div>
            <div className="col-span-2 text-right text-mono text-[11px] text-muted-foreground">{r.when}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Saved variants panel                                               */
/* ─────────────────────────────────────────────────────────────────── */
function SavedVariants() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Saved variants</h3>
        </div>
        <Link to="/compare" className="text-mono text-[10px] uppercase tracking-widest text-primary/80 hover:text-primary transition-colors inline-flex items-center gap-1">
          Compare <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="divide-y divide-border/60">
        {savedVariants.map((v) => (
          <div key={v.name} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2/40 transition-colors">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{v.name}</div>
              <div className="text-mono text-[10px] text-muted-foreground truncate">{v.parent}</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">DF</div>
                <div className="text-mono text-sm tabular-nums text-foreground">{v.df}</div>
              </div>
              <div className="text-right">
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">L/D</div>
                <div className="text-mono text-sm tabular-nums text-primary">{v.ld}</div>
              </div>
              <StatusChip tone={v.tag} size="sm">
                {v.tag === "optimized" ? "Best" : v.tag === "high" ? "High" : "Med"}
              </StatusChip>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Recommended actions                                                */
/* ─────────────────────────────────────────────────────────────────── */
function Recommendations() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Recommended next</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">AI assist</span>
      </div>
      <div className="space-y-2 p-3">
        {recommendations.map((r) => (
          <Link
            key={r.title}
            to={r.to}
            className={`group block rounded-lg border p-3 transition-colors ${r.tone === "warning" ? "border-warning/20 bg-warning/5 hover:border-warning/40" : "border-border bg-surface-1 hover:border-primary/40 hover:bg-surface-2"}`}
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${r.tone === "warning" ? "border-warning/30 bg-warning/10 text-warning" : "border-primary/30 bg-primary/10 text-primary"}`}>
                <r.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{r.body}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Garage = () => {
  const [activeCar, setActiveCar] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  const filteredBuilds = activeCar ? builds.filter((b) => b.carId === activeCar) : builds;
  const visible = showEmpty ? [] : filteredBuilds;

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <PageHeader
          eyebrow="Workspace"
          title="Garage"
          description="Manage your vehicles, builds and simulation runs. Open a build to enter its workspace."
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="border-border bg-surface-1"
                onClick={() => setShowEmpty((v) => !v)}
              >
                {showEmpty ? "Show builds" : "Preview empty state"}
              </Button>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">
                <Filter className="mr-2 h-3.5 w-3.5" /> Filter
              </Button>
              <Button size="sm" variant="hero" asChild>
                <Link to="/build"><Plus className="mr-2 h-3.5 w-3.5" /> New build</Link>
              </Button>
            </>
          }
        />

        {/* Stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="ACTIVE BUILDS" value="6" delta={{ value: "+1", direction: "up" }} hint="this week" />
          <StatCard label="TOTAL RUNS"    value="34" delta={{ value: "+8", direction: "up" }} hint="last 30 days" accent />
          <StatCard label="BEST L/D"      value="2.54" delta={{ value: "+0.31", direction: "up" }} hint="Track pack v3" />
          <StatCard label="SOLVER MIN"    value="218.4" unit="min" hint="quota: 600 min" />
        </div>

        {/* Car selector */}
        <div className="mt-6">
          <CarStrip activeId={activeCar} onSelect={setActiveCar} />
        </div>

        {/* Main grid */}
        <div className="mt-6 grid gap-6 xl:grid-cols-12">
          {/* Builds — main column */}
          <section className="xl:col-span-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold tracking-tight">
                  {activeCar ? "Builds for selected vehicle" : "All builds"}
                </h2>
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {visible.length} of {filteredBuilds.length}
                </span>
              </div>
              <div className="flex items-center gap-1 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <button className="px-2 py-1 rounded bg-surface-2 text-foreground">Recent</button>
                <button className="px-2 py-1 rounded hover:text-foreground transition-colors">Best L/D</button>
                <button className="px-2 py-1 rounded hover:text-foreground transition-colors">Status</button>
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={<Wind className="h-5 w-5 text-primary" />}
                title="No builds yet"
                description="Start by creating a build for one of your supported vehicles. You'll configure aero parts, run comparative CFD, and review engineering output."
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="hero" size="sm" asChild>
                      <Link to="/build"><Plus className="mr-2 h-3.5 w-3.5" /> Create first build</Link>
                    </Button>
                    <Button variant="glass" size="sm" asChild>
                      <Link to="/results"><PlayCircle className="mr-2 h-3.5 w-3.5" /> View sample run</Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {visible.map((b) => <BuildCard key={b.id} b={b} />)}

                {/* New build slot */}
                <Link
                  to="/build"
                  className="group flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1/40 p-6 text-center transition-colors hover:border-primary/40 hover:bg-surface-1/60"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2 group-hover:border-primary/40 group-hover:text-primary transition-colors">
                    <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="mt-3 text-sm font-medium">New build</div>
                  <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
                    Start from a baseline geometry or fork an existing build to iterate on parameters.
                  </p>
                  <div className="mt-4 inline-flex items-center text-mono text-[10px] uppercase tracking-widest text-primary/80 group-hover:text-primary transition-colors">
                    Open builder <ArrowRight className="ml-1 h-3 w-3" />
                  </div>
                </Link>
              </div>
            )}
          </section>

          {/* Right rail */}
          <aside className="xl:col-span-4 space-y-6">
            <Recommendations />
            <SavedVariants />
            <RecentSimulations />
          </aside>
        </div>
      </div>
    </AppLayout>
  );
};

export default Garage;
