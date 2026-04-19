import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { Legend, ColorRamp } from "@/components/Legend";
import {
  Wind, ArrowRight, Activity, Layers, Gauge, Box, Wrench, PlayCircle,
  BarChart3, GitCompareArrows, FileDown, Cpu, ShieldCheck, Zap, Twitter,
  Github, Youtube, Check,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Top nav                                                            */
/* ─────────────────────────────────────────────────────────────────── */
function Nav() {
  return (
    <header className="relative z-30 mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
          <Wind className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">AeroLab</div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Comparative aero studio
          </div>
        </div>
      </div>
      <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
        <a href="#capabilities" className="hover:text-foreground transition-colors">Platform</a>
        <a href="#workflow" className="hover:text-foreground transition-colors">Workflow</a>
        <a href="#outputs" className="hover:text-foreground transition-colors">Outputs</a>
        <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
        <a href="/design-system" className="hover:text-foreground transition-colors">Docs</a>
      </nav>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild><Link to="/garage">Sign in</Link></Button>
        <Button variant="hero" size="sm" asChild>
          <Link to="/garage">Open AeroLab <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Hero — headline + premium CFD visual                              */
/* ─────────────────────────────────────────────────────────────────── */
function HeroVisual() {
  return (
    <div className="relative h-[420px] overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
      {/* grid + halo */}
      <div className="absolute inset-0 grid-bg opacity-50" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,hsl(188_95%_55%/0.18),transparent_70%)]" />

      {/* SVG car + flow */}
      <svg viewBox="0 0 1000 420" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="hflow" x1="0" x2="1">
            <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
            <stop offset="50%" stopColor="hsl(188 95% 55%)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="bodyFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient id="wakeFill" x1="0" x2="1">
            <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(188 95% 55%)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Streamlines — flowing into car */}
        {[...Array(26)].map((_, i) => (
          <path
            key={i}
            d={`M0,${30 + i * 14} C220,${20 + i * 13} 420,${130 + i * 9} 660,${100 + i * 11} S1000,${120 + i * 10} 1000,${120 + i * 10}`}
            stroke="url(#hflow)"
            strokeWidth="1"
            fill="none"
            opacity={0.7 - i * 0.018}
          />
        ))}

        {/* Wake fan */}
        <path
          d="M720,200 L1000,160 L1000,300 L720,260 Z"
          fill="url(#wakeFill)"
          opacity="0.35"
        />

        {/* Car silhouette — track car proportions */}
        <g transform="translate(0, 20)">
          {/* underbody */}
          <path d="M180,290 L260,250 L420,225 L580,220 L720,235 L820,260 L880,290 L180,290 Z"
            fill="url(#bodyFill)" stroke="hsl(188 95% 55%)" strokeWidth="1.2" />
          {/* roof / cabin */}
          <path d="M380,225 L500,200 L620,205 L700,225 Z"
            fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.85" />
          {/* splitter */}
          <path d="M180,290 L260,290 L260,295 L180,295 Z"
            fill="hsl(188 95% 55%)" opacity="0.5" />
          {/* rear wing */}
          <path d="M740,200 L860,205 L860,212 L740,210 Z"
            fill="hsl(188 95% 55%)" opacity="0.6" />
          <line x1="780" y1="212" x2="780" y2="240" stroke="hsl(188 95% 55%)" strokeWidth="1.2" opacity="0.6" />
          <line x1="830" y1="212" x2="830" y2="240" stroke="hsl(188 95% 55%)" strokeWidth="1.2" opacity="0.6" />
          {/* canards */}
          <path d="M225,265 L260,260 L260,266 L225,270 Z" fill="hsl(188 95% 55%)" opacity="0.5" />
          {/* wheels */}
          <circle cx="290" cy="295" r="28" fill="hsl(220 26% 6%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.7" />
          <circle cx="290" cy="295" r="14" fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" opacity="0.6" />
          <circle cx="780" cy="295" r="28" fill="hsl(220 26% 6%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.7" />
          <circle cx="780" cy="295" r="14" fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.6" opacity="0.6" />

          {/* Pressure dots — splitter & wing peaks */}
          <circle cx="220" cy="285" r="3" fill="hsl(0 75% 58%)" opacity="0.9" />
          <circle cx="240" cy="282" r="2.5" fill="hsl(38 95% 58%)" opacity="0.8" />
          <circle cx="800" cy="208" r="3" fill="hsl(188 95% 55%)" opacity="0.9" />
          <circle cx="820" cy="210" r="2.5" fill="hsl(188 100% 75%)" opacity="0.8" />
        </g>

        {/* Annotations */}
        <g className="text-mono" style={{ font: "10px 'JetBrains Mono', monospace" }}>
          <line x1="220" y1="280" x2="180" y2="340" stroke="hsl(188 95% 55%)" strokeWidth="0.6" opacity="0.6" />
          <text x="80" y="345" fill="hsl(188 95% 55%)" opacity="0.9">SPLITTER · Cp +0.9</text>
          <line x1="800" y1="208" x2="860" y2="120" stroke="hsl(188 95% 55%)" strokeWidth="0.6" opacity="0.6" />
          <text x="780" y="115" fill="hsl(188 95% 55%)" opacity="0.9">WING · Cp −1.86</text>
          <line x1="900" y1="240" x2="950" y2="190" stroke="hsl(188 95% 55%)" strokeWidth="0.6" opacity="0.6" />
          <text x="860" y="185" fill="hsl(188 95% 55%)" opacity="0.9">WAKE · ω̄ 1500</text>
        </g>
      </svg>

      {/* Floating data tiles */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <StatusChip tone="simulating">Estimated flow · live</StatusChip>
          <ConfidenceBadge level="medium" compact />
        </div>
        <div className="hidden md:flex items-center gap-4 text-mono text-[10px] text-muted-foreground">
          <div><span className="text-muted-foreground/60">U∞ </span><span className="text-foreground">180 km/h</span></div>
          <div><span className="text-muted-foreground/60">α </span><span className="text-foreground">0.8°</span></div>
          <div><span className="text-muted-foreground/60">ρ </span><span className="text-foreground">1.225</span></div>
        </div>
      </div>

      {/* Bottom data strip */}
      <div className="absolute inset-x-4 bottom-4 grid grid-cols-3 gap-3">
        {[
          { l: "AERO LOAD",  v: "284", u: "kgf", d: "+18.4%" },
          { l: "DRAG EST.",  v: "112", u: "kgf", d: "+4.1%" },
          { l: "L/D TEND.",  v: "2.54", u: "",   d: "+0.31" },
        ].map((s) => (
          <div key={s.l} className="glass-strong rounded-md px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{s.l}</span>
              <span className="text-mono text-[10px] text-success">{s.d}</span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-mono text-xl font-semibold tabular-nums text-primary">{s.v}</span>
              {s.u && <span className="text-mono text-[10px] text-muted-foreground">{s.u}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div className="absolute inset-0 bg-[radial-gradient(80%_50%_at_50%_-10%,hsl(188_95%_55%/0.12),transparent_60%)] pointer-events-none" />
      <div className="relative mx-auto max-w-7xl px-6 pt-12 pb-20">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8 items-center">
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/60 px-3 py-1 text-mono text-[11px] uppercase tracking-widest text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              Geometry-aware aero studio · design-stage
            </div>

            <h1 className="mt-6 text-5xl md:text-6xl font-semibold leading-[1.04] tracking-tight">
              Design aero packages for{" "}
              <span className="text-primary glow-text">enthusiast and track cars.</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
              Pick your chassis. Configure splitter, wing, diffuser, skirts and canards.
              See an approximate, geometry-aware aero estimate with comparative
              flow, pressure and wake visualisations — built to compare packages,
              not to certify them.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="hero" size="lg" asChild>
                <Link to="/garage">Start a build <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button variant="glass" size="lg" asChild>
                <Link to="/auth"><PlayCircle className="mr-2 h-4 w-4" /> Sign in</Link>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4 text-mono text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Comparative aero · not validated CFD
              </span>
              <span className="hidden sm:inline text-muted-foreground/40">·</span>
              <span>Free to start · no card required</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <HeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Trust strip                                                        */
/* ─────────────────────────────────────────────────────────────────── */
function TrustStrip() {
  return (
    <section className="border-y border-border bg-surface-1/40">
      <div className="mx-auto max-w-7xl px-6 py-6 flex flex-wrap items-center gap-x-8 gap-y-3 justify-between">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Trusted by club racers, time-attack teams &amp; aero engineers
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-mono text-[11px] text-muted-foreground/80">
          <span>NORTHGATE MOTORSPORT</span>
          <span>APEX TIME ATTACK</span>
          <span>HACHIROKU GARAGE</span>
          <span>RIDGE RACING DIV.</span>
          <span>STRATA ENGINEERING</span>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  What it does                                                       */
/* ─────────────────────────────────────────────────────────────────── */
function WhatItDoes() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">What is AeroLab</div>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight leading-tight">
            A comparative aero studio,<br />built for the people who actually drive the car.
          </h2>
        </div>
        <div className="lg:col-span-7 space-y-4 text-base text-muted-foreground leading-relaxed">
          <p>
            AeroLab compresses the aero design conversation into a single platform —
            chassis, parts, package mode and post-processing.
            You work on parametric baselines for supported cars so deltas between
            configurations stay meaningful and easy to read.
          </p>
          <p>
            Every variant produces the same kind of output a development engineer
            would reach for: estimated drag tendency, approximate aero load,
            balance, comparative pressure and wake — with the assumptions and
            confidence shown clearly alongside.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Capabilities — value props                                         */
/* ─────────────────────────────────────────────────────────────────── */
const capabilities = [
  {
    icon: Cpu,
    title: "Geometry-aware estimator",
    body: "A deterministic surrogate model derives drag, aero load and balance from your chassis dimensions and selected aero parts. Updates instantly as you tune.",
    chip: "Real-time preview",
  },
  {
    icon: Layers,
    title: "Parametric aero parts",
    body: "Splitter, canards, skirts, diffuser, ducktail and rear wing — all driven by sliders. Each part contributes to the comparative aero estimate.",
    chip: "Real-time preview",
  },
  {
    icon: GitCompareArrows,
    title: "Comparative variants",
    body: "Compare baseline vs street vs track packages side by side. See per-component contribution and balance shift between configurations.",
    chip: "Side-by-side",
  },
  {
    icon: ShieldCheck,
    title: "Honest outputs",
    body: "Every figure shows its confidence and assumptions. Built for design-stage decisions, not OEM homologation or race-day claims.",
    chip: "High confidence",
  },
  {
    icon: Gauge,
    title: "Premium 3D visualisation",
    body: "Estimated streamlines, approximate pressure zones, conceptual wake plume and force vectors — rendered in real time with cinematic studio lighting.",
    chip: "Real-time preview",
  },
  {
    icon: FileDown,
    title: "Export the package",
    body: "Promote a winning configuration and export a PDF report, raw CSV dataset and a summary STL of the aero package for fabrication discussions.",
    chip: "Optimized",
  },
];

function Capabilities() {
  return (
    <section id="capabilities" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Capabilities</div>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight">
            Engineering software that respects your time.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Six things AeroLab does well — so you can spend the weekend tuning, not modelling.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((c) => (
            <div key={c.title} className="group relative bg-card p-6 transition-colors hover:bg-surface-2">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-1 text-primary group-hover:border-primary/40 transition-colors">
                  <c.icon className="h-4 w-4" />
                </div>
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                  0{capabilities.indexOf(c) + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{c.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{c.body}</p>
              <div className="mt-4">
                <StatusChip tone={c.chip === "Solver-backed" ? "solver" : c.chip === "Real-time preview" ? "simulating" : c.chip === "High confidence" ? "high" : c.chip === "Optimized" ? "optimized" : "neutral"}>
                  {c.chip}
                </StatusChip>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Use cases                                                          */
/* ─────────────────────────────────────────────────────────────────── */
const useCases = [
  {
    label: "Street",
    title: "Subtle, daily-friendly",
    body: "Restrained splitter, low-key wing, usable ride height. Lower drag penalty, no aggressive stance compromises.",
    metric: "Cd −2%",
  },
  {
    label: "Track day",
    title: "Balanced grip pack",
    body: "Assertive front and rear aero, balance-focused. Moderate drag increase accepted in exchange for cornering load.",
    metric: "DF +24%",
  },
  {
    label: "Time attack",
    title: "Aggressive package",
    body: "Big wing, deep splitter, diffuser, canards. Drag accepted in exchange for maximum aero load and stability.",
    metric: "DF +44%",
  },
];

function UseCases() {
  return (
    <section className="border-t border-border bg-surface-1/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Use cases</div>
            <h2 className="mt-2 text-4xl font-semibold tracking-tight">Three modes. One studio.</h2>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            Street, track day and time attack. Each mode shifts the package
            recommendation, the visual presentation and the trade-off language.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {useCases.map((u) => (
            <div key={u.label} className="glass relative overflow-hidden rounded-xl p-6 transition-all hover:border-primary/30 hover:shadow-glow">
              <div className="absolute inset-x-0 top-0 h-px stat-line opacity-50" />
              <div className="flex items-center justify-between">
                <span className="text-mono text-[10px] uppercase tracking-widest text-primary">
                  {u.label}
                </span>
                <span className="text-mono text-[11px] tabular-nums text-success">{u.metric}</span>
              </div>
              <h3 className="mt-4 text-xl font-semibold tracking-tight">{u.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{u.body}</p>

              {/* tiny chart indicator */}
              <div className="mt-6 flex items-end gap-1 h-10">
                {[40, 55, 50, 68, 65, 78, 72, 88, 82, 95, 90, 100].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-primary/30 to-primary/80" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Workflow                                                           */
/* ─────────────────────────────────────────────────────────────────── */
const workflow = [
  { n: "01", icon: Box,             title: "Select your chassis",       body: "Pick a supported car with a parametric baseline — or upload your own STL for visual reference.", to: "/garage" },
  { n: "02", icon: Wrench,          title: "Configure aero parts",      body: "Splitter, canards, skirts, diffuser, ducktail, wing — all parametric, all live-previewable.",  to: "/parts" },
  { n: "03", icon: PlayCircle,      title: "Pick a package mode",       body: "Street, track day or time attack. Mode shifts the recommendation and the visual presentation.", to: "/simulation" },
  { n: "04", icon: BarChart3,       title: "Read the aero estimate",    body: "Approximate aero load, drag tendency, balance, pressure and wake — confidence shown clearly.", to: "/results" },
  { n: "05", icon: GitCompareArrows,title: "Compare packages",          body: "Side-by-side comparison of baseline, street, track and time-attack configurations.",            to: "/compare" },
  { n: "06", icon: FileDown,        title: "Export your package",       body: "PDF report, CSV dataset and STL summary — ready for fabrication discussions or your shop.",     to: "/exports" },
];

function Workflow() {
  return (
    <section id="workflow" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Workflow</div>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight">
            From garage to grid in six clear steps.
          </h2>
          <p className="mt-3 text-muted-foreground">
            The pipeline mirrors how a development engineer iterates a package — staged, reviewable, reversible.
          </p>
        </div>

        <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workflow.map((s, i) => (
            <li key={s.n}>
              <Link
                to={s.to}
                className="group relative block h-full rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:bg-surface-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-mono text-[11px] tracking-widest text-muted-foreground">STEP {s.n}</span>
                  <s.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
                <div className="mt-5 inline-flex items-center text-mono text-[11px] uppercase tracking-widest text-primary/80 group-hover:text-primary transition-colors">
                  Open {s.title.split(" ")[0].toLowerCase()}
                  <ArrowRight className="ml-1.5 h-3 w-3" />
                </div>
                {i < workflow.length - 1 && (
                  <div className="absolute -right-[1px] top-1/2 hidden h-px w-4 -translate-y-1/2 bg-gradient-to-r from-primary/40 to-transparent lg:block" />
                )}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Outputs preview                                                    */
/* ─────────────────────────────────────────────────────────────────── */
function OutputsPreview() {
  const variants = [
    { n: "Baseline",  s: "OEM trim",     df: 240, dr: 108, ld: 2.22, bal: 44.4, accent: false },
    { n: "Variant A", s: "Street pack",  df: 268, dr: 109, ld: 2.46, bal: 43.1, accent: false },
    { n: "Variant B", s: "Track pack",   df: 284, dr: 112, ld: 2.54, bal: 42.6, accent: true  },
  ];

  return (
    <section id="outputs" className="border-t border-border bg-gradient-to-b from-background to-surface-1/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Outputs</div>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight">Premium aero output, honest framing.</h2>
          <p className="mt-3 text-muted-foreground">
            Every variant produces a comparative aero summary —
            visualised in a UI built for fast, confident decisions.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-12">
          {/* Left — pressure-style viewer */}
          <div className="lg:col-span-7 glass-strong rounded-xl p-2">
            <div className="rounded-lg border border-border bg-surface-0 overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="text-mono text-[10px] uppercase tracking-widest text-primary/90">Approximate pressure</span>
                  <span className="text-mono text-[10px] text-muted-foreground">Cp · midplane est.</span>
                </div>
                <StatusChip tone="success">Estimated</StatusChip>
              </div>

              <div className="relative h-72 grid-bg">
                <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_50%,hsl(188_95%_55%/0.08),transparent_70%)]" />
                <svg viewBox="0 0 800 280" className="absolute inset-0 h-full w-full">
                  <defs>
                    <linearGradient id="bf" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
                    </linearGradient>
                  </defs>
                  {[...Array(16)].map((_, i) => (
                    <path key={i}
                      d={`M0,${30 + i * 14} C200,${20 + i * 13} 380,${110 + i * 9} 600,${80 + i * 11} S800,${100 + i * 10} 800,${100 + i * 10}`}
                      stroke="hsl(188 95% 55%)" strokeWidth="0.8" fill="none" opacity={0.5 - i * 0.025} />
                  ))}
                  <path d="M120,200 L180,160 L300,140 L420,130 L520,138 L600,160 L680,200 L120,200 Z"
                    fill="url(#bf)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
                  {/* Cp dots */}
                  {[...Array(28)].map((_, i) => (
                    <circle key={i}
                      cx={150 + (i % 7) * 75} cy={160 + Math.floor(i / 7) * 12} r="2.5"
                      fill={`hsl(${i % 3 === 0 ? "0" : "188"} 95% ${50 + (i % 4) * 8}%)`} opacity="0.85" />
                  ))}
                  <circle cx="220" cy="205" r="20" fill="hsl(220 26% 8%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
                  <circle cx="580" cy="205" r="20" fill="hsl(220 26% 8%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.6" />
                </svg>
              </div>

              <div className="border-t border-border p-3">
                <ColorRamp label="Cp" min="−2.1" max="+1.0" ticks={["−2", "−1", "0", "+1"]} />
              </div>
            </div>
          </div>

          {/* Right — compare table */}
          <div className="lg:col-span-5 space-y-4">
            <div className="glass rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Compare</div>
                  <div className="mt-1 text-sm font-medium">3 variants · CIVIC_FK8</div>
                </div>
                <StatusChip tone="solver">Comparative</StatusChip>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="text-left font-normal pb-2">Variant</th>
                    <th className="text-right font-normal pb-2">DF</th>
                    <th className="text-right font-normal pb-2">DR</th>
                    <th className="text-right font-normal pb-2">L/D</th>
                  </tr>
                </thead>
                <tbody className="text-mono tabular-nums">
                  {variants.map((v) => (
                    <tr key={v.n} className="border-t border-border/50">
                      <td className="py-3 pr-3">
                        <div className={`text-sm font-medium font-sans ${v.accent ? "text-primary" : "text-foreground"}`}>{v.n}</div>
                        <div className="text-mono text-[10px] text-muted-foreground">{v.s}</div>
                      </td>
                      <td className="text-right py-3">{v.df}</td>
                      <td className="text-right py-3">{v.dr}</td>
                      <td className={`text-right py-3 ${v.accent ? "text-primary" : ""}`}>{v.ld}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between text-mono text-[11px]">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Δ best vs baseline</span>
                  <span className="text-success">+44 kgf · +0.32 L/D</span>
                </div>
              </div>
            </div>

            <div className="glass rounded-xl p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80 mb-3">Force breakdown</div>
              <div className="space-y-2 text-xs">
                {[
                  { l: "Rear wing", v: 148, w: 55 },
                  { l: "Diffuser",  v: 46,  w: 20 },
                  { l: "Splitter",  v: 38,  w: 15 },
                  { l: "Canards",   v: 12,  w: 6 },
                ].map((r) => (
                  <div key={r.l}>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{r.l}</span>
                      <span className="text-mono">{r.v} kgf</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${r.w}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="hero" size="lg" asChild>
            <Link to="/garage">Start a build <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button variant="glass" size="lg" asChild>
            <Link to="/design-system">View design system</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Pricing teaser                                                     */
/* ─────────────────────────────────────────────────────────────────── */
const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/forever",
    blurb: "For curious builders running their first comparisons.",
    features: ["3 estimates / month", "Geometry-aware estimator", "1 active variant", "PDF export (watermarked)"],
    cta: "Start free",
    variant: "glass" as const,
  },
  {
    name: "Pro",
    price: "$29",
    period: "/month",
    blurb: "For enthusiasts iterating an aero package across a season.",
    features: ["Unlimited estimates", "All package modes", "Unlimited variants", "STL & CSV export", "Priority support"],
    cta: "Start Pro trial",
    variant: "hero" as const,
    highlighted: true,
  },
  {
    name: "Team",
    price: "Custom",
    period: "",
    blurb: "For workshops, race teams and aero engineers.",
    features: ["High-fidelity estimator", "Shared garage", "Custom geometries", "Validation correlation tools", "Onboarding & support"],
    cta: "Talk to us",
    variant: "glass" as const,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="text-center max-w-2xl mx-auto">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Pricing</div>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight">
            Pay for the studio, not the seat.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Start free. Move to Pro when you're iterating an aero package every weekend.
            Team unlocks the high-fidelity estimator and shared garages.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-xl p-6 ${t.highlighted
                ? "glass-strong ring-1 ring-primary/30 shadow-glow"
                : "glass"}`}
            >
              {t.highlighted && (
                <span className="absolute -top-2.5 left-6 inline-flex items-center gap-1 rounded-full border border-primary/40 bg-background px-2.5 py-0.5 text-mono text-[10px] uppercase tracking-widest text-primary">
                  <Zap className="h-3 w-3" /> Most popular
                </span>
              )}
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold tracking-tight">{t.name}</h3>
                <div className="text-right">
                  <span className={`text-3xl font-semibold tabular-nums ${t.highlighted ? "text-primary" : ""}`}>
                    {t.price}
                  </span>
                  {t.period && <span className="text-mono text-xs text-muted-foreground">{t.period}</span>}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t.blurb}</p>

              <ul className="mt-6 space-y-2.5 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className={`h-4 w-4 shrink-0 mt-0.5 ${t.highlighted ? "text-primary" : "text-success"}`} />
                    <span className="text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>

              <Button variant={t.variant} size="lg" className="mt-7 w-full" asChild>
                <Link to="/garage">{t.cta} <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-mono text-[11px] text-muted-foreground">
          All tiers include comparative aero outputs · honest confidence labelling · cancel anytime
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Final CTA                                                          */
/* ─────────────────────────────────────────────────────────────────── */
function FinalCTA() {
  return (
    <section className="relative border-t border-border overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_30%,hsl(188_95%_55%/0.18),transparent_70%)] pointer-events-none" />
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="relative mx-auto max-w-4xl px-6 py-28 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1/60 px-3 py-1 text-mono text-[11px] uppercase tracking-widest text-muted-foreground backdrop-blur">
          <Activity className="h-3 w-3 text-primary" />
          First aero estimate · under 60 seconds
        </div>
        <h2 className="mt-6 text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Stop guessing.<br />
          <span className="text-primary glow-text">Start comparing.</span>
        </h2>
        <p className="mt-6 max-w-xl mx-auto text-lg text-muted-foreground">
          Free to start. No card. Open a build, configure parts, and read your first
          comparative aero estimate in under a minute.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="hero" size="lg" asChild>
            <Link to="/garage">Start a build <ArrowRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          <Button variant="glass" size="lg" asChild>
            <Link to="/auth"><PlayCircle className="mr-2 h-4 w-4" /> Sign in</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Footer                                                             */
/* ─────────────────────────────────────────────────────────────────── */
function Footer() {
  const cols = [
    {
      title: "Platform",
      links: ["Garage", "Build workspace", "Solver", "Design system", "What's new"],
    },
    {
      title: "Resources",
      links: ["Documentation", "Engineering blog", "Sample runs", "Validation notes", "Changelog"],
    },
    {
      title: "Company",
      links: ["About", "Careers", "Press kit", "Contact", "Status"],
    },
    {
      title: "Legal",
      links: ["Terms", "Privacy", "Cookies", "Acceptable use", "Disclaimer"],
    },
  ];

  return (
    <footer className="border-t border-border bg-surface-1/40">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
                <Wind className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">AeroLab</div>
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Comparative aero studio
                </div>
              </div>
            </div>
            <p className="mt-5 max-w-sm text-sm text-muted-foreground leading-relaxed">
              Geometry-aware comparative aero for enthusiast and track cars.
              Real-time visualisation, honest confidence, exportable packages.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <Button variant="glass" size="icon" className="h-8 w-8"><Twitter className="h-3.5 w-3.5" /></Button>
              <Button variant="glass" size="icon" className="h-8 w-8"><Github className="h-3.5 w-3.5" /></Button>
              <Button variant="glass" size="icon" className="h-8 w-8"><Youtube className="h-3.5 w-3.5" /></Button>
            </div>
          </div>

          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-8">
            {cols.map((c) => (
              <div key={c.title}>
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{c.title}</div>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {c.links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-foreground/80 hover:text-primary transition-colors">{l}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 pt-6 border-t border-border flex flex-wrap items-center justify-between gap-4 text-mono text-[11px] text-muted-foreground">
          <div>© {new Date().getFullYear()} AeroLab Engineering. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              All systems operational
            </span>
            <span>v0.4 · build 218</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Landing = () => {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* global backdrop */}
      <div className="absolute inset-x-0 top-0 h-px stat-line" />
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <WhatItDoes />
        <Capabilities />
        <UseCases />
        <Workflow />
        <OutputsPreview />
        <Pricing />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
};

export default Landing;
