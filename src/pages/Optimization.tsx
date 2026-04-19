/**
 * Optimization — choose objective + components, kick off run-optimization
 * edge function, watch realtime job progress, list ranked candidates.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useProfile, useBuildOptJobs, useRunOptimization, type OptJob } from "@/lib/repo";
import {
  Sparkles, Trophy, Zap, Scale, Wind, Target, Play, ChevronRight,
  CircleCheck, Crown, Loader2, BadgeCheck, Activity, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Objective = "track_use" | "top_speed" | "balance" | "high_speed_stability" | "rear_grip";

const OBJECTIVES: { id: Objective; label: string; icon: typeof Trophy; desc: string }[] = [
  { id: "track_use",            label: "Track use",            icon: Trophy, desc: "Maximize lap-time downforce within drag budget." },
  { id: "top_speed",            label: "Top speed",            icon: Zap,    desc: "Minimize Cd, allow low downforce." },
  { id: "balance",              label: "Balanced",             icon: Scale,  desc: "Equal-weighted compromise across all metrics." },
  { id: "high_speed_stability", label: "High-speed stability", icon: Wind,   desc: "Rear-biased load with low drag for long straights." },
  { id: "rear_grip",            label: "Rear grip bias",       icon: Target, desc: "Push aero balance rearward for traction-limited cars." },
];

const COMPONENTS = [
  { id: "splitter",  label: "Front splitter" },
  { id: "canard",    label: "Canards" },
  { id: "skirt",     label: "Side skirts" },
  { id: "wing",      label: "Rear wing" },
  { id: "diffuser",  label: "Rear diffuser" },
  { id: "underbody", label: "Flat underbody" },
];

const COST = 24;

const Optimization = () => (
  <WorkspaceShell>
    {(ctx) => <OptContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

function OptContent({ buildId }: { buildId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: profile } = useProfile(user?.id);
  const { data: jobs = [], isLoading } = useBuildOptJobs(buildId);
  const runOpt = useRunOptimization();
  const [search, setSearch] = useSearchParams();

  const [objective, setObjective] = useState<Objective>("track_use");
  const [allowed, setAllowed] = useState<Set<string>>(new Set(COMPONENTS.map((c) => c.id)));

  // Active job (most recent non-completed) or selected
  const activeJob = jobs.find((j) => j.state !== "completed" && j.state !== "failed") ?? null;
  const selectedJobId = search.get("job") ?? jobs[0]?.id;
  const viewedJob = jobs.find((j) => j.id === selectedJobId) ?? jobs[0];

  const toggle = (id: string) =>
    setAllowed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const credits = profile?.credits ?? 0;
  const canRun = credits >= COST && !activeJob;

  const onRun = async () => {
    try {
      const res = await runOpt.mutateAsync({
        build_id: buildId,
        objective,
        allowed_components: Array.from(allowed),
      });
      const next = new URLSearchParams(search);
      next.set("job", res.job_id);
      setSearch(next, { replace: true });
      toast({ title: "Optimization started", description: "Watching live progress…" });
    } catch (e: any) {
      toast({ title: "Couldn't start optimization", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) return <div className="px-6 py-6"><LoadingState /></div>;

  return (
    <div className="px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
            Step 03b · AI optimization
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Optimize aero package</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            The optimizer searches the parameter space across enabled components and
            returns the best-scoring candidates for your chosen objective.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone="warning" size="sm">{COST} cr</StatusChip>
          <span className="text-mono text-[11px] text-muted-foreground">{credits} available</span>
        </div>
      </div>

      {/* Objective */}
      <Card icon={Target} title="Objective" hint="What should the optimizer maximize">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
          {OBJECTIVES.map((o) => {
            const Icon = o.icon;
            const sel = o.id === objective;
            return (
              <button
                key={o.id}
                onClick={() => setObjective(o.id)}
                className={cn(
                  "rounded-md border p-3 text-left transition-all relative",
                  sel ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
                )}
              >
                {sel && <CircleCheck className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />}
                <Icon className={cn("h-5 w-5 mb-2", sel ? "text-primary" : "text-muted-foreground")} />
                <div className="text-sm font-medium">{o.label}</div>
                <div className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">{o.desc}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Components */}
      <Card icon={Sparkles} title="Allowed components" hint={`${allowed.size} of ${COMPONENTS.length} enabled`}>
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {COMPONENTS.map((c) => {
            const on = allowed.has(c.id);
            return (
              <div
                key={c.id}
                className={cn(
                  "flex items-center justify-between rounded-md border p-3 transition-colors",
                  on ? "border-primary/30 bg-primary/5" : "border-border bg-surface-1",
                )}
              >
                <span className="text-sm font-medium">{c.label}</span>
                <Switch checked={on} onCheckedChange={() => toggle(c.id)} className="data-[state=checked]:bg-primary" />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Run button / active job */}
      <div className="mt-4 glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
            {activeJob ? <Loader2 className="h-4 w-4 text-primary-foreground animate-spin" /> : <Play className="h-4 w-4 text-primary-foreground" />}
          </div>
          <div>
            <div className="text-sm font-medium">
              {activeJob ? `Running · ${activeJob.state.replace(/_/g, " ")}` : "Ready to run"}
            </div>
            <div className="text-mono text-[11px] text-muted-foreground">
              {activeJob
                ? `${activeJob.candidates_evaluated}/${activeJob.candidates_total} candidates evaluated`
                : `Costs ${COST} credits · evaluates ~16 candidates`}
            </div>
          </div>
        </div>
        <Button variant="hero" size="sm" disabled={!canRun || runOpt.isPending} onClick={onRun}>
          {runOpt.isPending ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Submitting…</>
          ) : (
            <><Play className="mr-2 h-3.5 w-3.5" /> Run optimization</>
          )}
        </Button>
      </div>

      {activeJob && <ProgressBar job={activeJob} />}

      {/* Job results */}
      {viewedJob && viewedJob.state === "completed" && <JobResults job={viewedJob} />}

      {/* Job history */}
      {jobs.length > 1 && (
        <Card icon={Activity} title="Optimization history">
          <ul className="space-y-1.5">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  onClick={() => {
                    const next = new URLSearchParams(search);
                    next.set("job", j.id);
                    setSearch(next, { replace: true });
                  }}
                  className={cn(
                    "w-full flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
                    viewedJob?.id === j.id ? "border-primary/30 bg-primary/5" : "border-border bg-surface-1 hover:border-primary/30",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {j.objective.replace(/_/g, " ")}
                    </span>
                    <StatusChip tone={j.state === "completed" ? "success" : j.state === "failed" ? "destructive" : "preview"} size="sm">
                      {j.state}
                    </StatusChip>
                  </span>
                  <span className="text-mono text-[11px] text-muted-foreground">
                    {new Date(j.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ProgressBar({ job }: { job: OptJob }) {
  const pct = job.candidates_total > 0 ? (job.candidates_evaluated / job.candidates_total) * 100 : 0;
  return (
    <Card icon={Activity} title="Live progress" hint={`${job.candidates_evaluated} / ${job.candidates_total}`}>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-primary to-primary-glow transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-mono text-[11px] text-muted-foreground">
        State: {job.state.replace(/_/g, " ")}
      </div>
    </Card>
  );
}

function JobResults({ job }: { job: OptJob }) {
  const ranked = (job.ranked_candidates as any[]) ?? [];
  const best = (job.best_candidate as any) ?? ranked[0];
  if (!best) return null;

  return (
    <>
      <Card icon={Crown} title="Best candidate" hint={`${best.id} · score ${best.score}/100`}
        action={<ConfidenceBadge level={job.confidence} compact />}>
        <div className="grid gap-3 md:grid-cols-4">
          <Hero l="L/D ratio" v={Number(best.ld_ratio).toFixed(2)} />
          <Hero l="Total DF" v={`+${best.df_total_kgf}`} u="kgf" />
          <Hero l="Drag" v={`${best.drag_kgf}`} u="kgf" />
          <Hero l="Cd" v={Number(best.cd).toFixed(3)} />
        </div>
        {job.reasoning && (
          <div className="mt-3 rounded-md border border-primary/25 bg-primary/5 p-3">
            <div className="flex items-start gap-2.5">
              <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-foreground/90 leading-relaxed">{job.reasoning}</p>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1">
          {(best.parts as any[])?.map((p, i) => (
            <span key={i} className="text-mono text-[10px] uppercase tracking-widest rounded border border-border bg-surface-2/40 px-2 py-0.5 text-muted-foreground">
              {p.kind}
            </span>
          ))}
        </div>
      </Card>

      <Card icon={Trophy} title="All candidates" hint={`Top ${ranked.length}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-1/50 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="text-left font-normal px-3 py-2">Rank</th>
                <th className="text-left font-normal px-3 py-2">ID</th>
                <th className="text-right font-normal px-3 py-2">Score</th>
                <th className="text-right font-normal px-3 py-2">Cd</th>
                <th className="text-right font-normal px-3 py-2">L/D</th>
                <th className="text-right font-normal px-3 py-2">DF total</th>
                <th className="text-right font-normal px-3 py-2">Drag</th>
                <th className="text-right font-normal px-3 py-2">Bal F</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {ranked.map((c, i) => (
                <tr key={c.id} className={cn("hover:bg-surface-1/40 transition-colors", i === 0 && "bg-primary/5")}>
                  <td className="px-3 py-2 text-mono tabular-nums">
                    {i === 0 ? <Crown className="h-3.5 w-3.5 text-primary" /> : `#${i + 1}`}
                  </td>
                  <td className="px-3 py-2 text-mono text-xs">{c.id}</td>
                  <td className="px-3 py-2 text-right text-mono tabular-nums font-medium">{c.score}</td>
                  <td className="px-3 py-2 text-right text-mono tabular-nums">{Number(c.cd).toFixed(3)}</td>
                  <td className="px-3 py-2 text-right text-mono tabular-nums">{Number(c.ld_ratio).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-mono tabular-nums">+{c.df_total_kgf}</td>
                  <td className="px-3 py-2 text-right text-mono tabular-nums">{c.drag_kgf}</td>
                  <td className="px-3 py-2 text-right text-mono tabular-nums">{Number(c.balance_front_pct).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Hero({ l, v, u }: { l: string; v: string; u?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-1/60 p-3">
      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{l}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-mono text-2xl font-semibold tabular-nums">{v}</span>
        {u && <span className="text-mono text-[10px] text-muted-foreground">{u}</span>}
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, hint, action, children }: {
  icon: typeof Sparkles; title: string; hint?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl mt-4">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          {hint && <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">{hint}</span>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default Optimization;
