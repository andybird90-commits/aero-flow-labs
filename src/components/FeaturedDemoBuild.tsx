import { Link } from "react-router-dom";
import {
  DEMO_BUILD, DEMO_VARIANTS, DEMO_BASELINE, DEMO_OPTIMIZED,
  DEMO_ASSUMPTIONS, DEMO_ENV, deltaVs,
} from "@/lib/demo";
import { StatusChip } from "./StatusChip";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { Button } from "./ui/button";
import {
  Sparkles, ArrowRight, Crown, Wind, Activity, Gauge, Layers,
  TrendingUp, TrendingDown, Star, Target, GitCompareArrows, FileDown, PlayCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* Compact, premium hero of the GR86 demo build. */
export function FeaturedDemoBuild() {
  const opt = DEMO_OPTIMIZED;
  const base = DEMO_BASELINE;
  const d = deltaVs(opt, base);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-glow">
      {/* Top stat-line + subtle bg */}
      <div className="absolute inset-x-0 top-0 h-px stat-line" />
      <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_70%_0%,hsl(188_95%_55%/0.10),transparent_60%)]" />
      <div className="absolute inset-0 grid-bg-fine opacity-[0.18]" />

      <div className="relative grid gap-0 lg:grid-cols-12">
        {/* ── Left: identity + headline metric ── */}
        <div className="lg:col-span-5 p-6 border-b lg:border-b-0 lg:border-r border-border/60">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-mono text-[10px] uppercase tracking-widest text-primary">
              <Sparkles className="h-3 w-3" /> Showcase build
            </span>
            <Star className="h-3.5 w-3.5 fill-primary text-primary" />
          </div>

          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            {DEMO_BUILD.name}
          </h2>
          <p className="mt-1 text-mono text-[11px] text-muted-foreground">
            {DEMO_BUILD.car.make} {DEMO_BUILD.car.model} · {DEMO_BUILD.car.trim} · {DEMO_BUILD.car.drivetrain} · {DEMO_BUILD.car.mass} kg
          </p>

          {/* Hero L/D */}
          <div className="mt-5 flex items-end gap-6">
            <div>
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">L/D ratio</div>
              <div className="mt-1 text-mono text-5xl font-semibold tabular-nums leading-none text-primary">
                {opt.ld.toFixed(2)}
              </div>
              <div className="mt-1.5 inline-flex items-center gap-1 text-mono text-[11px] text-success">
                <TrendingUp className="h-3 w-3" /> +{(d.ld).toFixed(2)} vs baseline
              </div>
            </div>
            <div className="grow">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Total downforce</div>
              <div className="mt-1 text-mono text-3xl font-semibold tabular-nums leading-none">
                {opt.dfTotal}<span className="text-base text-muted-foreground ml-1">kgf</span>
              </div>
              <div className="mt-1.5 inline-flex items-center gap-1 text-mono text-[11px] text-success">
                <TrendingUp className="h-3 w-3" /> +{d.dfTotal} kgf
              </div>
            </div>
          </div>

          {/* Status row */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <StatusChip tone="optimized" size="sm">
              <Crown className="h-3 w-3 mr-0.5" /> Optimized
            </StatusChip>
            <StatusChip tone="solver" size="sm">Solver-backed CFD</StatusChip>
            <StatusChip tone="success" size="sm">Converged · 8.2e-5</StatusChip>
            <ConfidenceBadge level={opt.confidence} compact />
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="hero">
              <Link to="/results"><PlayCircle className="mr-1.5 h-3.5 w-3.5" /> Open results</Link>
            </Button>
            <Button asChild size="sm" variant="glass">
              <Link to="/compare"><GitCompareArrows className="mr-1.5 h-3.5 w-3.5" /> Compare variants</Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/exports"><FileDown className="mr-1.5 h-3.5 w-3.5" /> Export report</Link>
            </Button>
          </div>
        </div>

        {/* ── Middle: variant ladder ── */}
        <div className="lg:col-span-4 p-6 border-b lg:border-b-0 lg:border-r border-border/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">Variant ladder</h3>
            </div>
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {DEMO_VARIANTS.length} runs
            </span>
          </div>

          <div className="mt-3 space-y-1.5">
            {DEMO_VARIANTS.map((v) => {
              const isOpt = v.id === opt.id;
              const isBase = v.id === base.id;
              // Scale L/D from -0.5 → 3.0 onto bar
              const pct = Math.max(2, Math.min(100, ((v.ld + 0.5) / 3.5) * 100));
              return (
                <div key={v.id} className="group rounded-md border border-border/60 bg-surface-1/40 p-2.5 hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full shrink-0",
                        isBase ? "bg-muted-foreground" :
                        isOpt ? "bg-primary" : "bg-primary/40",
                      )} />
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{v.name}</div>
                        <div className="text-mono text-[9px] text-muted-foreground truncate">{v.tag} · Cd {v.cd.toFixed(3)}</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-mono text-xs tabular-nums font-semibold",
                        isOpt ? "text-primary" : isBase ? "text-muted-foreground" : "text-foreground",
                      )}>
                        {v.ld.toFixed(2)}
                      </div>
                      <div className="text-mono text-[9px] text-muted-foreground tabular-nums">L/D</div>
                    </div>
                  </div>
                  <div className="mt-1.5 relative h-1 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-full",
                        isOpt ? "bg-gradient-to-r from-primary to-primary-glow" :
                        isBase ? "bg-muted-foreground/40" : "bg-primary/40",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: assumptions + run meta ── */}
        <div className="lg:col-span-3 p-6 flex flex-col">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Run conditions</h3>
          </div>

          <dl className="mt-3 space-y-1.5 text-mono text-[11px]">
            {[
              { l: "U∞",      v: `${DEMO_ENV.speed} km/h` },
              { l: "Yaw",     v: `${DEMO_ENV.yaw}°` },
              { l: "ρ",       v: `${DEMO_ENV.density} kg/m³` },
              { l: "Solver",  v: DEMO_ENV.solver },
              { l: "Mesh",    v: `${DEMO_ENV.meshCells} cells` },
              { l: "y⁺",      v: DEMO_ENV.yPlus },
              { l: "Wall",    v: DEMO_ENV.walltime },
            ].map((m) => (
              <div key={m.l} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground shrink-0">{m.l}</dt>
                <dd className="text-right text-foreground tabular-nums truncate">{m.v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 pt-4 border-t border-border/60">
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              <h4 className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Assumptions</h4>
            </div>
            <ul className="mt-2 space-y-1">
              {DEMO_ASSUMPTIONS.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
                  <span className={cn(
                    "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                    a.impact === "good" ? "bg-success" :
                    a.impact === "warn" ? "bg-warning" : "bg-muted-foreground/60",
                  )} />
                  <span className="text-muted-foreground">{a.label}: <span className="text-foreground">{a.value}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom strip: deltas */}
      <div className="relative grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/60 border-t border-border/60 bg-surface-0/60">
        {[
          { l: "Cd",        v: opt.cd.toFixed(3),    delta: `${d.cd > 0 ? "+" : ""}${d.cd.toFixed(1)}%`, good: d.cd < 0, Icon: Wind },
          { l: "Drag",      v: `${opt.drag} kgf`,    delta: `${d.drag > 0 ? "+" : ""}${d.drag} kgf`,     good: d.drag < 0, Icon: Gauge },
          { l: "DF front",  v: `+${opt.dfFront} kgf`,delta: `+${opt.dfFront - base.dfFront} kgf`,        good: true, Icon: TrendingUp },
          { l: "Balance",   v: `${opt.balance.toFixed(1)}% F`, delta: `${(d.balance > 0 ? "+" : "")}${d.balance.toFixed(1)} pp`, good: true, Icon: Activity },
        ].map((m) => (
          <div key={m.l} className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <m.Icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">{m.l}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-mono text-base font-semibold tabular-nums text-foreground">{m.v}</span>
              <span className={cn("text-mono text-[10px] tabular-nums inline-flex items-center gap-0.5",
                m.good ? "text-success" : "text-destructive")}>
                {m.good ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {m.delta}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
