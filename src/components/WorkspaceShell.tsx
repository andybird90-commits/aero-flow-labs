/**
 * Shared shell for the studio pages (Upload / Brief / Concepts / Parts /
 * Refine / Exports). Provides:
 *   • AppLayout (top bar + sidebar)
 *   • Project context (loaded from ?project=)
 *   • Sub-navigation across the studio steps with the current project id preserved
 *   • Render-prop API: children({ project, projectId, ... })
 */
import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import {
  FileText,
  Sparkles,
  Wrench,
  Sliders,
  FileDown,
  ChevronRight,
  Plus,
  Star,
  Clock,
  Library,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import { useCreateProject } from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";

type Ctx = ReturnType<typeof useCurrentProject>;

const steps = [
  { label: "Brief",    icon: FileText,   to: "/brief" },
  { label: "Concepts", icon: Sparkles,   to: "/concepts" },
  { label: "Parts",    icon: Wrench,     to: "/parts" },
  { label: "Refine",   icon: Sliders,    to: "/refine" },
  { label: "Library",  icon: Library,    to: "/library" },
  { label: "Exports",  icon: FileDown,   to: "/exports" },
] as const;

interface WorkspaceShellProps {
  children: (ctx: Ctx & { project: NonNullable<Ctx["project"]> }) => ReactNode;
  headerActions?: ReactNode;
}

export function WorkspaceShell({ children, headerActions }: WorkspaceShellProps) {
  const ctx = useCurrentProject();
  const { user } = useAuth();
  const create = useCreateProject();
  const navigate = useNavigate();

  if (ctx.isLoading) {
    return (
      <AppLayout>
        <div className="p-12 text-center text-muted-foreground text-mono text-xs uppercase tracking-widest">
          Loading project…
        </div>
      </AppLayout>
    );
  }

  if (ctx.isEmpty || !ctx.project) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-xl p-12 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Start your first project</h2>
          <p className="mt-2 text-muted-foreground">
            Create a project to write a design brief and generate AI body kit concepts.
          </p>
          <Button
            variant="hero"
            size="lg"
            className="mt-6"
            disabled={!user || create.isPending}
            onClick={async () => {
              if (!user) return;
              const p = await create.mutateAsync({ userId: user.id, name: "New project" });
              navigate(`/brief?project=${p.id}`);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> New project
          </Button>
        </div>
      </AppLayout>
    );
  }

  const projectId = ctx.projectId!;
  const carName = ctx.project.car?.name ?? "Vehicle";

  return (
    <AppLayout>
      <div className="flex">
        <ProjectSidebar projectId={projectId} projectName={ctx.project.name} />
        <div className="min-w-0 flex-1">
          <ProjectHeader
            project={ctx.project}
            projectId={projectId}
            carName={carName}
            headerActions={headerActions}
          />
          {children(ctx as Ctx & { project: NonNullable<Ctx["project"]> })}
        </div>
      </div>
    </AppLayout>
  );
}

function ProjectSidebar({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { pathname } = useLocation();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-surface-0/40">
      <div className="border-b border-border px-4 py-4">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Project</div>
        <div className="mt-1 flex items-center gap-2">
          <Star className="h-3.5 w-3.5 fill-primary text-primary shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">{projectName}</div>
            <div className="text-mono text-[10px] text-muted-foreground truncate">{projectId.slice(0, 8)}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2">
        <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-2">
          Studio steps
        </div>
        <ul className="space-y-0.5">
          {steps.map((s, i) => {
            const active = pathname === s.to;
            return (
              <li key={s.label}>
                <Link
                  to={`${s.to}?project=${projectId}`}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary shadow-glow" />}
                  <span className="text-mono text-[10px] text-muted-foreground/60 w-3">{i + 1}</span>
                  <s.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function ProjectHeader({
  project, projectId, carName, headerActions,
}: {
  project: any;
  projectId: string;
  carName: string;
  headerActions?: ReactNode;
}) {
  const updated = project.updated_at
    ? formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })
    : "—";
  const tone =
    project.status === "approved" || project.status === "exported"
      ? "success"
      : project.status === "archived"
        ? "neutral"
        : "preview";

  return (
    <div className="border-b border-border bg-surface-0/60 backdrop-blur sticky top-14 z-20">
      <div className="px-6 py-3 flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest min-w-0">
          <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors">
            Projects
          </Link>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-muted-foreground truncate">{carName}</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
          <span className="text-foreground truncate">{project.name}</span>
        </nav>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <StatusChip tone={tone as any} size="sm">{project.status}</StatusChip>
          <span className="hidden md:inline-flex items-center text-mono text-[11px] text-muted-foreground gap-1">
            <Clock className="h-3 w-3" /> {updated}
          </span>
          {headerActions && <div className="h-5 w-px bg-border mx-1" />}
          {headerActions}
        </div>
      </div>
    </div>
  );
}
