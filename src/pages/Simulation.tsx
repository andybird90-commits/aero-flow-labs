/**
 * Simulation page
 * ───────────────
 * Submits real CFD jobs via the simulate-variant edge function and shows
 * live progress driven by Supabase Realtime updates on simulation_jobs.
 *
 * Modes: preview (1 cr · ~10 s surrogate) · full (8 cr · ~45 s CFD).
 */
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ParamSlider } from "@/components/ParamSlider";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { JobProgress, type JobState } from "@/components/JobProgress";
import { LoadingState } from "@/components/LoadingState";
import { useToast } from "@/hooks/use-toast";
import {
  PlayCircle, Wind, Server, Sparkles, ShieldCheck, AlertTriangle, Activity,
  Coins, Clock, Cpu, Layers, ArrowRight, CheckCircle2, XCircle, History,
  Settings2, Gauge, Wrench,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useVariants, useGeometry, useVariantJobs, useRunSimulation, useJobRealtime,
  useProfile, useLatestResult, type SimJob, type Variant, type SimResult,
} from "@/lib/repo";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

type Kind = "preview" | "full";

const MODES: {
  id: Kind; label: string; sub: string; icon: typeof Wind;
  runtime: string; cost: number; confidence: "low" | "high"; tag: string;
}[] = [
  {
    id: "preview", label: "Preview Estimate", sub: "Surrogate ROM · ~10 s",
    icon: Sparkles, runtime: "≈ 10 s", cost: 1, confidence: "low", tag: "Surrogate",
  },
  {
    id: "full", label: "Full Simulation", sub: "RANS k-ω SST · ~45 s",
    icon: Server, runtime: "≈ 45 s", cost: 8, confidence: "high", tag: "CFD",
  },
];

/* ─── Map DB job state → JobProgress component state ─────────────── */
function mapJobState(state: SimJob["state"]): JobState {
  switch (state) {
    case "queued": return "queued";
    case "preprocessing":
    case "simulating":
    case "postprocessing": return "running";
    case "completed": return "converged";
    case "failed":
    case "cancelled": return "failed";
    default: return "queued";
  }
}

const Simulation = () => (
  <WorkspaceShell>
    {(ctx) => <SimulationContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

function SimulationContent({ buildId }: { buildId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useSearchParams();

  // Subscribe to realtime job updates app-wide
  useJobRealtime(user?.id);

  const { data: variants = [], isLoading: variantsLoading } = useVariants(buildId);
  const { data: geometry } = useGeometry(buildId);
  const { data: profile } = useProfile(user?.id);

  const queryV = search.get("v");
  const activeVariant =
    variants.find((v) => v.id === queryV) ??
    variants.find((v) => !v.is_baseline) ??
    variants[0];

  useEffect(() => {
    if (activeVariant && activeVariant.id !== queryV) {
      const next = new URLSearchParams(search);
      next.set("v", activeVariant.id);
      setSearch(next, { replace: true });
    }
  }, [activeVariant?.id, queryV, search, setSearch]);

  // Job + result data
  const { data: jobs = [] } = useVariantJobs(activeVariant?.id);
  const { data: latestResult } = useLatestResult(activeVariant?.id);
  const runSim = useRunSimulation();

  // Form state
  const [kind, setKind] = useState<Kind>("full");
  const [speed, setSpeed] = useState(200);
  const [yaw, setYaw] = useState(0);
  const [density, setDensity] = useState(1.225);

  const activeMode = MODES.find((m) => m.id === kind)!;
  const credits = profile?.credits ?? 0;
  const canAfford = credits >= activeMode.cost;

  const liveJob = jobs[0];
  const isRunning = liveJob && ["queued", "preprocessing", "simulating", "postprocessing"].includes(liveJob.state);

  const submit = async () => {
    if (!activeVariant) return;
    if (!canAfford) {
      toast({ title: "Not enough credits", description: `Need ${activeMode.cost}, have ${credits}.`, variant: "destructive" });
      return;
    }
    try {
      await runSim.mutateAsync({
        variant_id: activeVariant.id, kind, speed_kmh: speed, yaw_deg: yaw, air_density: density,
      });
      toast({ title: "Simulation queued", description: `${activeMode.label} · ${activeMode.runtime}` });
    } catch (e: any) {
      toast({ title: "Couldn't start simulation", description: e.message, variant: "destructive" });
    }
  };

  if (variantsLoading) {
    return <div className="mx-auto max-w-[1400px] px-6 py-8"><LoadingState label="Loading simulation workspace" /></div>;
  }

  if (!activeVariant) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="glass rounded-xl p-8 text-center">
          <Wrench className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold">No variant to simulate</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create a variant first from the build overview.</p>
          <Button className="mt-4" variant="hero" size="sm" asChild>
            <Link to={`/build?id=${buildId}`}>Go to overview</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-6 space-y-6">
      {/* Variant + credits bar */}
      <div className="glass rounded-xl flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Variant</span>
          <select
            value={activeVariant.id}
            onChange={(e) => {
              const next = new URLSearchParams(search);
              next.set("v", e.target.value);
              setSearch(next, { replace: true });
            }}
            disabled={isRunning}
            className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{v.is_baseline ? " · baseline" : ""}
              </option>
            ))}
          </select>
          <StatusChip tone={activeVariant.status === "completed" ? "success" : activeVariant.status === "simulating" ? "simulating" : "preview"} size="sm">
            {activeVariant.status}
          </StatusChip>
        </div>
        <div className="flex items-center gap-3 text-mono text-[11px]">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5">
            <Coins className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground">credits</span>
            <span className="text-foreground tabular-nums">{credits}</span>
          </div>
          <Button variant="glass" size="sm" asChild>
            <Link to={`/parts?id=${buildId}&v=${activeVariant.id}`}>
              <Settings2 className="mr-2 h-3.5 w-3.5" /> Edit parts
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT — config */}
        <div className="lg:col-span-7 space-y-4">
          {/* Mode picker */}
          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">Solver mode</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = m.id === kind;
                return (
                  <button
                    key={m.id}
                    onClick={() => setKind(m.id)}
                    disabled={isRunning}
                    className={cn(
                      "relative overflow-hidden rounded-xl border p-4 text-left transition-all",
                      active
                        ? "border-primary/50 bg-primary/5 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
                        : "border-border bg-surface-1 hover:border-primary/30",
                      isRunning && !active && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {active && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />}
                    <div className="flex items-start justify-between">
                      <div className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-md border",
                        active ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-surface-2 text-muted-foreground",
                      )}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <ConfidenceBadge level={m.confidence} compact />
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
                        <div className="text-foreground mt-0.5">{m.cost} cr</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground uppercase tracking-widest text-[9px]">Solver</div>
                        <div className="text-foreground mt-0.5">{m.tag}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Operating point */}
          <div className="glass rounded-xl">
            <div className="border-b border-border px-4 py-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">Operating point</h3>
            </div>
            <div className="p-4 space-y-4">
              <ParamSlider
                label="Inlet velocity · U∞"
                value={speed} min={60} max={320} unit=" km/h"
                onChange={setSpeed}
                hint={`q = ½ρV² · ${(0.5 * density * Math.pow(speed / 3.6, 2) / 1000).toFixed(2)} kPa`}
              />
              <ParamSlider
                label="Yaw angle · β"
                value={yaw} min={-12} max={12} unit="°"
                onChange={setYaw}
                hint="0° = straight-line · ±5° typical crosswind"
              />
              <ParamSlider
                label="Air density · ρ"
                value={density} min={1.0} max={1.35} step={0.005} unit=" kg/m³"
                onChange={setDensity}
                hint="ISA sea level · 1.225"
              />
            </div>
          </div>

          {/* Geometry assumptions snapshot (read-only) */}
          <div className="glass rounded-xl">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">Geometry snapshot</h3>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/geometry?id=${buildId}`}>
                  Edit <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-border/60">
              <Stat label="Ride F" value={`${geometry?.ride_height_front_mm ?? "—"} mm`} />
              <Stat label="Ride R" value={`${geometry?.ride_height_rear_mm ?? "—"} mm`} />
              <Stat label="Underbody" value={geometry?.underbody_model ?? "—"} />
              <Stat label="Wheels" value={geometry?.wheel_rotation ?? "—"} />
            </div>
          </div>
        </div>

        {/* RIGHT — submit + live progress */}
        <div className="lg:col-span-5 space-y-4">
          {/* Submit panel */}
          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">Run</h3>
            </div>
            <div className="rounded-md border border-border bg-surface-1 p-3 space-y-1.5 text-mono text-[11px]">
              <Row label="Mode"     value={activeMode.label} />
              <Row label="Speed"    value={`${speed} km/h`} />
              <Row label="Yaw"      value={`${yaw}°`} />
              <Row label="Density"  value={`${density.toFixed(3)} kg/m³`} />
              <Row label="Cost"     value={`${activeMode.cost} cr`} accent />
              <Row label="ETA"      value={activeMode.runtime} />
            </div>
            {!canAfford && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-mono text-[10px] text-muted-foreground leading-relaxed">
                  Need {activeMode.cost} credits — you have {credits}. Switch to preview or top up.
                </p>
              </div>
            )}
            <Button
              variant="hero" size="lg" className="w-full"
              onClick={submit}
              disabled={!!isRunning || runSim.isPending || !canAfford}
            >
              <PlayCircle className="mr-2 h-4 w-4" />
              {isRunning ? "Job in progress…" : runSim.isPending ? "Submitting…" : `Run ${activeMode.label}`}
            </Button>
          </div>

          {/* Live job */}
          {liveJob ? (
            <JobProgress
              state={mapJobState(liveJob.state)}
              label={`${liveJob.kind === "full" ? "Full CFD" : "Preview"} · ${liveJob.id.slice(0, 6)}`}
              iteration={liveJob.iterations_done}
              totalIterations={Math.max(1, liveJob.iterations_target)}
              residual={liveJob.residual ?? undefined}
              eta={liveJob.state === "simulating" ? estEta(liveJob) : undefined}
            />
          ) : (
            <div className="glass rounded-xl p-6 text-center">
              <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-mono text-[11px] text-muted-foreground">No runs for this variant yet.</p>
            </div>
          )}

          {/* Latest result snapshot */}
          {latestResult && !isRunning && (
            <ResultPreview result={latestResult} />
          )}
        </div>
      </div>

      {/* History */}
      <div className="glass rounded-xl">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Run history</h3>
          </div>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
          </span>
        </div>
        {jobs.length === 0 ? (
          <div className="p-6 text-center text-mono text-[11px] text-muted-foreground">
            No simulation history for this variant yet.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {jobs.slice(0, 10).map((j) => <JobRow key={j.id} job={j} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────── */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 p-3">
      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-mono text-[11px] text-foreground capitalize mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", accent ? "text-primary" : "text-foreground")}>{value}</span>
    </div>
  );
}

function JobRow({ job }: { job: SimJob }) {
  const tone =
    job.state === "completed" ? "success" :
    job.state === "failed" || job.state === "cancelled" ? "failed" :
    job.state === "queued" ? "preview" : "simulating";
  const Icon =
    job.state === "completed" ? CheckCircle2 :
    job.state === "failed" || job.state === "cancelled" ? XCircle : Activity;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/40">
      <Icon className={cn(
        "h-4 w-4 shrink-0",
        job.state === "completed" ? "text-success" :
        job.state === "failed" || job.state === "cancelled" ? "text-destructive" : "text-primary",
      )} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium capitalize">{job.kind}</span>
          <StatusChip tone={tone as any} size="sm">{job.state}</StatusChip>
        </div>
        <div className="text-mono text-[10px] text-muted-foreground tabular-nums truncate">
          {job.id.slice(0, 8)} · {job.speed_kmh} km/h · yaw {job.yaw_deg}° · ρ {job.air_density}
        </div>
      </div>
      <div className="text-mono text-[10px] text-muted-foreground tabular-nums text-right shrink-0">
        <div>{job.iterations_done.toLocaleString()} / {job.iterations_target.toLocaleString()}</div>
        <div>{job.created_at ? formatDistanceToNow(new Date(job.created_at), { addSuffix: true }) : "—"}</div>
      </div>
    </div>
  );
}

function ResultPreview({ result }: { result: SimResult }) {
  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <h3 className="text-sm font-semibold tracking-tight">Latest result</h3>
        </div>
        <ConfidenceBadge level={result.confidence as any} compact />
      </div>
      <div className="grid grid-cols-3 divide-x divide-border/60">
        <Stat label="Cd" value={Number(result.cd).toFixed(3)} />
        <Stat label="DF total" value={`${Number(result.df_total_kgf).toFixed(0)} kgf`} />
        <Stat label="L/D" value={Number(result.ld_ratio).toFixed(2)} />
      </div>
      {result.is_stale && (
        <div className="border-t border-border px-4 py-2 text-mono text-[10px] text-warning flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Stale — geometry changed since this run.
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────── */
function estEta(job: SimJob): string {
  if (!job.iterations_target || !job.iterations_done) return "—";
  const pct = job.iterations_done / job.iterations_target;
  if (pct <= 0) return "—";
  const totalSec = job.kind === "full" ? 45 : 10;
  const remaining = Math.round(totalSec * (1 - pct));
  if (remaining <= 0) return "wrapping up…";
  return remaining > 60 ? `${Math.ceil(remaining / 60)} min` : `${remaining}s`;
}

export default Simulation;
