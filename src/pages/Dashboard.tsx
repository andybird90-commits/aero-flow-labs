import { useNavigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Boxes, Wand2, Car as CarIcon, Shapes, Hammer,
  FolderKanban, LibraryIcon, Layers, Activity,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useProjects, useGarageCars, useMyLibrary, useIsAdmin,
} from "@/lib/repo";

/**
 * Dashboard — APEX NEXT control room.
 *
 * High-level overview of the user's recent assets + a quick-action grid that
 * deep-links into the new IA. No data mutations here, just presentation.
 */
export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id);

  const { data: projects = [] } = useProjects(user?.id);
  const { data: garageCars = [] } = useGarageCars(user?.id);
  const { data: library = [] } = useMyLibrary(user?.id);

  const concepts = library.filter((l) => l.kind === "concept_image");
  const parts = library.filter((l) =>
    ["concept_part_mesh", "geometry_part_mesh", "cad_part_mesh", "prototype_part_mesh"].includes(l.kind),
  );
  const skins = library.filter((l) => l.kind === "aero_kit_mesh");

  const quickActions = [
    { id: "concept", label: "New Concept",            icon: Sparkles, to: "/concept-studio" },
    { id: "build",   label: "New 3D Build",           icon: Boxes,    to: "/build-studio" },
    { id: "meshy",   label: "Generate Part w/ Meshy", icon: Wand2,    to: isAdmin ? "/meshy-admin" : "/part-library" },
    { id: "car",     label: "Upload Car STL/GLB",     icon: CarIcon,  to: "/car-library" },
    { id: "skin",    label: "Upload Body Skin",       icon: Shapes,   to: "/body-skin-library" },
    { id: "blender", label: "Blender Job Queue",      icon: Hammer,   to: "/blender-jobs" },
  ];

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 space-y-8 max-w-7xl">
        <PageHeader
          eyebrow="Control room"
          title="Dashboard"
          description="Recent activity across your concepts, parts, body skins and the Blender job queue."
        />

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Projects"     value={String(projects.length)}    icon={<FolderKanban className="h-4 w-4" />} />
          <StatCard label="Saved cars"   value={String(garageCars.length)}  icon={<CarIcon className="h-4 w-4" />} />
          <StatCard label="Concepts"     value={String(concepts.length)}    icon={<Sparkles className="h-4 w-4" />} />
          <StatCard label="Parts"        value={String(parts.length)}       icon={<Layers className="h-4 w-4" />} />
          <StatCard label="Body skins"   value={String(skins.length)}       icon={<Shapes className="h-4 w-4" />} />
          <StatCard label="Blender jobs" value="0"                          hint="coming soon" icon={<Activity className="h-4 w-4" />} />
        </div>

        {/* Quick actions */}
        <section className="space-y-3">
          <h2 className="text-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {quickActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  onClick={() => navigate(a.to)}
                  className="group glass rounded-lg p-4 flex flex-col items-start gap-3 text-left transition-colors hover:border-primary/50 hover:ring-1 hover:ring-primary/30"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/20">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent projects */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Recent projects
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">All projects →</Link>
            </Button>
          </div>
          {projects.length === 0 ? (
            <div className="glass rounded-lg p-8 text-center text-sm text-muted-foreground">
              No projects yet. Start with{" "}
              <Link to="/concept-studio" className="text-primary hover:underline">
                a concept
              </Link>
              .
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.slice(0, 6).map((p) => (
                <Link
                  key={p.id}
                  to={`/build-studio?project=${p.id}`}
                  className="glass rounded-lg p-4 hover:border-primary/40 transition-colors"
                >
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                    {p.status} · {new Date(p.updated_at).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Recent library items */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Recent library items
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/part-library">
                <LibraryIcon className="h-3.5 w-3.5 mr-1" /> Open library
              </Link>
            </Button>
          </div>
          {library.length === 0 ? (
            <div className="glass rounded-lg p-8 text-center text-sm text-muted-foreground">
              Nothing saved yet. Generate a concept or upload a part.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {library.slice(0, 12).map((it) => (
                <div key={it.id} className="glass rounded-md overflow-hidden aspect-square relative">
                  {it.thumbnail_url ? (
                    <img
                      src={it.thumbnail_url}
                      alt={it.title}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-muted-foreground/40">
                      <Layers className="h-8 w-8" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <div className="text-[11px] truncate text-foreground">{it.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}
