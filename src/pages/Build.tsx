/**
 * Build · Overview page
 * ─────────────────────
 * Real data: useCurrentBuild → variants + latest results per variant.
 * Surrogate aero estimator fills metrics until a real CFD job has run.
 */
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LoadingState } from "@/components/LoadingState";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import {
  PlayCircle, GitCompareArrows, Star, Plus, Copy, Trash2, ArrowRight,
  Maximize2, RotateCcw, Eye, EyeOff, Settings2, Wind, Gauge, Layers,
  Target, AlertTriangle, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useVariants, useComponents, useGeometry, useDuplicateVariant, useDeleteVariant,
  useCreateVariant, type Variant, type SimResult,
} from "@/lib/repo";
import { estimateAero, aeroFromResult, aeroDelta } from "@/lib/aero-estimator";
import { cn } from "@/lib/utils";

/* ─── 3D viewer (visual scenery, kept as-is) ─────────────────── */
type ViewMode = "geometry" | "pressure" | "velocity" | "wake";

function HeroViewer({ variantName, runStatus }: { variantName: string; runStatus: string }) {
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
      <div className="relative z-10 flex items-center justify-between border-b border-border bg-surface-0/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-1 rounded-md border border-border bg-surface-1 p-0.5">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded px-2.5 py-1 text-mono text-[10px] uppercase tracking-widest transition-colors",
                mode === m.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden md:inline text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {modes.find((m) => m.id === mode)?.sub}
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setShowLabels((v) => !v)}>
            {showLabels ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"><RotateCcw className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"><Settings2 className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="relative h-[420px]">
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
          </defs>
          {(mode === "velocity" || mode === "wake") && [...Array(28)].map((_, i) => (
            <path key={i}
              d={`M0,${40 + i * 14} C220,${30 + i * 13} 440,${160 + i * 8} 700,${130 + i * 10} S1000,${150 + i * 9} 1000,${150 + i * 9}`}
              stroke="url(#bvFlow)" strokeWidth="1" fill="none" opacity={0.7 - i * 0.018} />
          ))}
          <g transform="translate(0, 30)">
            <path d="M180,330 L260,290 L420,260 L580,255 L720,275 L820,300 L880,330 L180,330 Z"
              fill={mode === "geometry" ? "hsl(188 95% 55% / 0.06)" : "url(#bvBody)"}
              stroke="hsl(188 95% 55%)" strokeWidth="1.2" />
            <path d="M380,260 L500,232 L620,238 L700,260 Z" fill="hsl(220 24% 10%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.85" />
            <path d="M180,330 L260,330 L260,335 L180,335 Z" fill="hsl(188 95% 55%)" opacity="0.55" />
            <path d="M740,235 L860,240 L860,247 L740,245 Z" fill="hsl(188 95% 55%)" opacity="0.6" />
            <circle cx="290" cy="335" r="30" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.7" />
            <circle cx="780" cy="335" r="30" fill="hsl(220 26% 5%)" stroke="hsl(188 95% 55%)" strokeWidth="1" opacity="0.7" />
          </g>
          {showLabels && (
            <g style={{ font: "10px 'JetBrains Mono', monospace" }}>
              <text x="60" y="438" fill="hsl(188 95% 55%)" opacity="0.9">{variantName.toUpperCase()}</text>
              <text x="780" y="170" fill="hsl(188 95% 55%)" opacity="0.9">{mode.toUpperCase()}</text>
            </g>
          )}
        </svg>

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <StatusChip tone="simulating" size="sm">{runStatus}</StatusChip>
        </div>
        <div className="absolute top-3 right-3 flex items-center gap-3 rounded-md border border-border bg-surface-1/80 px-3 py-1.5 backdrop-blur text-mono text-[10px]">
          <div><span className="text-muted-foreground">U∞ </span><span className="text-foreground">200 km/h</span></div>
          <div><span className="text-muted-foreground">ρ </span><span className="text-foreground">1.225</span></div>
        </div>
      </div>
    </div>
  );
}

/* ─── Variant detail panel — uses real data ───────────────── */
function VariantPanel({ variant, baselineEst, current }: {
  variant: Variant & { results: SimResult[] };
  baselineEst: ReturnType<typeof estimateAero>;
  current: ReturnType<typeof estimateAero>;
}) {
  const latestResult = variant.results?.[0] ?? null;
  const aero = aeroFromResult(latestResult, current);
  const delta = aeroDelta(aero, baselineEst);

  const cells = [
    { label: "Cd",            value: aero.cd.toFixed(3), delta: delta.cd > 0 ? `+${delta.cd}` : `${delta.cd}`, good: delta.cd <= 0 },
    { label: "Drag · kgf",    value: String(aero.drag_kgf), delta: `${delta.drag >= 0 ? "+" : ""}${delta.drag}`, good: delta.drag <= 0 },
    { label: "L/D",           value: aero.ld.toFixed(2), delta: `${delta.ld >= 0 ? "+" : ""}${delta.ld}`, good: delta.ld >= 0, accent: true },
    { label: "DF · front",    value: String(aero.df_front_kgf), delta: `${delta.dfFront >= 0 ? "+" : ""}${delta.dfFront}`, good: delta.dfFront >= 0 },
    { label: "DF · rear",     value: String(aero.df_rear_kgf), delta: `${delta.dfRear >= 0 ? "+" : ""}${delta.dfRear}`, good: delta.dfRear >= 0 },
    { label: "DF · total",    value: String(aero.df_total_kgf), delta: `${delta.dfTotal >= 0 ? "+" : ""}${delta.dfTotal}`, good: delta.dfTotal >= 0, accent: true },
  ];

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Aero summary</h3>
          <StatusChip tone={aero.fromSim ? "solver" : "preview"} size="sm">
            {aero.fromSim ? (aero.isStale ? "Stale CFD" : "Solver-backed") : "Surrogate"}
          </StatusChip>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">@ 200 km/h</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 divide-x divide-y divide-border/60">
        {cells.map((c) => (
          <div key={c.label} className={cn("p-4", c.accent && "bg-primary/[0.04]")}>
            <div className={cn(
              "text-mono text-[10px] uppercase tracking-widest",
              c.accent ? "text-primary/80" : "text-muted-foreground",
            )}>{c.label}</div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className={cn("text-2xl font-semibold tabular-nums", c.accent && "text-primary")}>{c.value}</span>
            </div>
            <div className={cn(
              "mt-1 text-mono text-[10px]",
              c.good ? "text-success" : "text-destructive",
            )}>{c.delta} vs baseline</div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Aero balance · F %</span>
          </div>
          <span className="text-mono text-[11px] tabular-nums text-foreground">{aero.balance_front_pct.toFixed(1)}%</span>
        </div>
        <div className="relative mt-3 h-2 rounded-full bg-surface-2 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-primary" style={{ width: `${Math.max(0, Math.min(100, aero.balance_front_pct))}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ─── Variant strip ────────────────────────────────────────── */
function VariantStrip({
  variants, activeId, baselineEst, onSelect, onDuplicate, onDelete, onCreate,
}: {
  variants: (Variant & { results: SimResult[] })[];
  activeId: string;
  baselineEst: ReturnType<typeof estimateAero>;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Variants</h3>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{variants.length}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-3 p-4 min-w-max">
          {variants.map((v) => {
            const result = v.results?.[0];
            const est = result ? aeroFromResult(result, baselineEst) : baselineEst;
            const delta = aeroDelta(est, baselineEst);
            const isActive = v.id === activeId;
            const tone =
              v.status === "completed" ? "success" :
              v.status === "simulating" ? "simulating" :
              v.status === "failed" ? "failed" :
              v.is_baseline ? "neutral" : "preview";
            return (
              <div
                key={v.id}
                onClick={() => onSelect(v.id)}
                className={cn(
                  "relative w-60 cursor-pointer rounded-lg border p-3 transition-colors",
                  isActive ? "border-primary/40 bg-primary/[0.06] ring-1 ring-primary/20"
                           : "border-border bg-surface-1 hover:border-primary/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {v.id.slice(0, 6).toUpperCase()}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {v.is_baseline && <Star className="h-3 w-3 fill-primary text-primary shrink-0" />}
                      <span className="text-sm font-medium truncate">{v.name}</span>
                    </div>
                    {v.tag && <div className="text-mono text-[10px] text-muted-foreground truncate">{v.tag}</div>}
                  </div>
                  <StatusChip tone={tone as any} size="sm" dot={false}>
                    {v.status}
                  </StatusChip>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-mono text-[11px] tabular-nums">
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">DF</div>
                    <div className="text-foreground">{est.df_total_kgf}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Drag</div>
                    <div className="text-foreground">{est.drag_kgf}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground">L/D</div>
                    <div className={isActive ? "text-primary" : "text-foreground"}>{est.ld.toFixed(2)}</div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  {result ? (
                    <ConfidenceBadge level={result.confidence as any} compact />
                  ) : (
                    <span className="text-mono text-[10px] text-muted-foreground">Surrogate</span>
                  )}
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDuplicate(v.id); }}
                      className="p-1 text-muted-foreground hover:text-primary transition-colors"
                      title="Duplicate"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    {!v.is_baseline && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <button
            onClick={onCreate}
            className="flex w-40 items-center justify-center rounded-lg border border-dashed border-border bg-surface-1/30 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            <Plus className="mr-2 h-4 w-4" /> New variant
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────── */
const Build = () => {
  return (
    <WorkspaceShell>
      {(ctx) => <BuildContent buildId={ctx.buildId!} />}
    </WorkspaceShell>
  );
};

function BuildContent({ buildId }: { buildId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: variants = [], isLoading } = useVariants(buildId);
  const { data: geometry } = useGeometry(buildId);
  const duplicate = useDuplicateVariant();
  const del = useDeleteVariant();
  const create = useCreateVariant();

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = variants.find((v) => v.id === activeId)
    ?? variants.find((v) => !v.is_baseline)
    ?? variants[0];
  const baseline = variants.find((v) => v.is_baseline) ?? variants[0];

  const { data: activeComponents = [] } = useComponents(active?.id);
  const { data: baselineComponents = [] } = useComponents(baseline?.id);

  const baselineEst = useMemo(
    () => estimateAero(baselineComponents, geometry),
    [baselineComponents, geometry],
  );
  const currentEst = useMemo(
    () => estimateAero(activeComponents, geometry),
    [activeComponents, geometry],
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <LoadingState label="Loading build" sublabel="Fetching variants and components" />
      </div>
    );
  }

  if (!variants.length || !active) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <EmptyState
          icon={<Wind className="h-5 w-5 text-primary" />}
          title="No variants yet"
          description="Add a variant to start iterating on aero packages."
          action={
            <Button
              variant="hero"
              size="sm"
              onClick={async () => {
                if (!user) return;
                await create.mutateAsync({
                  userId: user.id, buildId, geometryId: geometry?.id ?? null,
                  name: "Baseline", tag: "OEM",
                });
                toast({ title: "Variant created" });
              }}
            >
              <Plus className="mr-2 h-3.5 w-3.5" /> Add baseline variant
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-6 space-y-6">
      <HeroViewer variantName={active.name} runStatus={`${active.status} · ${active.id.slice(0,6)}`} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <VariantPanel variant={active as any} baselineEst={baselineEst} current={currentEst} />
        </div>
        <div className="space-y-4">
          {/* Quick actions */}
          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">Quick actions</h3>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="glass" size="sm" asChild className="justify-start">
                <Link to={`/geometry?id=${buildId}`}>
                  <ArrowRight className="mr-2 h-3.5 w-3.5" /> Edit geometry
                </Link>
              </Button>
              <Button variant="glass" size="sm" asChild className="justify-start">
                <Link to={`/parts?id=${buildId}&v=${active.id}`}>
                  <ArrowRight className="mr-2 h-3.5 w-3.5" /> Edit aero parts
                </Link>
              </Button>
              <Button variant="hero" size="sm" asChild className="justify-start">
                <Link to={`/simulation?id=${buildId}&v=${active.id}`}>
                  <PlayCircle className="mr-2 h-3.5 w-3.5" /> Run CFD on this variant
                </Link>
              </Button>
            </div>
            {!active.results?.[0] && (
              <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/5 p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                <p className="text-mono text-[10px] text-muted-foreground leading-relaxed">
                  Numbers above are surrogate estimates. Run the solver for solver-backed results.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <VariantStrip
        variants={variants}
        activeId={active.id}
        baselineEst={baselineEst}
        onSelect={setActiveId}
        onDuplicate={async (id) => {
          try {
            await duplicate.mutateAsync(id);
            toast({ title: "Variant duplicated" });
          } catch (e: any) {
            toast({ title: "Couldn't duplicate", description: e.message, variant: "destructive" });
          }
        }}
        onDelete={async (id) => {
          if (!confirm("Delete this variant and its results?")) return;
          try {
            await del.mutateAsync(id);
            toast({ title: "Variant deleted" });
            if (activeId === id) setActiveId(null);
          } catch (e: any) {
            toast({ title: "Couldn't delete", description: e.message, variant: "destructive" });
          }
        }}
        onCreate={async () => {
          if (!user) return;
          try {
            const v = await create.mutateAsync({
              userId: user.id, buildId, geometryId: geometry?.id ?? null,
              name: `Variant ${variants.length}`, tag: null,
            });
            toast({ title: "Variant created" });
            setActiveId(v.id);
          } catch (e: any) {
            toast({ title: "Couldn't create", description: e.message, variant: "destructive" });
          }
        }}
      />
    </div>
  );
}

export default Build;
