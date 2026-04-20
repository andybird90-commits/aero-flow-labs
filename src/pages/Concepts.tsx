import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import {
  useBrief, useConcepts, useUpdateConcept, useDeleteConcept,
  useBuildAeroKit, useAeroKitStatus, useHeroStlForProject, useStylePreset, type Concept,
} from "@/lib/repo";
import { AeroKitProgress, type AeroKitStatus } from "@/components/AeroKitProgress";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles, Check, X, RefreshCw, Star, Wand2, AlertCircle, MousePointer2, Maximize2, Layers, Download, ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PartHotspotOverlay, type ViewKey } from "@/components/PartHotspotOverlay";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export default function Concepts() {
  return (
    <WorkspaceShell>
      {({ project, projectId }) => <ConceptsInner projectId={projectId!} project={project} />}
    </WorkspaceShell>
  );
}

function ConceptsInner({ projectId, project }: { projectId: string; project: any }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: brief } = useBrief(projectId);
  const { data: activePreset } = useStylePreset((brief as any)?.style_preset_id ?? null);
  const { data: concepts = [], refetch } = useConcepts(projectId);
  const updateConcept = useUpdateConcept();
  const deleteConcept = useDeleteConcept();
  const buildKit = useBuildAeroKit();
  const { data: heroStl } = useHeroStlForProject(projectId);
  const [generating, setGenerating] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const autoTriggered = useRef(false);

  // Manifold is no longer required — non-manifold meshes build with a warning.
  const heroReady = !!heroStl?.repaired_stl_path;
  const heroNonManifold = heroReady && !heroStl?.manifold_clean;

  const hasPromptText = !!(brief?.prompt && brief.prompt.trim().length > 10);
  const hasStylePresetText = !!(activePreset?.prompt && activePreset.prompt.trim().length > 10);
  const hasStyleTags =
    ((brief?.style_tags?.length ?? 0) > 0) ||
    ((activePreset?.style_tags?.length ?? 0) > 0);
  // A brief is "ready" if there's a written prompt, an attached style preset
  // with its own description, or at least one style tag selected.
  const hasBrief = hasPromptText || hasStylePresetText || hasStyleTags;

  const generate = async () => {
    if (!user || !brief) return;
    if (!hasBrief) {
      toast({ title: "Add a design brief or style preset first", variant: "destructive" });
      return;
    }
    setGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke("generate-concepts", {
        body: {
          project_id: projectId,
          brief_id: brief.id,
          // No user-uploaded mesh in the new flow — generator falls back to
          // template-driven defaults for vehicle proportions.
          snapshot_data_url: null,
          snapshots: {},
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Concepts generated", description: `${(data as any)?.count ?? "Several"} concept variations created.` });
      await refetch();
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (msg.includes("429")) {
        toast({ title: "Rate limit reached", description: "Try again in a moment.", variant: "destructive" });
      } else if (msg.includes("402")) {
        toast({ title: "AI credits exhausted", description: "Top up to keep generating.", variant: "destructive" });
      } else {
        toast({ title: "Generation failed", description: msg, variant: "destructive" });
      }
    } finally {
      setGenerating(false);
    }
  };

  // If we arrived from the Brief page with the auto-generate flag, fire the
  // generator as soon as the brief has loaded so the page's own button shows
  // the spinning state (instead of the request being in-flight invisibly).
  useEffect(() => {
    const flag = (location.state as any)?.autoGenerate;
    if (!flag || autoTriggered.current) return;
    if (!brief || !hasBrief || generating) return;
    autoTriggered.current = true;
    navigate(location.pathname + location.search, { replace: true, state: {} });
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, hasBrief]);

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Step 2 · Concepts</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Generated styling concepts</h1>
          </div>
          <Button variant="hero" size="lg" onClick={generate} disabled={!hasBrief || generating}>
            {generating ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" /> Generate concepts
              </>
            )}
          </Button>
        </div>

        {!hasBrief && (
          <div className="glass rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="text-muted-foreground">
                Add a design brief or pick a style preset first.{" "}
                <Link to={`/brief?project=${projectId}`} className="text-primary hover:underline">
                  Go to Brief
                </Link>
              </p>
            </div>
          </div>
        )}

        {concepts.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary/60" />
            <h3 className="mt-3 text-lg font-semibold tracking-tight">No concepts yet</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Click <span className="text-foreground">Generate concepts</span> to create AI styling concepts based on your brief.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {concepts.map((c) => (
              <ConceptCard
                key={c.id}
                projectId={projectId}
                concept={c}
                heroReady={heroReady}
                onApprove={() => updateConcept.mutate({ id: c.id, patch: { status: "approved" } })}
                onReject={() => updateConcept.mutate({ id: c.id, patch: { status: "rejected" } })}
                onFavourite={() => updateConcept.mutate({ id: c.id, patch: { status: "favourited" } })}
                onDelete={() => deleteConcept.mutate(c.id)}
                onBuildKit={async () => {
                  try {
                    await buildKit.mutateAsync(c.id);
                    toast({ title: "Aero kit queued", description: "The build is running in the background." });
                  } catch (e: any) {
                    toast({ title: "Build failed", description: String(e.message ?? e), variant: "destructive" });
                  }
                }}
              />
            ))}
          </div>
        )}

        {/* Post-approval banner removed — exports now happen inline on the concept card. */}
      </div>

      <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
        <div className="glass rounded-xl p-4">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Brief summary</div>
          {activePreset && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
              <Sparkles className="h-3 w-3" />
              <span className="font-medium">Style: {activePreset.name}</span>
            </div>
          )}
          <p className="mt-2 text-sm text-muted-foreground line-clamp-[12]">
            {brief?.prompt || <em className="text-muted-foreground/60">No brief yet.</em>}
          </p>
          {brief?.style_tags && brief.style_tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {brief.style_tags.slice(0, 8).map((t) => (
                <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-mono uppercase tracking-widest text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-border">
            <Link
              to={`/brief?project=${projectId}`}
              className="text-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
            >
              Edit brief →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConceptCard({
  projectId, concept, heroReady, onApprove, onReject, onFavourite, onDelete, onBuildKit,
}: {
  projectId: string;
  concept: Concept;
  heroReady: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFavourite: () => void;
  onDelete: () => void;
  onBuildKit: () => void;
}) {
  const initialAeroStatus = ((concept as any).aero_kit_status ?? "idle") as AeroKitStatus;
  const initialAeroError = (concept as any).aero_kit_error as string | null | undefined;
  const initialAeroWarning = (concept as any).aero_kit_warning as string | null | undefined;
  const polledAero = useAeroKitStatus(
    concept.id,
    initialAeroStatus !== "idle" && initialAeroStatus !== "ready" && initialAeroStatus !== "failed",
  );
  const aeroStatus = ((polledAero.data?.aero_kit_status ?? initialAeroStatus) as AeroKitStatus);
  const aeroError = polledAero.data?.aero_kit_error ?? initialAeroError;
  const aeroWarning = polledAero.data?.aero_kit_warning ?? initialAeroWarning;
  const aeroUpdatedAt = polledAero.data?.updated_at ?? concept.updated_at;
  const aeroBuilding = aeroStatus !== "idle" && aeroStatus !== "ready" && aeroStatus !== "failed";
  const aeroStale = aeroBuilding && (Date.now() - new Date(aeroUpdatedAt).getTime()) > 2 * 60 * 1000;
  const tone = concept.status === "approved"
    ? "success"
    : concept.status === "rejected"
      ? "neutral"
      : concept.status === "favourited"
        ? "preview"
        : "neutral";

  // Build the ordered angle list for the turntable (front → side → rear-3/4 → rear).
  const angles: Array<{ key: ViewKey; label: string; url: string | null }> = [
    { key: "front",  label: "Front 3/4", url: concept.render_front_url },
    { key: "side",   label: "Side",      url: concept.render_side_url },
    { key: "rear34", label: "Rear 3/4",  url: (concept as any).render_rear34_url as string | null },
    { key: "rear",   label: "Rear",      url: concept.render_rear_url },
  ];
  const visibleAngles = angles.filter((a) => !!a.url) as Array<{ key: ViewKey; label: string; url: string }>;

  const [angleIdx, setAngleIdx] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const current = visibleAngles[angleIdx];
  const hasMultiple = visibleAngles.length > 1;

  const renderViewer = (variant: "card" | "zoom") => (
    <>
      {current ? (
        variant === "card" ? (
          <button
            type="button"
            onClick={(e) => {
              if (pickMode) return;
              e.stopPropagation();
              setZoomOpen(true);
            }}
            className="absolute inset-0 block group"
            title={pickMode ? "Pick a part" : "Open large view"}
          >
            <img
              key={current.url}
              src={current.url}
              alt={`${concept.title} — ${current.label}`}
              className="absolute inset-0 h-full w-full object-cover animate-fade-in"
            />
            {!pickMode && (
              <span className="absolute bottom-2 right-2 rounded-md bg-surface-0/85 backdrop-blur px-2 py-1 border border-border text-mono text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Maximize2 className="h-3 w-3" />
                Expand
              </span>
            )}
          </button>
        ) : (
          <img
            key={current.url}
            src={current.url}
            alt={`${concept.title} — ${current.label}`}
            className="absolute inset-0 h-full w-full object-contain animate-fade-in"
          />
        )
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Sparkles className="h-8 w-8" />
        </div>
      )}

      {/* Click-to-extract hotspots overlay */}
      {current && (
        <PartHotspotOverlay
          active={pickMode}
          view={current.key}
          projectId={projectId}
          conceptId={concept.id}
          conceptTitle={concept.title}
          sourceImageUrl={current.url}
        />
      )}

      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); setPickMode((p) => !p); }}
          className={cn(
            "rounded-md px-2 py-1 inline-flex items-center gap-1 text-[10px] text-mono uppercase tracking-widest border backdrop-blur transition-colors",
            pickMode
              ? "bg-primary/90 text-primary-foreground border-primary"
              : "bg-surface-0/85 text-muted-foreground border-border hover:text-foreground",
          )}
          title="Click any part on the render to extract it as STL"
        >
          <MousePointer2 className="h-3 w-3" />
          {pickMode ? "Picking" : "Pick parts"}
        </button>
        {variant === "card" && <StatusChip tone={tone as any} size="sm">{concept.status}</StatusChip>}
        {variant === "card" && current && !pickMode && (
          <button
            onClick={(e) => { e.stopPropagation(); setZoomOpen(true); }}
            className="rounded-md px-2 py-1 inline-flex items-center gap-1 text-[10px] text-mono uppercase tracking-widest border bg-surface-0/85 text-muted-foreground border-border hover:text-foreground backdrop-blur transition-colors"
            title="Open large view"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {hasMultiple && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-surface-0/80 backdrop-blur px-1.5 py-1 border border-border z-10">
          {visibleAngles.map((a, i) => (
            <button
              key={a.key + i}
              onClick={(e) => { e.stopPropagation(); setAngleIdx(i); }}
              className={cn(
                "px-2.5 py-0.5 rounded-full text-[10px] text-mono uppercase tracking-widest transition-colors",
                i === angleIdx
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={a.label}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={cn(
      "glass rounded-xl overflow-hidden flex flex-col transition-colors",
      concept.status === "approved" && "border-success/40 ring-1 ring-success/20",
      concept.status === "rejected" && "opacity-50",
    )}>
      <div className="relative aspect-[4/3] bg-surface-2 grid-bg-fine">
        {renderViewer("card")}
      </div>
      <div className="p-3 flex-1 space-y-2">
        <div className="text-sm font-semibold tracking-tight truncate">{concept.title}</div>
        {concept.direction && (
          <div className="text-mono text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{concept.direction}</div>
        )}
        {pickMode && (
          <div className="text-[10px] text-mono uppercase tracking-widest text-primary/80">
            Click any highlighted part → downloads as STL
          </div>
        )}

        {/* Boolean aero-kit trigger — only when project has a manifold hero STL. */}
        {(concept.status === "approved" || concept.status === "favourited") && (
          <div className="pt-2 border-t border-border space-y-2">
            {heroReady ? (
              <Button
                variant="hero"
                size="sm"
                className="w-full"
                disabled={aeroBuilding && !aeroStale}
                onClick={onBuildKit}
                title="Run displace → subtract → split using the real hero STL"
              >
                <Layers className="mr-1.5 h-3.5 w-3.5" />
                {aeroBuilding && !aeroStale ? "Building aero kit…"
                  : aeroStale ? "Retry aero kit build"
                  : aeroStatus === "ready" ? "Rebuild aero kit"
                  : "Build aero kit from real STL"}
              </Button>
            ) : (
              <div className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground text-center py-1.5">
                Upload a hero STL for this car (admin) to enable boolean kit
              </div>
            )}
            <AeroKitProgress status={aeroStatus} error={aeroError} warning={aeroWarning} />
            {aeroStatus === "ready" && polledAero.data?.aero_kit_url && (
              <Button
                variant="glass"
                size="sm"
                className="w-full"
                onClick={async () => {
                  const url = polledAero.data!.aero_kit_url!;
                  try {
                    const resp = await fetch(url);
                    const blob = await resp.blob();
                    const u = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = `${concept.title || "aero-kit"}.stl`;
                    document.body.appendChild(a); a.click(); a.remove();
                    setTimeout(() => URL.revokeObjectURL(u), 1000);
                  } catch {/* noop */}
                }}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download combined kit STL
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 border-t border-border">
        <button onClick={onApprove} className="py-2 text-success hover:bg-success/10 transition-colors" title="Approve">
          <Check className="mx-auto h-4 w-4" />
        </button>
        <button onClick={onFavourite} className="py-2 text-primary hover:bg-primary/10 transition-colors" title="Favourite">
          <Star className="mx-auto h-4 w-4" />
        </button>
        <button onClick={onReject} className="py-2 text-muted-foreground hover:bg-surface-2 transition-colors" title="Reject">
          <X className="mx-auto h-4 w-4" />
        </button>
        <button onClick={onDelete} className="py-2 text-destructive hover:bg-destructive/10 transition-colors" title="Delete">
          ×
        </button>
      </div>

      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 border-border bg-surface-0 overflow-hidden sm:rounded-xl">
          <VisuallyHidden asChild>
            <DialogTitle>{concept.title} — large view</DialogTitle>
          </VisuallyHidden>
          <VisuallyHidden asChild>
            <DialogDescription>Pick parts on a larger render</DialogDescription>
          </VisuallyHidden>
          <div className="relative w-full h-full bg-surface-2 grid-bg-fine">
            {renderViewer("zoom")}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
