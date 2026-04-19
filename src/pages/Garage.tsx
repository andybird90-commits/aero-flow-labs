import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/StatCard";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { EmptyState } from "@/components/EmptyState";
import { FeaturedDemoBuild } from "@/components/FeaturedDemoBuild";
import { LoadingState } from "@/components/LoadingState";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useBuilds, useCarTemplates, useUserJobs, useSeedDemo } from "@/lib/repo";
import {
  Plus, Filter, ArrowRight, Wind, Lock, PlayCircle,
  Layers, Clock, Star, Sparkles, MoreHorizontal,
  ChevronRight, Target, Zap, Activity,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Helpers                                                            */
/* ─────────────────────────────────────────────────────────────────── */
const objectiveLabel: Record<string, string> = {
  top_speed: "Top speed", track_use: "Track use", balance: "Balance",
  high_speed_stability: "High speed", rear_grip: "Rear grip", custom: "Custom",
};
const objectiveIcon: Record<string, typeof Target> = {
  top_speed: Zap, track_use: Target, balance: Activity,
  high_speed_stability: Wind, rear_grip: Layers, custom: Sparkles,
};
const statusToTone: Record<string, Parameters<typeof StatusChip>[0]["tone"]> = {
  ready: "success", draft: "preview", archived: "neutral",
};
const statusLabel: Record<string, string> = {
  ready: "Ready", draft: "Draft", archived: "Archived",
};

function formatRelative(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Car silhouette                                                     */
/* ─────────────────────────────────────────────────────────────────── */
function CarSilhouette({ accent = false }: { accent?: boolean }) {
  const stroke = "hsl(188 95% 55%)";
  return (
    <svg viewBox="0 0 400 120" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
      {[...Array(8)].map((_, i) => (
        <path key={i}
          d={`M0,${20 + i * 10} C140,${15 + i * 9} 260,${70 + i * 6} 400,${60 + i * 8}`}
          stroke={stroke} strokeWidth="0.5" fill="none" opacity={0.25 - i * 0.02} />
      ))}
      <path d="M50,90 L90,68 L160,58 L240,55 L300,62 L340,72 L360,90 L50,90 Z"
        fill={accent ? "hsl(188 95% 55% / 0.18)" : "hsl(188 95% 55% / 0.08)"} stroke={stroke} strokeWidth="1" />
      <path d="M150,58 L220,46 L280,52 L300,62 Z"
        fill="hsl(220 24% 11%)" stroke={stroke} strokeWidth="0.7" opacity="0.9" />
      {accent && <path d="M310,48 L355,50 L355,55 L310,53 Z" fill={stroke} opacity="0.7" />}
      <circle cx="110" cy="93" r="11" fill="hsl(220 26% 6%)" stroke={stroke} strokeWidth="0.7" />
      <circle cx="290" cy="93" r="11" fill="hsl(220 26% 6%)" stroke={stroke} strokeWidth="0.7" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Build card                                                         */
/* ─────────────────────────────────────────────────────────────────── */
function BuildCard({ b }: { b: any }) {
  const ObjectiveIcon = objectiveIcon[b.objective] ?? Target;
  const accent = b.starred;
  const carLabel = b.car?.template
    ? `${b.car.template.make} ${b.car.template.model}`
    : b.car?.name ?? "—";
  const trim = b.car?.template?.trim ?? "";

  return (
    <div className={`group relative overflow-hidden rounded-xl border bg-card transition-all hover:border-primary/40 hover:shadow-glow ${accent ? "border-primary/30 ring-1 ring-primary/20" : "border-border"}`}>
      {accent && <div className="absolute inset-x-0 top-0 h-px stat-line" />}

      <div className="flex items-start justify-between border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{b.id.slice(0, 8)}</span>
            {b.starred && <Star className="h-3 w-3 fill-primary text-primary" />}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold tracking-tight">{b.name}</div>
          <div className="text-mono text-[11px] text-muted-foreground truncate">{carLabel}{trim && ` · ${trim}`}</div>
        </div>
        <button className="text-muted-foreground/60 hover:text-foreground transition-colors">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <div className="relative h-28 overflow-hidden border-b border-border/60 bg-surface-0">
        <div className="absolute inset-0 grid-bg-fine opacity-30" />
        <CarSilhouette accent={accent} />
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <StatusChip tone={statusToTone[b.status] ?? "neutral"} size="sm">{statusLabel[b.status] ?? b.status}</StatusChip>
        </div>
        <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1/80 px-2 py-0.5 backdrop-blur">
          <ObjectiveIcon className="h-3 w-3 text-primary" />
          <span className="text-mono text-[10px] uppercase tracking-widest text-foreground">{objectiveLabel[b.objective]}</span>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-1.5 text-mono text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {formatRelative(b.updated_at)}
        </div>
        <Button asChild size="sm" variant={accent ? "hero" : "glass"}>
          <Link to={`/build?id=${b.id}`}>Open <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Recent jobs                                                        */
/* ─────────────────────────────────────────────────────────────────── */
function RecentSimulations({ jobs }: { jobs: any[] }) {
  const stateChip = (s: string) => {
    if (s === "completed") return <StatusChip tone="success" size="sm">Converged</StatusChip>;
    if (s === "simulating" || s === "preprocessing" || s === "postprocessing") return <StatusChip tone="simulating" size="sm">Running</StatusChip>;
    if (s === "queued") return <StatusChip tone="preview" size="sm">Queued</StatusChip>;
    if (s === "failed") return <StatusChip tone="failed" size="sm">Failed</StatusChip>;
    if (s === "cancelled") return <StatusChip tone="warning" size="sm">Cancelled</StatusChip>;
    return <StatusChip tone="neutral" size="sm">{s}</StatusChip>;
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
      {jobs.length === 0 ? (
        <div className="p-6 text-center text-xs text-muted-foreground">No runs yet. Run your first simulation from a build.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {jobs.map((r) => (
            <div key={r.id} className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 hover:bg-surface-2/40 transition-colors">
              <div className="col-span-2 text-mono text-[11px] text-muted-foreground">#{r.id.slice(0, 6)}</div>
              <div className="col-span-5 min-w-0">
                <div className="truncate text-sm">{r.variant?.build?.name ?? "—"}</div>
                <div className="text-mono text-[10px] text-muted-foreground truncate">{r.variant?.name ?? "—"}</div>
              </div>
              <div className="col-span-2">{stateChip(r.state)}</div>
              <div className="col-span-3 text-right text-mono text-[11px] text-muted-foreground tabular-nums">
                {formatRelative(r.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Garage = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const { data: builds = [], isLoading: buildsLoading } = useBuilds(userId);
  const { data: jobs = [] } = useUserJobs(userId, 6);
  const { data: templates = [] } = useCarTemplates();
  const seedDemo = useSeedDemo();

  const hasDemoBuild = useMemo(
    () => builds.some((b: any) => b.name === "GR86 Time-Attack Pack"),
    [builds],
  );

  const handleSeedDemo = async () => {
    try {
      await seedDemo.mutateAsync();
      toast({ title: "Demo build ready", description: "GR86 Time-Attack Pack with 5 variants seeded." });
    } catch (err: any) {
      toast({ title: "Couldn't seed demo", description: err.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <PageHeader
          eyebrow="Workspace"
          title="Garage"
          description="Manage your vehicles, builds and simulation runs. Open a build to enter its workspace."
          actions={
            <>
              {!hasDemoBuild && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  onClick={handleSeedDemo}
                  disabled={seedDemo.isPending}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  {seedDemo.isPending ? "Seeding…" : "Load demo build"}
                </Button>
              )}
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
          <StatCard label="ACTIVE BUILDS" value={String(builds.length)} hint="all time" />
          <StatCard label="TOTAL RUNS"    value={String(jobs.length)} hint="recent" accent />
          <StatCard label="VEHICLES"      value={String(new Set(builds.map((b: any) => b.car_id)).size)} hint="in garage" />
          <StatCard label="SUPPORTED"     value={String(templates.filter((t: any) => t.supported).length)} hint="car templates" />
        </div>

        {/* Featured demo (only if user has it) */}
        {hasDemoBuild && (
          <div className="mt-6">
            <FeaturedDemoBuild />
          </div>
        )}

        {/* Main grid */}
        <div className="mt-6 grid gap-6 xl:grid-cols-12">
          <section className="xl:col-span-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold tracking-tight">Your builds</h2>
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {builds.length} total
                </span>
              </div>
            </div>

            {buildsLoading ? (
              <LoadingState />
            ) : builds.length === 0 ? (
              <EmptyState
                icon={<Wind className="h-5 w-5 text-primary" />}
                title="No builds yet"
                description="Start with the GR86 demo build to explore a complete workflow, or create your own from a supported vehicle."
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="hero" size="sm" onClick={handleSeedDemo} disabled={seedDemo.isPending}>
                      <Sparkles className="mr-2 h-3.5 w-3.5" />
                      {seedDemo.isPending ? "Seeding…" : "Load GR86 demo"}
                    </Button>
                    <Button variant="glass" size="sm" asChild>
                      <Link to="/build"><Plus className="mr-2 h-3.5 w-3.5" /> Create build</Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {builds.map((b: any) => <BuildCard key={b.id} b={b} />)}
                <Link
                  to="/build"
                  className="group flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-1/40 p-6 text-center transition-colors hover:border-primary/40 hover:bg-surface-1/60"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2 group-hover:border-primary/40 transition-colors">
                    <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="mt-3 text-sm font-medium">New build</div>
                  <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
                    Start from a supported car template.
                  </p>
                </Link>
              </div>
            )}
          </section>

          <aside className="xl:col-span-4 space-y-6">
            <RecentSimulations jobs={jobs} />
          </aside>
        </div>
      </div>
    </AppLayout>
  );
};

export default Garage;
