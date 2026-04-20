/**
 * Library — every part the user has drawn, extracted, or modeled in this
 * project. Two sources:
 *   • concept_parts  → AI-rendered + meshified parts from the Concepts page.
 *   • fitted_parts   → parametric body-kit parts from the Parts page.
 *
 * Each entry shows its hero render (or 3D mesh), download/preview controls,
 * and a delete action.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartMeshViewer } from "@/components/PartMeshViewer";
import {
  useConceptParts, useDeleteConceptPart,
  useActiveConceptSet, useFittedParts, useDeleteFittedPart,
  type ConceptPart, type FittedPart,
} from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  Box, Download, Trash2, Sparkles, Wrench, ImageOff, Eye, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StockVsConceptPanel } from "@/components/StockVsConceptPanel";

export default function LibraryPage() {
  return (
    <WorkspaceShell>
      {({ project, projectId }) => <LibraryInner projectId={projectId!} project={project} />}
    </WorkspaceShell>
  );
}

function LibraryInner({ projectId, project }: { projectId: string; project: any }) {
  const { data: conceptParts = [], isLoading: cpLoading } = useConceptParts(projectId);
  const { data: conceptSet } = useActiveConceptSet(projectId);
  const { data: fittedParts = [], isLoading: fpLoading } = useFittedParts(conceptSet?.id);
  const delConcept = useDeleteConceptPart();
  const delFitted = useDeleteFittedPart();
  const { toast } = useToast();

  const [previewMesh, setPreviewMesh] = useState<{ url: string; label: string } | null>(null);

  const totalSaved = conceptParts.length + fittedParts.filter((p) => p.enabled).length;
  const meshed = conceptParts.filter((p) => !!p.glb_url).length;
  const drawn = conceptParts.length;

  const downloadMesh = async (url: string, name: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = `${name}.stl`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch (e: any) {
      toast({ title: "Download failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const deleteConcept = async (p: ConceptPart) => {
    if (!confirm(`Delete "${p.label ?? p.kind}"? This cannot be undone.`)) return;
    try {
      await delConcept.mutateAsync(p.id);
      toast({ title: "Part deleted" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const deleteFitted = async (p: FittedPart) => {
    if (!confirm(`Delete the ${p.kind} from the body kit?`)) return;
    try {
      await delFitted.mutateAsync(p.id);
      toast({ title: "Part removed from kit" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const isLoading = cpLoading || fpLoading;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Project Library</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Saved parts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you've drawn, extracted, or modeled in this project — viewable and downloadable in one place.
          </p>
        </div>
        <div className="flex gap-2">
          <Stat label="Total" value={totalSaved} />
          <Stat label="Drawn" value={drawn} />
          <Stat label="Meshed" value={meshed} />
        </div>
      </div>

      {isLoading && (
        <div className="text-center text-muted-foreground py-12">Loading library…</div>
      )}

      {/* Stock-vs-concept silhouette comparison (only renders if hero STL exists). */}
      <StockVsConceptPanel
        projectId={projectId}
        carTemplateId={project?.car?.template?.id ?? null}
      />

      {!isLoading && totalSaved === 0 && (
        <EmptyLibrary projectId={projectId} />
      )}

      {/* Concept-extracted parts */}
      {conceptParts.length > 0 && (
        <Section
          icon={Sparkles}
          title="Drawn & modeled parts"
          subtitle="Extracted from your concept renders. Click a tile to preview the 3D mesh."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {conceptParts.map((p) => (
              <ConceptPartCard
                key={p.id}
                part={p}
                onPreview={() => p.glb_url && setPreviewMesh({
                  url: p.glb_url,
                  label: p.label ?? p.kind,
                })}
                onDownload={() => p.glb_url && downloadMesh(p.glb_url, `${project.name ?? "part"}-${p.kind}`)}
                onDelete={() => deleteConcept(p)}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Fitted/parametric parts */}
      {fittedParts.length > 0 && (
        <Section
          icon={Wrench}
          title="Body kit parts (parametric)"
          subtitle="Auto-fitted to your STL on the Parts page. Tweak parameters in Refine."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {fittedParts.map((p) => (
              <FittedPartCard
                key={p.id}
                part={p}
                onDelete={() => deleteFitted(p)}
              />
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="glass" size="sm" asChild>
              <Link to={`/parts?project=${projectId}`}>
                Manage on Parts <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button variant="glass" size="sm" asChild>
              <Link to={`/refine?project=${projectId}`}>
                Refine parameters <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </Section>
      )}

      {/* Mesh preview dialog */}
      <Dialog open={!!previewMesh} onOpenChange={(o) => !o && setPreviewMesh(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewMesh?.label}</DialogTitle>
          </DialogHeader>
          {previewMesh && (
            <div className="h-[480px] rounded-md overflow-hidden border border-border">
              <PartMeshViewer url={previewMesh.url} className="h-full w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── small helpers ─────────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-0/40 px-3 py-2 min-w-[64px]">
      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Section({
  icon: Icon, title, subtitle, children,
}: {
  icon: any; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-start gap-2.5">
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyLibrary({ projectId }: { projectId: string }) {
  return (
    <div className="glass rounded-xl p-12 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground mb-3">
        <Box className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">Nothing saved yet</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Extract parts from a concept render, or generate a parametric body kit — they'll all appear here.
      </p>
      <div className="mt-5 flex flex-wrap gap-2 justify-center">
        <Button variant="hero" size="sm" asChild>
          <Link to={`/concepts?project=${projectId}`}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Go to Concepts
          </Link>
        </Button>
        <Button variant="glass" size="sm" asChild>
          <Link to={`/parts?project=${projectId}`}>
            <Wrench className="mr-1.5 h-3.5 w-3.5" /> Generate body kit
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ConceptPartCard({
  part, onPreview, onDownload, onDelete,
}: {
  part: ConceptPart;
  onPreview: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const renders = (part.render_urls as any) as Array<{ angle: string; url: string }> | null;
  const hero = renders?.[0]?.url ?? null;
  const hasMesh = !!part.glb_url;

  return (
    <div className="group glass rounded-xl overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-surface-0">
        {hero ? (
          <img src={hero} alt={part.label ?? part.kind} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        <div className="absolute top-2 left-2">
          <StatusChip tone={hasMesh ? "success" : "preview"} size="sm">
            {hasMesh ? "Meshed" : "Drawn"}
          </StatusChip>
        </div>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{part.label ?? part.kind}</div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
            {part.kind}
          </div>
        </div>
        <div className="mt-auto flex gap-1.5">
          <Button
            variant="glass" size="sm" className="flex-1"
            disabled={!hasMesh} onClick={onPreview}
            title={hasMesh ? "Preview 3D" : "No mesh yet"}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="glass" size="sm" className="flex-1"
            disabled={!hasMesh} onClick={onDownload}
            title={hasMesh ? "Download STL" : "No mesh yet"}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FittedPartCard({
  part, onDelete,
}: {
  part: FittedPart;
  onDelete: () => void;
}) {
  const params = (part.params as Record<string, any>) ?? {};
  const entries = Object.entries(params).slice(0, 4);

  return (
    <div className={cn(
      "glass rounded-xl p-3 flex flex-col gap-2",
      !part.enabled && "opacity-60",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate capitalize">{part.kind.replace(/_/g, " ")}</div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {part.enabled ? "Enabled" : "Disabled"}
          </div>
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive shrink-0"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {entries.length > 0 && (
        <div className="grid grid-cols-2 gap-1 text-[11px]">
          {entries.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 text-muted-foreground">
              <span className="truncate">{k}</span>
              <span className="text-foreground font-mono">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
