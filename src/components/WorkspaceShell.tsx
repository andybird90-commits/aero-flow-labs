/**
 * Shared shell for Build / Geometry / Parts / Simulation / Results / Compare / Exports.
 * Provides:
 *   • BuildGate (loads current build via ?id=, falls back, offers demo seed)
 *   • Top breadcrumb
 *   • Left section sidebar (with ?id= preserved on every link)
 *   • Render-prop API: children({ build, buildId, ... })
 */
import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { BuildGate } from "@/components/BuildGate";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { StatusChip } from "@/components/StatusChip";
import { Button } from "@/components/ui/button";
import {
  PlayCircle, GitCompareArrows, FileDown, Copy, ChevronRight, MoreHorizontal,
  Layers, Box, Wrench, BarChart3, Star, Clock, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentBuild } from "@/hooks/useCurrentBuild";
import { formatDistanceToNow } from "date-fns";

type Ctx = ReturnType<typeof useCurrentBuild>;

const sections = [
  { label: "Overview",   icon: Layers,           to: "/build" },
  { label: "Geometry",   icon: Box,              to: "/geometry" },
  { label: "Aero Parts", icon: Wrench,           to: "/parts" },
  { label: "Simulation", icon: PlayCircle,       to: "/simulation" },
  { label: "Results",    icon: BarChart3,        to: "/results" },
  { label: "Compare",    icon: GitCompareArrows, to: "/compare" },
  { label: "Exports",    icon: FileDown,         to: "/exports" },
] as const;

interface WorkspaceShellProps {
  children: (ctx: Ctx & { build: NonNullable<Ctx["build"]> }) => ReactNode;
  /** Optional extra actions to render in the workspace header. */
  headerActions?: ReactNode;
}

export function WorkspaceShell({ children, headerActions }: WorkspaceShellProps) {
  return (
    <BuildGate>
      {(ctx) => {
        if (!ctx.build) return null;
        const buildId = ctx.buildId!;
        const carName = ctx.build.car?.name ?? "Car";
        return (
          <AppLayout>
            <div className="flex">
              <BuildSidebar buildId={buildId} buildName={ctx.build.name} />
              <div className="min-w-0 flex-1">
                <WorkspaceHeader build={ctx.build} headerActions={headerActions} buildId={buildId} carName={carName} />
                {children(ctx as Ctx & { build: NonNullable<Ctx["build"]> })}
              </div>
            </div>
          </AppLayout>
        );
      }}
    </BuildGate>
  );
}

/* ─── Sub-sidebar ──────────────────────────────────────────── */
function BuildSidebar({ buildId, buildName }: { buildId: string; buildName: string }) {
  const { pathname } = useLocation();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-surface-0/40">
      <div className="border-b border-border px-4 py-4">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Build</div>
        <div className="mt-1 flex items-center gap-2">
          <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">{buildName}</div>
            <div className="text-mono text-[10px] text-muted-foreground truncate">{buildId.slice(0, 8)}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-2">
          Sections
        </div>
        <ul className="space-y-0.5">
          {sections.map((s) => {
            const active = pathname === s.to;
            return (
              <li key={s.label}>
                <Link
                  to={`${s.to}?id=${buildId}`}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-glow" />}
                  <s.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3 space-y-2">
        <Button variant="hero" size="sm" className="w-full" asChild>
          <Link to={`/simulation?id=${buildId}`}><PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation</Link>
        </Button>
      </div>
    </aside>
  );
}

/* ─── Header ───────────────────────────────────────────────── */
function WorkspaceHeader({
  build, buildId, carName, headerActions,
}: {
  build: NonNullable<Ctx["build"]>;
  buildId: string;
  carName: string;
  headerActions?: ReactNode;
}) {
  const updated = build.updated_at ? formatDistanceToNow(new Date(build.updated_at), { addSuffix: true }) : "—";
  const statusTone = build.status === "ready" ? "success" : build.status === "archived" ? "neutral" : "preview";

  return (
    <div className="border-b border-border bg-surface-0/60 backdrop-blur sticky top-14 z-20">
      <div className="px-6 py-3 flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest min-w-0">
          <Link to="/garage" className="text-muted-foreground hover:text-foreground transition-colors">Garage</Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-muted-foreground truncate">{carName}</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-foreground truncate">{build.name}</span>
        </nav>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <StatusChip tone={statusTone as any} size="sm">{build.status}</StatusChip>
          <span className="hidden md:inline-flex items-center text-mono text-[11px] text-muted-foreground gap-1">
            <Target className="h-3 w-3" /> {build.objective.replace(/_/g, " ")}
          </span>
          <span className="hidden md:inline-flex items-center text-mono text-[11px] text-muted-foreground gap-1">
            <Clock className="h-3 w-3" /> {updated}
          </span>
          <div className="h-5 w-px bg-border mx-1" />
          {headerActions}
          <Button variant="glass" size="sm" asChild>
            <Link to={`/compare?id=${buildId}`}><GitCompareArrows className="mr-2 h-3.5 w-3.5" /> Compare</Link>
          </Button>
          <Button variant="glass" size="sm" asChild>
            <Link to={`/exports?id=${buildId}`}><FileDown className="mr-2 h-3.5 w-3.5" /> Export</Link>
          </Button>
          <Button variant="hero" size="sm" asChild>
            <Link to={`/simulation?id=${buildId}`}><PlayCircle className="mr-2 h-3.5 w-3.5" /> Run simulation</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
