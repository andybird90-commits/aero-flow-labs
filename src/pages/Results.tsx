/**
 * Results — shows the latest simulation_result for the selected variant of
 * the current build. All numbers come from the database.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { useVariants, useLatestResult, useGeometry, useComponents } from "@/lib/repo";
import { aeroFromResult, aeroDelta, estimateAero, type AeroEstimate } from "@/lib/aero-estimator";
import {
  PlayCircle, GitCompareArrows, FileDown, TrendingUp, TrendingDown, Minus,
  BarChart3, Wind, Gauge, Target, Activity, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const Results = () => {
  return (
    <WorkspaceShell>
      {(ctx) => <ResultsContent buildId={ctx.buildId!} />}
    </WorkspaceShell>
  );
};

function ResultsContent({ buildId }: { buildId: string }) {
  const [search, setSearch] = useSearchParams();
  const { data: variants = [], isLoading } = useVariants(buildId);

  const baselineVar = variants.find((v) => v.is_baseline) ?? variants[0];
  const selectedId = search.get("v") ?? baselineVar?.id;
  const selectedVar = variants.find((v) => v.id === selectedId) ?? baselineVar;

  const { data: result } = useLatestResult(selectedVar?.id);
  const { data: baselineResult } = useLatestResult(baselineVar?.id);
  const { data: components = [] } = useComponents(selectedVar?.id);
  const { data: baselineComponents = [] } = useComponents(baselineVar?.id);
  const { data: geometry } = useGeometry(buildId);

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

  const setVariant = (v: string) => {
    const next = new URLSearchParams(search);
    next.set("v", v);
    setSearch(next, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="px-6 py-6">
        <LoadingState />
      </div>
    );
  }

  if (!selectedVar) {
    return (
      <div className="px-6 py-6">
        <EmptyState
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
          title="No variants yet"
          description="Create a variant on the Build page to see results here."
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
            Step 04 · CFD results
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Results</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Live aero metrics for the selected variant. Numbers come from the most recent
            simulation; if no run exists yet, surrogate estimates are shown.
          </p>
        </div>
        <Button variant="hero" size="sm" asChild>
          <Link to={`/exports?id=${buildId}&v=${selectedVar.id}`}>
            <FileDown className="mr-2 h-3.5 w-3.5" /> Export report
          </Link>
        </Button>
      </div>

      {/* Variant picker */}
      <div className="glass rounded-xl p-3 mb-4">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Variant
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
                    <span className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      Baseline
                    </span>
                  )}
                  <span className={cn("text-sm font-medium", isSel ? "text-primary" : "text-foreground")}>
                    {v.name}
                  </span>
                </div>
                {v.tag && (
                  <div className="text-mono text-[10px] text-muted-foreground mt-0.5">{v.tag}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary status */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {result ? (
          <>
            <StatusChip tone="solver" size="sm">Solver-backed</StatusChip>
            <StatusChip tone="success" size="sm">{result.kind === "full" ? "Full CFD" : "Preview"}</StatusChip>
            <ConfidenceBadge level={result.confidence} compact />
            {result.is_stale && (
              <StatusChip tone="warning" size="sm">
                <AlertTriangle className="mr-1 h-3 w-3" /> Stale — re-run after geometry changes
              </StatusChip>
            )}
          </>
        ) : (
          <StatusChip tone="warning" size="sm">
            <Activity className="mr-1 h-3 w-3" /> Surrogate estimate · run a simulation for solver-backed values
          </StatusChip>
        )}
      </div>

      {/* Hero metric grid */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <HeroMetric label="Drag coefficient" value={current.cd.toFixed(3)} delta={delta.cdPct} pct invert icon={Wind} />
        <HeroMetric label="L/D ratio" value={current.ld.toFixed(2)} delta={delta.ld} dec={2} icon={ShieldCheck} />
        <HeroMetric label="Total downforce" value={`${current.df_total_kgf > 0 ? "+" : ""}${current.df_total_kgf}`} unit="kgf" delta={delta.dfTotal} icon={Target} />
        <HeroMetric label="Top speed" value={`${current.top_speed_kmh}`} unit="km/h" delta={delta.topSpeed} invert={false} icon={Gauge} />
      </div>

      {/* Detailed grid */}
      <div className="grid gap-4 lg:grid-cols-3 mt-4">
        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold tracking-tight mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Forces
          </h3>
          <dl className="space-y-2 text-sm">
            <Row k="Drag" v={`${current.drag_kgf} kgf`} delta={delta.drag} invert />
            <Row k="Downforce front" v={`${current.df_front_kgf} kgf`} delta={delta.dfFront} />
            <Row k="Downforce rear" v={`${current.df_rear_kgf} kgf`} delta={delta.dfRear} />
            <Row k="Aero balance" v={`${current.balance_front_pct.toFixed(1)} % front`} delta={delta.balance} suffix=" pp" />
          </dl>
        </div>

        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold tracking-tight mb-3 flex items-center gap-2">
            <Wind className="h-4 w-4 text-primary" /> Pressure
          </h3>
          {result ? (
            <dl className="space-y-2 text-sm">
              <Row k="Cp · stagnation" v={result.cp_stagnation?.toFixed(2) ?? "—"} />
              <Row k="Cp · roof peak" v={result.cp_roof?.toFixed(2) ?? "—"} />
              <Row k="Cp · underfloor" v={result.cp_underfloor?.toFixed(2) ?? "—"} />
              <Row k="Cp · wing" v={result.cp_wing?.toFixed(2) ?? "—"} />
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pressure coefficients will appear after the next CFD run.
            </p>
          )}
        </div>

        <div className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold tracking-tight mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" /> Scoring
          </h3>
          {result ? (
            <dl className="space-y-2 text-sm">
              <Row k="Track score" v={result.track_score ? `${result.track_score}/100` : "—"} />
              <Row k="Stability score" v={result.stability_score ? `${result.stability_score}/100` : "—"} />
              <Row k="Confidence" v={result.confidence} />
              <Row k="Result kind" v={result.kind} />
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">No scored result yet.</p>
          )}
        </div>
      </div>

      {/* Confidence reasons */}
      {result && Array.isArray(result.confidence_reasons) && result.confidence_reasons.length > 0 && (
        <div className="glass rounded-xl p-4 mt-4">
          <h3 className="text-sm font-semibold tracking-tight mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Confidence notes
          </h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground leading-relaxed">
            {(result.confidence_reasons as string[]).map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bottom actions */}
      <div className="mt-6 glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-mono text-[11px] text-muted-foreground">
          {result
            ? `Run from ${new Date(result.created_at).toLocaleString()}`
            : "No simulation runs yet"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="glass" size="sm" asChild>
            <Link to={`/simulation?id=${buildId}&v=${selectedVar.id}`}>
              <PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation
            </Link>
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link to={`/compare?id=${buildId}`}>
              <GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare variants
            </Link>
          </Button>
          <Button variant="hero" size="sm" asChild>
            <Link to={`/exports?id=${buildId}&v=${selectedVar.id}`}>
              <FileDown className="mr-2 h-3.5 w-3.5" /> Export report
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function HeroMetric({
  label, value, unit, delta, pct, invert, dec = 1, icon: Icon,
}: {
  label: string; value: string; unit?: string; delta: number;
  pct?: boolean; invert?: boolean; dec?: number; icon: typeof Wind;
}) {
  const better = invert ? delta < 0 : delta > 0;
  const tone = delta === 0 ? "text-muted-foreground" : better ? "text-success" : "text-destructive";
  const Arrow = delta === 0 ? Minus : better ? (invert ? TrendingDown : TrendingUp) : (invert ? TrendingUp : TrendingDown);
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center gap-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-mono text-3xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-mono text-xs text-muted-foreground">{unit}</span>}
      </div>
      <div className={cn("mt-1 inline-flex items-center gap-1 text-mono text-[11px]", tone)}>
        <Arrow className="h-3 w-3" />
        {delta > 0 ? "+" : ""}{delta.toFixed(dec)}{pct ? "%" : ""}
        <span className="text-muted-foreground/70 ml-1">vs baseline</span>
      </div>
    </div>
  );
}

function Row({ k, v, delta, invert, suffix }: {
  k: string; v: string; delta?: number; invert?: boolean; suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="flex items-center gap-2">
        <span className="text-mono tabular-nums">{v}</span>
        {delta !== undefined && delta !== 0 && (
          <span className={cn("text-mono text-[10px] tabular-nums",
            (invert ? delta < 0 : delta > 0) ? "text-success" : "text-destructive")}>
            {delta > 0 ? "+" : ""}{delta.toFixed(1)}{suffix ?? ""}
          </span>
        )}
      </dd>
    </div>
  );
}

export default Results;
