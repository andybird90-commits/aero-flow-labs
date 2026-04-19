/**
 * Compare — pick 2-4 variants from the current build and see ranked metrics
 * + a Drag/Downforce scatter. All data from simulation_results.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { useVariants, useGeometry, type Variant, type SimResult } from "@/lib/repo";
import { estimateAero, aeroFromResult } from "@/lib/aero-estimator";
import {
  GitCompareArrows, Plus, X, Crown, Trophy, FileDown,
  TrendingUp, TrendingDown, Minus, ChevronDown, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

const COLORS = ["hsl(215 14% 58%)", "hsl(188 95% 55%)", "hsl(150 70% 50%)", "hsl(38 95% 58%)"];
const DOTS = ["bg-muted-foreground", "bg-primary", "bg-success", "bg-warning"];

const Compare = () => (
  <WorkspaceShell>
    {(ctx) => <CompareContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

type VariantWithResult = Variant & { results: SimResult[] };

function CompareContent({ buildId }: { buildId: string }) {
  const [search, setSearch] = useSearchParams();
  const { data: variants = [], isLoading } = useVariants(buildId);
  const { data: geometry } = useGeometry(buildId);

  // Comma-separated ids in ?vs=
  const initial = (search.get("vs") ?? "").split(",").filter(Boolean);
  const [selected, setSelected] = useState<string[]>(initial);

  // Initialise: prefer baseline + 2 others
  useEffect(() => {
    if (variants.length === 0 || selected.length > 0) return;
    const baseline = variants.find((v) => v.is_baseline) ?? variants[0];
    const others = variants.filter((v) => v.id !== baseline?.id).slice(0, 2);
    setSelected([baseline?.id, ...others.map((v) => v.id)].filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  // Persist selection in URL
  useEffect(() => {
    if (selected.length === 0) return;
    const next = new URLSearchParams(search);
    next.set("vs", selected.join(","));
    setSearch(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.join(",")]);

  const compared = useMemo(() => {
    return selected
      .map((id) => variants.find((v) => v.id === id))
      .filter((v): v is VariantWithResult => Boolean(v))
      .map((v) => {
        const latest = v.results?.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0];
        const est = estimateAero([], geometry); // components per-variant aren't loaded here; falls through to result if present
        const aero = aeroFromResult(latest, est);
        return { variant: v, result: latest, aero };
      });
  }, [selected, variants, geometry]);

  const baseline = compared.find((c) => c.variant.is_baseline) ?? compared[0];

  const onAdd = (id: string) =>
    setSelected((s) => (s.length < 4 && !s.includes(id) ? [...s, id] : s));
  const onRemove = (id: string) =>
    setSelected((s) => (s.length > 2 ? s.filter((x) => x !== id) : s));

  if (isLoading) {
    return (
      <div className="px-6 py-6">
        <LoadingState />
      </div>
    );
  }

  if (variants.length < 2) {
    return (
      <div className="px-6 py-6">
        <EmptyState
          icon={<GitCompareArrows className="h-5 w-5 text-primary" />}
          title="Need at least 2 variants"
          description="Create or duplicate variants on the Build page to compare them here."
          action={
            <Button variant="hero" size="sm" asChild>
              <Link to={`/build?id=${buildId}`}>Open build</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const available = variants.filter((v) => !selected.includes(v.id));

  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
            Step 05 · Variant comparison
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Compare variants</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Side-by-side aero metrics. Variants without a simulation run use surrogate estimates,
            shown with a yellow indicator.
          </p>
        </div>
        <Button variant="glass" size="sm" asChild>
          <Link to={`/exports?id=${buildId}`}>
            <FileDown className="mr-2 h-3.5 w-3.5" /> Export comparison
          </Link>
        </Button>
      </div>

      {/* Variant chooser */}
      <VariantChooser
        compared={compared}
        available={available}
        onAdd={onAdd}
        onRemove={onRemove}
      />

      {/* Ranked cards */}
      <div className="mt-4">
        <RankedCards entries={compared} baseline={baseline} />
      </div>

      {/* Scatter */}
      <div className="mt-4">
        <DragDownforceChart entries={compared} />
      </div>

      {/* Comparison table */}
      <div className="mt-4">
        <ComparisonTable entries={compared} baseline={baseline} />
      </div>
    </div>
  );
}

/* ─── Chooser ──────────────────────────────────────────────── */
function VariantChooser({
  compared, available, onAdd, onRemove,
}: {
  compared: { variant: VariantWithResult }[];
  available: VariantWithResult[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">In comparison</h3>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {compared.length} of 4
          </span>
        </div>
        <div className="relative">
          <Button
            variant="glass"
            size="sm"
            disabled={available.length === 0 || compared.length >= 4}
            onClick={() => setOpen((v) => !v)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add variant
            <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
          </Button>
          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-md border border-border bg-surface-1 shadow-elevated overflow-hidden">
                {available.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => { onAdd(v.id); setOpen(false); }}
                    className="w-full px-3 py-2 text-left hover:bg-primary/5 border-b border-border/50 last:border-b-0"
                  >
                    <div className="text-sm font-medium truncate">{v.name}</div>
                    {v.tag && <div className="text-mono text-[10px] text-muted-foreground">{v.tag}</div>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="p-3 flex flex-wrap gap-2">
        {compared.map(({ variant }, i) => (
          <div key={variant.id} className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-1 pl-2 pr-1 py-1.5">
            <span className={cn("h-2 w-2 rounded-full", DOTS[i])} />
            <div className="leading-tight pr-1">
              <div className="text-xs font-medium">{variant.name}</div>
              {variant.tag && <div className="text-mono text-[9px] text-muted-foreground">{variant.tag}</div>}
            </div>
            {compared.length > 2 && (
              <button
                onClick={() => onRemove(variant.id)}
                className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Ranked cards ─────────────────────────────────────────── */
function RankedCards({
  entries, baseline,
}: {
  entries: ReturnType<typeof useEntriesType>;
  baseline: ReturnType<typeof useEntriesType>[number] | undefined;
}) {
  const ranked = [...entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.aero.ld - a.e.aero.ld);
  if (!baseline) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {ranked.map((r, rank) => {
        const { variant, aero, result } = r.e;
        const i = r.i;
        const dCd = ((aero.cd - baseline.aero.cd) / baseline.aero.cd) * 100;
        const dDF = aero.df_total_kgf - baseline.aero.df_total_kgf;
        const dLD = aero.ld - baseline.aero.ld;
        const isLeader = rank === 0 && entries.length > 1;

        return (
          <div
            key={variant.id}
            className={cn(
              "glass rounded-xl overflow-hidden flex flex-col",
              isLeader && "ring-1 ring-primary/40 shadow-glow",
            )}
          >
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
                <span className={cn("h-2 w-2 rounded-full", DOTS[i])} />
                {variant.tag && (
                  <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {variant.tag}
                  </span>
                )}
              </div>
              {result ? (
                <ConfidenceBadge level={result.confidence} compact />
              ) : (
                <StatusChip tone="warning" size="sm">est.</StatusChip>
              )}
            </div>

            <div className="p-4 flex-1 flex flex-col">
              <div className="text-base font-semibold tracking-tight truncate">{variant.name}</div>

              <div className="mt-3 rounded-md border border-border bg-surface-1/60 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">L/D ratio</span>
                  <DeltaInline v={dLD} dec={2} />
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-mono">
                  {aero.ld.toFixed(2)}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Stat l="Cd" v={aero.cd.toFixed(3)} delta={dCd} invert pct />
                <Stat l="Drag" v={`${aero.drag_kgf}`} u="kgf" delta={aero.drag_kgf - baseline.aero.drag_kgf} invert />
                <Stat l="DF total" v={`${aero.df_total_kgf > 0 ? "+" : ""}${aero.df_total_kgf}`} u="kgf" delta={dDF} highlight />
                <Stat l="Balance F" v={`${aero.balance_front_pct.toFixed(1)}%`} delta={aero.balance_front_pct - baseline.aero.balance_front_pct} suffix="pp" />
              </div>

              <div className="mt-auto pt-4">
                <Button variant="glass" size="sm" className="w-full h-8 text-xs" asChild>
                  <Link to={`/results?id=${variant.build_id}&v=${variant.id}`}>
                    <Eye className="mr-1.5 h-3 w-3" /> Open
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        );
      })}
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

function Stat({ l, v, u, delta, invert, pct, suffix, highlight }: {
  l: string; v: string; u?: string; delta: number; invert?: boolean; pct?: boolean; suffix?: string; highlight?: boolean;
}) {
  return (
    <div className={cn("rounded border border-border/60 bg-surface-0/40 p-2", highlight && "border-primary/30 bg-primary/5")}>
      <div className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground">{l}</div>
      <div className="flex items-baseline justify-between gap-1 mt-0.5">
        <span className={cn("text-mono tabular-nums", highlight ? "text-primary font-semibold" : "text-foreground")}>
          {v}{u && <span className="text-[9px] text-muted-foreground ml-0.5">{u}</span>}
        </span>
        <DeltaInline v={delta} pct={pct} invert={invert} dec={Math.abs(delta) < 1 ? 2 : 1} />
        {suffix && <span className="text-mono text-[9px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

/* ─── Scatter ──────────────────────────────────────────────── */
function DragDownforceChart({ entries }: { entries: ReturnType<typeof useEntriesType> }) {
  if (entries.length === 0) return null;
  const drags = entries.map((e) => e.aero.drag_kgf);
  const dfs = entries.map((e) => e.aero.df_total_kgf);
  const xMin = Math.min(...drags) - 5, xMax = Math.max(...drags) + 5;
  const yMin = Math.min(...dfs, 0) - 20, yMax = Math.max(...dfs) + 20;
  const w = 600, h = 320, pad = 36;
  const x = (v: number) => pad + ((v - xMin) / (xMax - xMin)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - yMin) / (yMax - yMin)) * (h - pad * 2);

  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Drag vs Downforce</h3>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          higher-left is better
        </span>
      </div>
      <div className="p-4">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* grid */}
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`gx-${i}`}
              x1={pad + ((w - 2 * pad) / 4) * i} x2={pad + ((w - 2 * pad) / 4) * i}
              y1={pad} y2={h - pad}
              stroke="hsl(var(--border))" strokeWidth="0.4" />
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <line key={`gy-${i}`}
              x1={pad} x2={w - pad}
              y1={pad + ((h - 2 * pad) / 4) * i} y2={pad + ((h - 2 * pad) / 4) * i}
              stroke="hsl(var(--border))" strokeWidth="0.4" />
          ))}
          {/* axes */}
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="hsl(var(--border))" strokeWidth="0.8" />
          <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="hsl(var(--border))" strokeWidth="0.8" />
          {/* points */}
          {entries.map((e, i) => (
            <g key={e.variant.id}>
              <circle cx={x(e.aero.drag_kgf)} cy={y(e.aero.df_total_kgf)} r="6"
                fill={COLORS[i]} stroke="hsl(var(--background))" strokeWidth="2" />
              <text x={x(e.aero.drag_kgf) + 10} y={y(e.aero.df_total_kgf) - 6}
                fill="hsl(var(--foreground))"
                style={{ font: "10px 'JetBrains Mono', monospace" }}>
                {e.variant.name.slice(0, 18)}
              </text>
            </g>
          ))}
          {/* axis labels */}
          <text x={w - pad} y={h - 8} textAnchor="end" fill="hsl(var(--muted-foreground))"
            style={{ font: "10px 'JetBrains Mono', monospace" }}>
            Drag (kgf) →
          </text>
          <text x={pad + 8} y={pad + 4} fill="hsl(var(--muted-foreground))"
            style={{ font: "10px 'JetBrains Mono', monospace" }}>
            ↑ Downforce (kgf)
          </text>
        </svg>
      </div>
    </div>
  );
}

/* ─── Table ────────────────────────────────────────────────── */
function ComparisonTable({
  entries, baseline,
}: {
  entries: ReturnType<typeof useEntriesType>;
  baseline: ReturnType<typeof useEntriesType>[number] | undefined;
}) {
  if (!baseline) return null;
  const rows = [
    { label: "Drag coefficient (Cd)", get: (a: any) => a.cd.toFixed(3),                                    delta: (a: any) => ((a.cd - baseline.aero.cd) / baseline.aero.cd) * 100, invert: true, suffix: "%" },
    { label: "Drag (kgf)",            get: (a: any) => a.drag_kgf.toString(),                              delta: (a: any) => a.drag_kgf - baseline.aero.drag_kgf,                  invert: true },
    { label: "Front DF (kgf)",        get: (a: any) => `${a.df_front_kgf > 0 ? "+" : ""}${a.df_front_kgf}`, delta: (a: any) => a.df_front_kgf - baseline.aero.df_front_kgf },
    { label: "Rear DF (kgf)",         get: (a: any) => `${a.df_rear_kgf > 0 ? "+" : ""}${a.df_rear_kgf}`,  delta: (a: any) => a.df_rear_kgf - baseline.aero.df_rear_kgf },
    { label: "Total DF (kgf)",        get: (a: any) => `${a.df_total_kgf > 0 ? "+" : ""}${a.df_total_kgf}`, delta: (a: any) => a.df_total_kgf - baseline.aero.df_total_kgf },
    { label: "L/D ratio",             get: (a: any) => a.ld.toFixed(2),                                    delta: (a: any) => a.ld - baseline.aero.ld },
    { label: "Balance % front",       get: (a: any) => `${a.balance_front_pct.toFixed(1)}%`,               delta: (a: any) => a.balance_front_pct - baseline.aero.balance_front_pct, suffix: "pp" },
    { label: "Top speed (km/h)",      get: (a: any) => `${a.top_speed_kmh}`,                               delta: (a: any) => a.top_speed_kmh - baseline.aero.top_speed_kmh },
  ];

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold tracking-tight">Performance comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-1/50">
              <th className="text-left text-mono text-[10px] uppercase tracking-widest text-muted-foreground font-normal px-4 py-2">Metric</th>
              {entries.map(({ variant }, i) => (
                <th key={variant.id} className="text-right text-mono text-[10px] uppercase tracking-widest font-normal px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", DOTS[i])} />
                    <span className="text-foreground">{variant.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.label} className="hover:bg-surface-1/40 transition-colors">
                <td className="px-4 py-2.5 text-foreground">{r.label}</td>
                {entries.map(({ variant, aero }) => {
                  const isBaseline = variant.id === baseline.variant.id;
                  const d = r.delta(aero);
                  return (
                    <td key={variant.id} className="px-3 py-2.5 text-right">
                      <div className="text-mono tabular-nums text-foreground">{r.get(aero)}</div>
                      {!isBaseline && (
                        <DeltaInline v={d} invert={r.invert} pct={r.suffix === "%"} dec={Math.abs(d) < 1 ? 2 : 1} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// type-helper alias
function useEntriesType() {
  return [] as Array<{
    variant: VariantWithResult;
    result: SimResult | undefined;
    aero: ReturnType<typeof aeroFromResult>;
  }>;
}

export default Compare;
