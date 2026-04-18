import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { ViewerPlaceholder } from "@/components/ViewerPlaceholder";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { JobProgress } from "@/components/JobProgress";
import { Button } from "@/components/ui/button";
import { Box, Wrench, PlayCircle, BarChart3, GitCompareArrows, ArrowRight, ChevronRight, CheckCircle2, Circle, Loader2 } from "lucide-react";

const Build = () => {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <PageHeader
          eyebrow="CIVIC_FK8 · 2020"
          title="Build Workspace"
          description="Track Pack — Variant B. Active simulation in queue. Last sync 2 minutes ago."
          actions={
            <>
              <Button variant="outline" size="sm" className="border-border bg-surface-1">Switch variant</Button>
              <Button size="sm" variant="hero" asChild>
                <Link to="/simulation"><PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation</Link>
              </Button>
            </>
          }
        />

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="DOWNFORCE @ 180" value="284" unit="kgf" delta={{ value: "+18.4% baseline", direction: "up" }} accent />
          <StatCard label="DRAG @ 180" value="112" unit="kgf" delta={{ value: "+4.1%", direction: "up", good: "down" }} />
          <StatCard label="L/D RATIO" value="2.54" delta={{ value: "+0.31", direction: "up" }} />
          <StatCard label="AERO BALANCE F" value="42.6" unit="%" delta={{ value: "−1.8 pt", direction: "down" }} hint="target 44%" />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <ViewerPlaceholder variant="velocity" badge="LIVE PREVIEW" />

            {/* Pipeline */}
            <div className="glass rounded-lg p-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Workflow</div>
                  <div className="mt-1 text-sm font-medium">Build pipeline · Variant B</div>
                </div>
                <span className="text-mono text-[11px] text-muted-foreground">4 of 5 complete</span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-5">
                {[
                  { label: "Geometry", icon: Box, status: "done", to: "/geometry" },
                  { label: "Aero Parts", icon: Wrench, status: "done", to: "/parts" },
                  { label: "Simulation", icon: PlayCircle, status: "running", to: "/simulation" },
                  { label: "Results", icon: BarChart3, status: "done", to: "/results" },
                  { label: "Compare", icon: GitCompareArrows, status: "todo", to: "/compare" },
                ].map((s, i) => (
                  <Link
                    key={s.label}
                    to={s.to}
                    className="group relative rounded-lg border border-border bg-surface-1 p-3 transition-colors hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Step {i + 1}
                      </span>
                      {s.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                      {s.status === "running" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />}
                      {s.status === "todo" && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <s.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="text-sm font-medium">{s.label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className="glass rounded-lg p-5">
              <div className="flex items-center justify-between">
                <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Active variants</div>
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -mr-2 h-7">
                  Manage <ChevronRight className="ml-1 h-3 w-3" />
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {[
                  { name: "Baseline", label: "OEM trim", color: "muted", df: 240, dr: 108 },
                  { name: "Variant A", label: "Street pack", color: "muted", df: 268, dr: 109 },
                  { name: "Variant B", label: "Track pack", color: "primary", df: 284, dr: 112 },
                  { name: "Variant C", label: "Endurance", color: "muted", df: 296, dr: 119 },
                ].map((v) => (
                  <div key={v.name} className={`flex items-center justify-between rounded-md border bg-surface-1 px-3 py-2.5 ${v.color === "primary" ? "border-primary/40 ring-1 ring-primary/20" : "border-border"}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{v.name}</div>
                      <div className="text-mono text-[10px] text-muted-foreground">{v.label}</div>
                    </div>
                    <div className="text-right text-mono text-[11px] tabular-nums">
                      <div className={v.color === "primary" ? "text-primary" : "text-foreground"}>{v.df} kgf DF</div>
                      <div className="text-muted-foreground">{v.dr} kgf DR</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass rounded-lg p-5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-primary/80">Recent runs</div>
              <div className="mt-3 space-y-2 text-xs">
                {[
                  { id: "#2184", v: "Variant B", t: "Running · iter 1820", state: "running" },
                  { id: "#2183", v: "Variant A", t: "Converged · 38m", state: "done" },
                  { id: "#2179", v: "Baseline", t: "Converged · 41m", state: "done" },
                  { id: "#2174", v: "Variant B", t: "Failed · diverged", state: "fail" },
                ].map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${r.state === "running" ? "bg-primary animate-pulse-soft" : r.state === "done" ? "bg-success" : "bg-destructive"}`} />
                      <span className="text-mono text-[11px]">{r.id}</span>
                      <span className="text-muted-foreground">·</span>
                      <span>{r.v}</span>
                    </div>
                    <span className="text-mono text-[10px] text-muted-foreground">{r.t}</span>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-4 w-full border-border bg-surface-1" asChild>
                <Link to="/results">Open results <ArrowRight className="ml-2 h-3 w-3" /></Link>
              </Button>
            </div>

            <JobProgress
              state="running"
              label="Run #2185 · Variant B"
              iteration={1820}
              eta="6m 02s"
              residual="Cd 1.2e-04 · Cl 8.7e-05"
            />

            <ConfidenceBadge
              level="medium"
              label="Comparative output"
              detail="Use deltas between variants — not absolute values — for setup decisions."
            />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Build;
