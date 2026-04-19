/**
 * Results — the showpiece.
 * A premium real-time 3D aero visualisation of the selected variant with
 * comparative aero overlays (Estimated Flow, Pressure View, Wake View, Forces, Compare).
 *
 * Honest positioning: this view shows *approximate*, *geometry-aware* aero
 * estimates. It is not validated industrial CFD — it is design-stage guidance
 * driven by a deterministic surrogate model and reactive 3D overlays.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { CarViewer3D, type ViewerMode } from "@/components/CarViewer3D";
import { PackageModePicker } from "@/components/PackageModePicker";
import {
  useVariants, useLatestResult, useGeometry, useComponents, useBuild,
} from "@/lib/repo";
import {
  aeroFromResult, aeroDelta, estimateAero,
} from "@/lib/aero-estimator";
import { getPackageMode, type PackageMode } from "@/lib/aero-package-modes";
import {
  PlayCircle, GitCompareArrows, FileDown, TrendingUp, TrendingDown, Minus,
  BarChart3, Wind, Gauge, Target, Activity, ShieldCheck, AlertTriangle,
  Wand2, Cloud, Crosshair, Eye, RotateCcw, Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWER_MODES: { id: ViewerMode; label: string; sub: string; icon: typeof Wind }[] = [
  { id: "flow",     label: "Estimated Flow", sub: "Streamline overlay",      icon: Wind },
  { id: "pressure", label: "Pressure View",  sub: "Approximate Cp zones",    icon: Wand2 },
  { id: "wake",     label: "Wake View",      sub: "Conceptual wake plume",   icon: Cloud },
  { id: "forces",   label: "Forces",         sub: "Direction & magnitude",   icon: Crosshair },
  { id: "compare",  label: "Compare",        sub: "Baseline ghost overlay",  icon: GitCompareArrows },
];

const Results = () => (
  <WorkspaceShell>
    {(ctx) => <ResultsContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

function ResultsContent({ buildId }: { buildId: string }) {
  const [search, setSearch] = useSearchParams();
  const { data: variants = [], isLoading } = useVariants(buildId);
  const { data: build } = useBuild(buildId);

  const baselineVar = variants.find((v) => v.is_baseline) ?? variants[0];
  const selectedId = search.get("v") ?? baselineVar?.id;
  const selectedVar = variants.find((v) => v.id === selectedId) ?? baselineVar;

  const { data: result } = useLatestResult(selectedVar?.id);
  const { data: baselineResult } = useLatestResult(baselineVar?.id);
  const { data: components = [] } = useComponents(selectedVar?.id);
  const { data: baselineComponents = [] } = useComponents(baselineVar?.id);
  const { data: geometry } = useGeometry(buildId);

  const [viewerMode, setViewerMode] = useState<ViewerMode>("flow");
  const [packageMode, setPackageMode] = useState<PackageMode>(
    (search.get("pkg") as PackageMode) ?? "track",
  );

  const estimate = useMemo(
    () => estimateAero(components, geometry),
    [components, geometry],
  );
  const baselineEstimate = useMemo(
    () => estimateAero(baselineComponents, geometry),
    [baselineComponents, geometry],
  );

  const current = aeroFromResult(result, estimate);
  const baseline = aeroFromResult(baselineResult, baselineEstimate);
  const delta = aeroDelta(current, baseline);
  const pkg = getPackageMode(packageMode);

  const setVariant = (v: string) => {
    const next = new URLSearchParams(search);
    next.set("v", v);
    setSearch(next, { replace: true });
  };

  const setPkg = (m: PackageMode) => {
    setPackageMode(m);
    const next = new URLSearchParams(search);
    next.set("pkg", m);
    setSearch(next, { replace: true });
  };

  if (isLoading) {
    return <div className="px-6 py-6"><LoadingState /></div>;
  }

  if (!selectedVar) {
    return (
      <div className="px-6 py-6">
        <EmptyState
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
          title="No variants yet"
          description="Create a variant on the Build page to see comparative aero estimates here."
        />
      </div>
    );
  }

  const template = (build as any)?.car?.template;

  return (
    <div className="px-4 md:px-6 py-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
            Step 04 · Comparative aero visualisation
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Results</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Geometry-aware aero estimate for the selected variant. Visual overlays are
            comparative and design-stage, not validated industrial CFD.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" asChild>
            <Link to={`/compare?id=${buildId}`}>
              <GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare
            </Link>
          </Button>
          <Button variant="hero" size="sm" asChild>
            <Link to={`/exports?id=${buildId}&v=${selectedVar.id}`}>
              <FileDown className="mr-2 h-3.5 w-3.5" /> Export
            </Link>
          </Button>
        </div>
      </div>

      {/* Hero 3D viewer */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
        {/* Top toolbar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-0/85 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
            {VIEWER_MODES.map((m) => {
              const Icon = m.icon;
              const active = viewerMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setViewerMode(m.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                  title={m.sub}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{m.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <PackageModePicker value={packageMode} onChange={setPkg} compact />
            <div className="hidden md:flex items-center gap-3 rounded-md border border-border bg-surface-1 px-3 py-1 text-mono text-[10px]">
              <div><span className="text-muted-foreground">U∞ </span><span className="text-foreground">200 km/h</span></div>
              <div><span className="text-muted-foreground">ρ </span><span className="text-foreground">1.225</span></div>
            </div>
          </div>
        </div>

        {/* The viewer */}
        <div className="relative h-[560px] bg-[radial-gradient(60%_60%_at_50%_45%,hsl(188_95%_55%/0.08),transparent_70%)]">
          <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
          <CarViewer3D
            template={template}
            geometry={geometry}
            components={components}
            estimate={current}
            baselineEstimate={baseline}
            mode={viewerMode}
            packageMode={packageMode}
            compareGhost={viewerMode === "compare"}
          />

          {/* Top-left status */}
          <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
            {result ? (
              <>
                <StatusChip tone="success" size="sm">{viewerLabel(viewerMode)}</StatusChip>
                <ConfidenceBadge level={result.confidence} compact />
                {result.is_stale && (
                  <StatusChip tone="warning" size="sm">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Re-estimate
                  </StatusChip>
                )}
              </>
            ) : (
              <StatusChip tone="preview" size="sm">
                <Activity className="mr-1 h-3 w-3" /> Geometry-aware estimate
              </StatusChip>
            )}
          </div>

          {/* Bottom-right legend / readouts */}
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between pointer-events-none">
            <ViewerLegend mode={viewerMode} estimate={current} />
            <div className="hidden md:grid grid-cols-3 gap-2">
              {[
                { l: "Cd",          v: current.cd.toFixed(3),                 d: delta.cdPct, invert: true, pct: true },
                { l: "DF total",    v: `${current.df_total_kgf > 0 ? "+" : ""}${current.df_total_kgf} kgf`, d: delta.dfTotal },
                { l: "L/D",         v: current.ld.toFixed(2),                 d: delta.ld, dec: 2 },
              ].map((s) => (
                <div key={s.l} className="glass-strong rounded-md px-3 py-2 pointer-events-auto">
                  <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">{s.l}</div>
                  <div className="flex items-baseline gap-1.5 mt-0.5">
                    <span className="text-mono text-lg font-semibold tabular-nums text-primary">{s.v}</span>
                  </div>
                  <DeltaInline v={s.d} pct={s.pct} invert={s.invert} dec={s.dec ?? 1} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Variant strip */}
      <div className="glass rounded-xl p-3">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Variant — {variants.length} on this build
        </div>
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => {
            const isSel = v.id === selectedVar.id;
            return (
              <button
                key={v.id}
                onClick={() => setVariant(v.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left transition-colors",
                  isSel
                    ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30"
                    : "border-border bg-surface-1 hover:border-primary/30",
                )}
              >
                <div className="flex items-center gap-2">
                  {v.is_baseline && (
                    <span className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">Baseline</span>
                  )}
                  <span className={cn("text-sm font-medium", isSel ? "text-primary" : "text-foreground")}>{v.name}</span>
                </div>
                {v.tag && <div className="text-mono text-[10px] text-muted-foreground mt-0.5">{v.tag}</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Approximate result cards — pivoted copy */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ApproxCard
          label="Estimated drag tendency"
          value={current.cd.toFixed(3)}
          unit="Cd"
          delta={delta.cdPct}
          dec={1}
          pct
          invert
          icon={Wind}
          hint={`${current.drag_kgf} kgf @ 200 km/h`}
        />
        <ApproxCard
          label="Approximate aero load"
          value={`${current.df_total_kgf > 0 ? "+" : ""}${current.df_total_kgf}`}
          unit="kgf"
          delta={delta.dfTotal}
          icon={Target}
          hint={`Front ${current.df_front_kgf} · Rear ${current.df_rear_kgf}`}
          accent
        />
        <ApproxCard
          label="Aero balance tendency"
          value={`${current.balance_front_pct.toFixed(1)}`}
          unit="% front"
          delta={delta.balance}
          suffix=" pp"
          icon={Crosshair}
          hint={pkg.label}
        />
        <ApproxCard
          label="Likely top speed"
          value={`${current.top_speed_kmh}`}
          unit="km/h"
          delta={delta.topSpeed}
          icon={Gauge}
          hint="Drag-limited estimate"
        />
      </div>

      {/* Trade-off + confidence */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="glass rounded-xl p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold tracking-tight mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Likely trade-offs · {pkg.label}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2 text-[12px] text-muted-foreground leading-relaxed">
            <TradeoffRow label="Stability tendency" value={tradeoffStability(current, baseline)} />
            <TradeoffRow label="Expected drag penalty" value={tradeoffDrag(delta.cdPct)} />
            <TradeoffRow label="Comparative wake reduction" value={tradeoffWake(delta.cdPct)} />
            <TradeoffRow label="Road usability" value={tradeoffUsability(packageMode)} />
            <TradeoffRow label="Fabrication complexity" value={tradeoffComplexity(packageMode)} />
            <TradeoffRow label="Visual aggression" value={tradeoffAggression(packageMode)} />
          </ul>
        </div>
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold tracking-tight mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Approximation confidence
          </h3>
          {result ? (
            <ConfidenceBadge
              level={result.confidence}
              detail={`${result.kind === "full" ? "Full pass" : "Preview pass"} · ${new Date(result.created_at).toLocaleDateString()}`}
            />
          ) : (
            <ConfidenceBadge level="medium" detail="Geometry-aware surrogate · run a pass to refine" />
          )}
          <ul className="mt-3 space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
            {(Array.isArray(result?.confidence_reasons) && (result?.confidence_reasons as string[]).length
              ? (result!.confidence_reasons as string[])
              : assumptionsFor(geometry, template)
            ).map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-mono text-[11px] text-muted-foreground">
          {result
            ? `Last estimated ${new Date(result.created_at).toLocaleString()}`
            : "No comparative passes yet for this variant"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="glass" size="sm" asChild>
            <Link to={`/simulation?id=${buildId}&v=${selectedVar.id}`}>
              <PlayCircle className="mr-2 h-3.5 w-3.5" /> Run aero pass
            </Link>
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link to={`/parts?id=${buildId}&v=${selectedVar.id}`}>
              <Eye className="mr-2 h-3.5 w-3.5" /> Edit aero parts
            </Link>
          </Button>
          <Button variant="hero" size="sm" asChild>
            <Link to={`/exports?id=${buildId}&v=${selectedVar.id}`}>
              <FileDown className="mr-2 h-3.5 w-3.5" /> Export aero summary
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────── */

function viewerLabel(m: ViewerMode) {
  switch (m) {
    case "flow":     return "Estimated flow · live";
    case "pressure": return "Approximate pressure · live";
    case "wake":     return "Conceptual wake · live";
    case "forces":   return "Force vectors · estimate";
    case "compare":  return "Baseline overlay · comparative";
  }
}

function ViewerLegend({ mode, estimate }: { mode: ViewerMode; estimate: ReturnType<typeof aeroFromResult> }) {
  if (mode === "pressure") {
    return (
      <div className="glass-strong rounded-md p-2.5 pointer-events-auto">
        <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">Cp · approximate</div>
        <div className="mt-1.5 h-1.5 w-40 rounded-full bg-gradient-to-r from-[#22d3ee] via-[#f97316] to-[#ef4444]" />
        <div className="mt-1 flex justify-between text-mono text-[9px] text-muted-foreground/80">
          <span>−1.8</span><span>0</span><span>+1.0</span>
        </div>
      </div>
    );
  }
  if (mode === "wake") {
    return (
      <div className="glass-strong rounded-md p-2.5 pointer-events-auto">
        <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">Wake · conceptual</div>
        <div className="mt-1 text-mono text-[10px] text-foreground">drag {estimate.drag_kgf} kgf</div>
      </div>
    );
  }
  if (mode === "flow") {
    return (
      <div className="glass-strong rounded-md p-2.5 pointer-events-auto">
        <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">Streamlines · estimated</div>
        <div className="mt-1 text-mono text-[10px] text-foreground">~density reacts to package</div>
      </div>
    );
  }
  if (mode === "forces") {
    return (
      <div className="glass-strong rounded-md p-2.5 pointer-events-auto">
        <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">Force vectors</div>
        <div className="mt-1 flex items-center gap-3 text-mono text-[10px]">
          <span><span className="inline-block h-2 w-2 rounded-full bg-destructive mr-1" />drag</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-primary mr-1" />downforce</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-warning mr-1" />lift</span>
        </div>
      </div>
    );
  }
  return (
    <div className="glass-strong rounded-md p-2.5 pointer-events-auto">
      <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">Compare</div>
      <div className="mt-1 text-mono text-[10px] text-foreground">Baseline ghost overlay</div>
    </div>
  );
}

function ApproxCard({
  label, value, unit, delta, pct, invert, dec = 1, icon: Icon, hint, accent, suffix,
}: {
  label: string; value: string; unit?: string; delta: number;
  pct?: boolean; invert?: boolean; dec?: number; icon: typeof Wind; hint?: string;
  accent?: boolean; suffix?: string;
}) {
  const better = invert ? delta < 0 : delta > 0;
  const tone = delta === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Arrow = delta === 0 ? Minus : better ? (invert ? TrendingDown : TrendingUp) : (invert ? TrendingUp : TrendingDown);
  return (
    <div className={cn("glass rounded-xl p-4 relative overflow-hidden", accent && "ring-1 ring-primary/30")}>
      {accent && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />}
      <div className="flex items-center gap-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={cn("text-mono text-3xl font-semibold tabular-nums", accent && "text-primary")}>{value}</span>
        {unit && <span className="text-mono text-xs text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className={cn("inline-flex items-center gap-1 text-mono text-[11px]", tone)}>
          <Arrow className="h-3 w-3" />
          {delta > 0 ? "+" : ""}{delta.toFixed(dec)}{pct ? "%" : suffix ?? ""}
          <span className="text-muted-foreground/70 ml-1">vs baseline</span>
        </span>
        {hint && <span className="text-mono text-[10px] text-muted-foreground/80">{hint}</span>}
      </div>
    </div>
  );
}

function DeltaInline({ v, dec = 1, pct, invert }: { v: number; dec?: number; pct?: boolean; invert?: boolean }) {
  const better = invert ? v < 0 : v > 0;
  const tone = v === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Arrow = v === 0 ? Minus : better ? (invert ? TrendingDown : TrendingUp) : (invert ? TrendingUp : TrendingDown);
  return (
    <span className={cn("text-mono text-[10px] flex items-center gap-1", tone)}>
      <Arrow className="h-3 w-3" />
      {v > 0 ? "+" : ""}{v.toFixed(dec)}{pct ? "%" : ""}
    </span>
  );
}

function TradeoffRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border/40 pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/90 text-right">{value}</span>
    </li>
  );
}

function tradeoffStability(cur: any, base: any): string {
  const dRear = cur.df_rear_kgf - base.df_rear_kgf;
  if (dRear > 25) return "Likely improvement at high speed";
  if (dRear > 5) return "Mild improvement";
  if (dRear < -10) return "Reduction — adjust rear";
  return "Comparable to baseline";
}
function tradeoffDrag(d: number): string {
  if (d > 8) return "Notable penalty (~+8% or more)";
  if (d > 3) return "Moderate penalty";
  if (d < -2) return "Improvement vs baseline";
  return "Roughly neutral";
}
function tradeoffWake(d: number): string {
  if (d < -2) return "Cleaner wake expected";
  if (d > 4) return "Larger wake expected";
  return "Comparable wake structure";
}
function tradeoffUsability(m: PackageMode): string {
  return m === "street" ? "Daily-friendly" : m === "track" ? "Track-day friendly" : "Time-attack only";
}
function tradeoffComplexity(m: PackageMode): string {
  return m === "street" ? "Bolt-on level" : m === "track" ? "Mounting + ducting" : "Full fabrication";
}
function tradeoffAggression(m: PackageMode): string {
  return m === "street" ? "Restrained" : m === "track" ? "Assertive" : "Full motorsport";
}

function assumptionsFor(geometry: any, template: any): string[] {
  const out: string[] = [];
  out.push(`Baseline vehicle class matched from template${template?.make ? ` (${template.make} ${template.model})` : ""}`);
  if (!geometry || geometry.underbody_model === "simplified") out.push("Underbody inferred · simplified plate");
  if (!geometry || geometry.wheel_rotation === "static") out.push("Wheel rotation simplified · static rims");
  out.push("Rear geometry partially inferred from class");
  out.push("Streamlines and wake are estimated, not solver fields");
  return out;
}

export default Results;
