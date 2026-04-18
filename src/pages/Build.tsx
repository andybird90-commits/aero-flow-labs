import { Link } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { JobProgress } from "@/components/JobProgress";
import { ColorRamp, Legend } from "@/components/Legend";
import {
  PlayCircle, GitCompareArrows, FileDown, Copy, ChevronRight, ArrowRight,
  Star, MoreHorizontal, Maximize2, RotateCcw, Layers, Wind, Gauge, Box,
  Wrench, BarChart3, Target, ShieldCheck, AlertTriangle, Clock, Plus,
  Settings2, Eye, EyeOff,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Mock build data                                                    */
/* ─────────────────────────────────────────────────────────────────── */
const build = {
  id: "BLD-2184",
  name: "Optimized Package v3",
  car: "Toyota GR86 Track Build",
  trim: "ZN8 · 2023 · Manual",
  objective: "Track use" as const,
  modified: "2h ago by M. Kovács",
};

const aero = {
  cd: 0.342,
  cdDelta: "−0.024",
  cl: -0.612,
  drag: 112,
  dragDelta: "+4.1%",
  dfFront: 121,
  dfRear: 163,
  dfTotal: 284,
  dfDelta: "+18.4%",
  ld: 2.54,
  ldDelta: "+0.31",
  balance: 42.6,
  balanceTarget: 44.0,
  balanceDelta: "−1.8 pt",
};

const variants = [
  { id: "v0", name: "Baseline",   tag: "OEM trim",     df: 240, dr: 108, ld: 2.22, status: "ready" as const, confidence: "high" as const },
  { id: "v1", name: "Variant A",  tag: "Street pack",  df: 268, dr: 109, ld: 2.46, status: "ready" as const, confidence: "high" as const },
  { id: "v2", name: "Package v3", tag: "Track pack",   df: 284, dr: 112, ld: 2.54, status: "optimized" as const, confidence: "high" as const, current: true },
  { id: "v3", name: "Variant C",  tag: "Endurance",    df: 296, dr: 119, ld: 2.49, status: "simulating" as const, confidence: "medium" as const },
  { id: "v4", name: "Wing 16°",   tag: "Sweep run",    df: 302, dr: 124, ld: 2.44, status: "draft" as const, confidence: "low" as const },
];

const assumptions = [
  { k: "Velocity (U∞)",   v: "180 km/h" },
  { k: "Air density (ρ)", v: "1.225 kg/m³" },
  { k: "Yaw / pitch",     v: "0° / 0.8°" },
  { k: "Ride height",     v: "F 78 mm · R 82 mm" },
  { k: "Ground / wheels", v: "Moving / Rotating" },
  { k: "Solver",          v: "RANS k-ω SST · 2nd ord." },
  { k: "Mesh",            v: "Adaptive · 1.84M cells" },
  { k: "Convergence",     v: "Cd Δ < 1e-4 over 200 it" },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Sub-sidebar — build sections                                       */
/* ─────────────────────────────────────────────────────────────────── */
const sections = [
  { label: "Overview",   icon: Layers,            to: "/build",      active: true,  badge: null },
  { label: "Geometry",   icon: Box,               to: "/geometry",   active: false, badge: "ok" },
  { label: "Aero Parts", icon: Wrench,            to: "/parts",      active: false, badge: "5" },
  { label: "Simulation", icon: PlayCircle,        to: "/simulation", active: false, badge: "run" },
  { label: "Results",    icon: BarChart3,         to: "/results",    active: false, badge: "new" },
  { label: "Compare",    icon: GitCompareArrows,  to: "/compare",    active: false, badge: "4" },
  { label: "Exports",    icon: FileDown,          to: "/exports",    active: false, badge: null },
];

function BuildSidebar() {
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-surface-0/40">
      <div className="border-b border-border px-4 py-4">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Build</div>
        <div className="mt-1 flex items-center gap-2">
          <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">{build.name}</div>
            <div className="text-mono text-[10px] text-muted-foreground truncate">{build.id}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-2">
          Sections
        </div>
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.label}>
              <Link
                to={s.to}
                className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  s.active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {s.active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-glow" />}
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{s.label}</span>
                {s.badge === "run"  && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />}
                {s.badge === "new"  && <span className="text-mono text-[9px] uppercase tracking-widest text-primary">new</span>}
                {s.badge === "ok"   && <span className="text-success text-[10px]">●</span>}
                {(s.badge && !["run","new","ok"].includes(s.badge)) && (
                  <span className="text-mono text-[10px] text-muted-foreground tabular-nums">{s.badge}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border p-3 space-y-2">
        <ConfidenceBadge level="high" compact className="w-full justify-center" />
        <Button variant="hero" size="sm" className="w-full" asChild>
          <Link to="/simulation"><PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation</Link>
        </Button>
      </div>
    </aside>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Workspace breadcrumb / actions                                     */
/* ─────────────────────────────────────────────────────────────────── */
function WorkspaceHeader() {
  return (
    <div className="border-b border-border bg-surface-0/60 backdrop-blur sticky top-14 z-20">
      <div className="px-6 py-3 flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest">
          <Link to="/garage" className="text-muted-foreground hover:text-foreground transition-colors">Garage</Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          <span className="text-muted-foreground">{build.car}</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          <span className="text-foreground">{build.name}</span>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <StatusChip tone="optimized" size="sm">Optimized</StatusChip>
          <span className="hidden md:inline text-mono text-[11px] text-muted-foreground">
            <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
            {build.modified}
          </span>
          <div className="h-5 w-px bg-border mx-1" />
          <Button variant="glass" size="sm">
            <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate variant
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link to="/compare"><GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare</Link>
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link to="/exports"><FileDown className="mr-2 h-3.5 w-3.5" /> Export</Link>
          </Button>
          <Button variant="hero" size="sm" asChild>
            <Link to="/simulation"><PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation</Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  3D viewer hero panel                                               */
/* ─────────────────────────────────────────────────────────────────── */
type ViewMode = "geometry" | "pressure" | "velocity" | "wake";

function HeroViewer() {
  const [mode, setMode] = useState<ViewMode>("velocity");
  const [showLabels, setShowLabels] = useState(true);

  const modes: { id: ViewMode; label: string; sub: string }[] = [
    { id: "geometry", label: "Geometry",    sub: "Surface mesh" },
    { id: "pressure", label: "Pressure",    sub: "Cp field" },
    { id: "velocity", label: "Velocity",    sub: "Streamlines" },
    { id: "wake",     label: "Wake",        sub: "Q-criterion" },
  ];

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
      {/* Top toolbar */}
      <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface-0/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors ${
                mode === m.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden md:inline text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {modes.find((m) => m.id === mode)?.sub}
          </span>
          <div className="hidden md:block h-4 w-px bg-border" />
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setShowLabels((v) => !v)}>
            {showLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Viewer canvas */}
      <div className="relative h-[480px]">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_45%,hsl(188_95%_55%/0.12),transparent_70%)]" />

        <svg viewBox="0 0 1000 480" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="bvBody" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.42" />
              <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="bvFlow" x1="0" x2="1">
              <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
              <stop offset="50%" stopColor="hsl(188 95% 55%)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="bvWake" x1="0" x2="1">
              <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Streamlines (velocity / wake) */}
          {(mode === "velocity" || mode === "wake") && [...Array(28)].map((_, i) => (
            <path key={i}
              d={`M0,${40 + i * 14} C220,${30 + i * 13} 440,${160 + i * 8} 700,${130 + i * 10} S1000,${150 + i * 9} 1000,${150 + i * 9}`}
              stroke="url(#bvFlow)" strokeWidth="1" fill="none" opacity={0.7 - i * 0.018} />
          ))}

          {/* Wake fan */}
          {mode === "wake" && (
            <path d="M740,240 L1000,180 L1000,360 L740,300 Z" fill="url(#bvWake)" opacity="0.4" />
          )}

          {/* Car */}
          <g transform="translate(0, 30)">
            <path d="M180,330 L260,290 L420,260 L580,255 L720,275 L820,300 L880,330 L180,330 Z"
              fill={mode === "geometry" ? "hsl(188 95% 55% / 0.06)" : "url(#bvBody)"}
              stroke="hsl(188 95% 55%)" strokeWidth="1.2" />
            {/* mesh wireframe */}
            {mode === "geometry" && [...Array(14)].map((_, i) => (
              <line key={i} x1={200 + i * 50} y1="330" x2={220 + i * 48} y2="265" stroke="hsl(188 95% 55%)" strokeWidth="0.4" opacity="0.4" />
            ))}
            {mode === "geometry" && [...Array(6)].map((_, i) => (
              <line key={i} x1="180" y1={270 + i * 12} x2="880" y2={285 + i * 9} stroke="hsl(188 95% 55%)" strokeWidth="0.3" opacity="0.3" />
            ))}

            <path d="M380,260 L500,232 L620,238 L700,260 Z"
              fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.85" />

            {/* Splitter / wing */}
            <path d="M180,330 L260,330 L260,335 L180,335 Z" fill="hsl(188 95% 55%)" opacity="0.55" />
            <path d="M740,235 L860,240 L860,247 L740,245 Z" fill="hsl(188 95% 55%)" opacity="0.6" />
            <line x1="780" y1="247" x2="780" y2="278" stroke="hsl(188 95% 55%)" strokeWidth="1.2" opacity="0.6" />
            <line x1="830" y1="247" x2="830" y2="278" stroke="hsl(188 95% 55%)" strokeWidth="1.2" opacity="0.6" />

            {/* Wheels */}
            <circle cx="290" cy="335" r="30" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.7" />
            <circle cx="290" cy="335" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.6" />
            <circle cx="780" cy="335" r="30" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.7" />
            <circle cx="780" cy="335" r="14" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.6" />

            {/* Pressure dots */}
            {mode === "pressure" && [...Array(36)].map((_, i) => (
              <circle key={i}
                cx={200 + (i % 9) * 75} cy={260 + Math.floor(i / 9) * 14} r="2.5"
                fill={`hsl(${i % 3 === 0 ? "0" : "188"} 95% ${50 + (i % 4) * 8}%)`} opacity="0.85" />
            ))}
          </g>

          {/* Annotations */}
          {showLabels && (
            <g style={{ font: "10px 'JetBrains Mono', monospace" }}>
              <line x1="220" y1="360" x2="160" y2="430" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.6" />
              <text x="60" y="438" fill="hsl(188 95% 55%)" opacity="0.9">SPLITTER · Cp +0.9</text>
              <line x1="800" y1="265" x2="870" y2="180" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.6" />
              <text x="780" y="170" fill="hsl(188 95% 55%)" opacity="0.9">WING · Cp −1.86</text>
              <line x1="900" y1="290" x2="950" y2="220" stroke="hsl(188 95% 55%)" strokeWidth="0.5" opacity="0.6" />
              <text x="860" y="215" fill="hsl(188 95% 55%)" opacity="0.9">WAKE · ω̄ 1500</text>
            </g>
          )}
        </svg>

        {/* Top-left status overlay */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <StatusChip tone="simulating" size="sm">Live preview · #2184</StatusChip>
          <ConfidenceBadge level="high" compact />
        </div>

        {/* Top-right run conditions */}
        <div className="absolute top-3 right-3 flex items-center gap-3 rounded-md border border-border bg-surface-1/80 px-3 py-1.5 backdrop-blur text-mono text-[10px]">
          <div><span className="text-muted-foreground">U∞ </span><span className="text-foreground">180 km/h</span></div>
          <div><span className="text-muted-foreground">α </span><span className="text-foreground">0.8°</span></div>
          <div><span className="text-muted-foreground">ρ </span><span className="text-foreground">1.225</span></div>
        </div>

        {/* Bottom-left axes */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 text-mono text-[10px] text-muted-foreground">
          <span className="text-destructive">X</span>
          <span className="text-success">Y</span>
          <span className="text-primary">Z</span>
          <span className="text-muted-foreground/50">·</span>
          <span>FRAME 218 / 240</span>
        </div>

        {/* Bottom-right hint */}
        <div className="absolute bottom-3 right-3 text-mono text-[10px] text-muted-foreground/70">
          drag to orbit · scroll to zoom
        </div>
      </div>

      {/* Bottom info strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border border-t border-border">
        <div className="p-3">
          <ColorRamp label={mode === "pressure" ? "Cp" : mode === "velocity" ? "U / U∞" : mode === "wake" ? "ω · 1/s" : "Curvature"} min="−2.1" max="+1.0" ticks={["−2","−1","0","+1"]} />
        </div>
        <div className="p-3 flex flex-col justify-between">
          <Legend
            items={[
              { label: "Body",     color: "text-primary",     shape: "square" },
              { label: "Wing",     color: "text-success",     shape: "square" },
              { label: "Splitter", color: "text-warning",     shape: "square" },
              { label: "Wake",     color: "text-destructive", shape: "line"   },
            ]}
          />
          <div className="text-mono text-[10px] text-muted-foreground mt-2">
            Mesh 1.84M cells · y+ avg 2.3 · LOD adaptive
          </div>
        </div>
        <div className="p-3 grid grid-cols-3 gap-3">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Cd</div>
            <div className="text-mono text-base font-semibold tabular-nums text-foreground">{aero.cd.toFixed(3)}</div>
          </div>
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Cl</div>
            <div className="text-mono text-base font-semibold tabular-nums text-foreground">{aero.cl.toFixed(3)}</div>
          </div>
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">L/D</div>
            <div className="text-mono text-base font-semibold tabular-nums text-primary">{aero.ld}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Aero summary card                                                  */
/* ─────────────────────────────────────────────────────────────────── */
function AeroSummary() {
  const balancePct = (aero.balance / 100) * 100;
  const targetPct = (aero.balanceTarget / 100) * 100;

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Aero summary</h3>
          <StatusChip tone="solver" size="sm">Solver-backed</StatusChip>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">@ 180 km/h</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-y divide-border/60">
        {/* Cd */}
        <div className="p-4">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Cd · drag coeff</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">{aero.cd.toFixed(3)}</span>
          </div>
          <div className="mt-1 text-mono text-[10px] text-success">{aero.cdDelta} vs baseline</div>
        </div>

        {/* Drag */}
        <div className="p-4">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Drag force</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">{aero.drag}</span>
            <span className="text-mono text-xs text-muted-foreground">kgf</span>
          </div>
          <div className="mt-1 text-mono text-[10px] text-destructive">{aero.dragDelta} vs baseline</div>
        </div>

        {/* L/D */}
        <div className="p-4 bg-primary/[0.04]">
          <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">L / D ratio</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums text-primary">{aero.ld}</span>
          </div>
          <div className="mt-1 text-mono text-[10px] text-success">{aero.ldDelta} vs baseline</div>
        </div>

        {/* Front DF */}
        <div className="p-4">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Front downforce</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">{aero.dfFront}</span>
            <span className="text-mono text-xs text-muted-foreground">kgf</span>
          </div>
          <div className="mt-1 text-mono text-[10px] text-success">+15.2%</div>
        </div>

        {/* Rear DF */}
        <div className="p-4">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Rear downforce</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">{aero.dfRear}</span>
            <span className="text-mono text-xs text-muted-foreground">kgf</span>
          </div>
          <div className="mt-1 text-mono text-[10px] text-success">+20.7%</div>
        </div>

        {/* Total DF */}
        <div className="p-4 bg-primary/[0.04]">
          <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Total downforce</div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums text-primary">{aero.dfTotal}</span>
            <span className="text-mono text-xs text-muted-foreground">kgf</span>
          </div>
          <div className="mt-1 text-mono text-[10px] text-success">{aero.dfDelta} vs baseline</div>
        </div>
      </div>

      {/* Aero balance bar */}
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Aero balance · F %</span>
          </div>
          <div className="flex items-center gap-3 text-mono text-[11px]">
            <span className="text-foreground tabular-nums">{aero.balance.toFixed(1)}%</span>
            <span className="text-muted-foreground">target {aero.balanceTarget.toFixed(1)}%</span>
            <span className="text-warning tabular-nums">{aero.balanceDelta}</span>
          </div>
        </div>

        <div className="relative mt-3 h-2 rounded-full bg-surface-2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-primary" style={{ width: `${balancePct}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-warning" style={{ left: `${targetPct}%` }} />
          <div className="absolute -top-1 -translate-x-1/2 text-mono text-[9px] text-warning" style={{ left: `${targetPct}%` }}>▼</div>
        </div>
        <div className="mt-1 flex justify-between text-mono text-[9px] text-muted-foreground tabular-nums">
          <span>0% F (rear-bias)</span>
          <span>50%</span>
          <span>100% F (front-bias)</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Build assumptions                                                  */
/* ─────────────────────────────────────────────────────────────────── */
function BuildAssumptions() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Build assumptions</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground -mr-2">
          Edit <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/60">
        <dl className="divide-y divide-border/60">
          {assumptions.slice(0, 4).map((a) => (
            <div key={a.k} className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-mono text-[11px] text-muted-foreground">{a.k}</dt>
              <dd className="text-mono text-[11px] text-foreground tabular-nums">{a.v}</dd>
            </div>
          ))}
        </dl>
        <dl className="divide-y divide-border/60">
          {assumptions.slice(4).map((a) => (
            <div key={a.k} className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-mono text-[11px] text-muted-foreground">{a.k}</dt>
              <dd className="text-mono text-[11px] text-foreground tabular-nums">{a.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="border-t border-border px-4 py-2.5 flex items-center gap-2 text-mono text-[10px] text-muted-foreground">
        <AlertTriangle className="h-3 w-3 text-warning" />
        Assumptions match validated baseline for ZN8. Comparative output only — not OEM certification.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Current objective                                                  */
/* ─────────────────────────────────────────────────────────────────── */
function CurrentObjective() {
  const goals = [
    { k: "Maximize downforce", v: "+18.4%", target: "≥ +15%", ok: true },
    { k: "Cap drag",           v: "+4.1%",  target: "≤ +6%",  ok: true },
    { k: "Front balance",      v: "42.6%",  target: "44 ± 1%", ok: false },
    { k: "L/D ratio",          v: "2.54",   target: "≥ 2.40",  ok: true },
  ];

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Current objective</h3>
        </div>
        <StatusChip tone="optimized" size="sm">Track use</StatusChip>
      </div>
      <div className="p-4 space-y-2">
        {goals.map((g) => (
          <div key={g.k} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${g.ok ? "bg-success" : "bg-warning"}`} />
              <span className="text-sm truncate">{g.k}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-mono text-[11px] text-muted-foreground tabular-nums">{g.target}</span>
              <span className={`text-mono text-[11px] tabular-nums ${g.ok ? "text-success" : "text-warning"}`}>{g.v}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border px-4 py-2.5 flex items-center justify-between">
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">3 of 4 met</span>
        <Button variant="ghost" size="sm" className="h-7 text-primary hover:text-primary -mr-2">
          Tune objective <ChevronRight className="ml-1 h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Variant history strip                                              */
/* ─────────────────────────────────────────────────────────────────── */
function VariantHistory() {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Variant history</h3>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{variants.length} variants</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground">
            <Copy className="mr-1.5 h-3 w-3" /> Duplicate
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link to="/compare"><GitCompareArrows className="mr-1.5 h-3 w-3" /> Compare all</Link>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-3 p-4 min-w-max">
          {variants.map((v, i) => {
            const current = v.current;
            const tone =
              v.status === "optimized" ? "optimized" :
              v.status === "simulating" ? "simulating" :
              v.status === "draft" ? "preview" : "success";

            return (
              <div key={v.id} className="flex items-center gap-3">
                <div
                  className={`relative w-56 rounded-lg border p-3 transition-colors ${
                    current
                      ? "border-primary/40 bg-primary/[0.06] ring-1 ring-primary/20"
                      : "border-border bg-surface-1 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {v.id.toUpperCase()}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {current && <Star className="h-3 w-3 fill-primary text-primary shrink-0" />}
                        <span className="text-sm font-medium truncate">{v.name}</span>
                      </div>
                      <div className="text-mono text-[10px] text-muted-foreground truncate">{v.tag}</div>
                    </div>
                    <StatusChip tone={tone as Parameters<typeof StatusChip>[0]["tone"]} size="sm" dot={false}>
                      {v.status === "optimized" ? "Best" : v.status === "simulating" ? "Run" : v.status === "draft" ? "Draft" : "Ready"}
                    </StatusChip>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-mono text-[11px] tabular-nums">
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">DF</div>
                      <div className="text-foreground">{v.df}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">DR</div>
                      <div className="text-foreground">{v.dr}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">L/D</div>
                      <div className={current ? "text-primary" : "text-foreground"}>{v.ld}</div>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <ConfidenceBadge level={v.confidence} compact />
                    {!current && (
                      <button className="text-mono text-[10px] uppercase tracking-widest text-primary/80 hover:text-primary transition-colors">
                        Switch
                      </button>
                    )}
                  </div>
                </div>
                {i < variants.length - 1 && (
                  <div className="h-px w-4 bg-gradient-to-r from-border to-border/30" />
                )}
              </div>
            );
          })}

          <button className="flex w-40 items-center justify-center rounded-lg border border-dashed border-border bg-surface-1/30 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
            <Plus className="mr-2 h-4 w-4" /> New variant
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Simulation status card                                             */
/* ─────────────────────────────────────────────────────────────────── */
function SimulationStatus() {
  return (
    <div className="space-y-3">
      <JobProgress
        state="running"
        label="Run #2185 · Variant C"
        iteration={1820}
        totalIterations={2400}
        eta="6m 02s"
        residual="Cd Δ 1.2e-04 · Cl Δ 8.7e-05"
      />

      <div className="glass rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wind className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Solver cluster</span>
          </div>
          <StatusChip tone="success" size="sm">Online</StatusChip>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-mono text-[11px]">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Nodes</div>
            <div className="mt-0.5 text-foreground tabular-nums">14 / 14</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Free</div>
            <div className="mt-0.5 text-success tabular-nums">12</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Queue</div>
            <div className="mt-0.5 text-foreground tabular-nums">2 jobs</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-mono text-[11px]">
          <span className="text-muted-foreground">Quota used</span>
          <span className="tabular-nums text-foreground">218.4 / 600 min</span>
        </div>
        <div className="mt-2 h-1 rounded-full bg-surface-2 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-primary" style={{ width: "36%" }} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Build = () => {
  return (
    <AppLayout>
      <div className="flex">
        <BuildSidebar />

        <div className="min-w-0 flex-1">
          <WorkspaceHeader />

          <div className="px-6 py-6">
            {/* Title row */}
            <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
              <div>
                <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
                  {build.car}
                </div>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight flex items-center gap-2">
                  {build.name}
                  <Star className="h-4 w-4 fill-primary text-primary" />
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{build.trim} · {build.id}</p>
              </div>
            </div>

            {/* Hero viewer */}
            <HeroViewer />

            {/* Aero summary + side cards */}
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <AeroSummary />
              </div>
              <div className="space-y-4">
                <CurrentObjective />
              </div>
            </div>

            {/* Assumptions + simulation status */}
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <BuildAssumptions />
              </div>
              <SimulationStatus />
            </div>

            {/* Variant history */}
            <div className="mt-4">
              <VariantHistory />
            </div>

            {/* Quick actions footer */}
            <div className="mt-6 glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
                  <PlayCircle className="h-4 w-4 text-primary-foreground" />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-medium">Ready to iterate</div>
                  <div className="text-mono text-[11px] text-muted-foreground">
                    3 of 4 objectives met · queue a sweep to refine balance
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="glass" size="sm" asChild>
                  <Link to="/parts"><Wrench className="mr-2 h-3.5 w-3.5" /> Tune parts</Link>
                </Button>
                <Button variant="glass" size="sm">
                  <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate variant
                </Button>
                <Button variant="glass" size="sm" asChild>
                  <Link to="/compare"><GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare</Link>
                </Button>
                <Button variant="glass" size="sm" asChild>
                  <Link to="/exports"><FileDown className="mr-2 h-3.5 w-3.5" /> Export package</Link>
                </Button>
                <Button variant="hero" size="sm" asChild>
                  <Link to="/simulation">
                    <PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation
                    <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Build;
