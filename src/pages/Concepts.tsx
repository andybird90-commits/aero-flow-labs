import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useBrief, useConcepts, useUpdateConcept, useDeleteConcept,
  useBuildAeroKit, useAeroKitStatus, useHeroStlForProject, useStylePreset, useActiveConceptSet,
  useIsolateCarbon, useCarbonStatus, useMeshifyCarbonKit, useCarbonKitStatus, type Concept,
} from "@/lib/repo";
import { AeroKitProgress, type AeroKitStatus } from "@/components/AeroKitProgress";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles, Check, X, RefreshCw, Star, Wand2, AlertCircle, MousePointer2, Maximize2, Layers, Download, ChevronLeft, ChevronRight, Boxes, Flame, FileText,
} from "lucide-react";
import { useToast as useToastHook } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PartHotspotOverlay, type ViewKey } from "@/components/PartHotspotOverlay";
import { PartTraceOverlay } from "@/components/PartTraceOverlay";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

function ConceptRegenAndPrompt({ concept, projectId }: { concept: Concept; projectId: string }) {
  const { toast } = useToastHook();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "more" | "different">(null);

  const regen = async (mode: "more" | "different") => {
    const brief = await supabase.from("design_briefs")
      .select("id").eq("project_id", projectId).limit(1).maybeSingle();
    if (!brief.data?.id) {
      toast({ title: "No brief found", variant: "destructive" });
      return;
    }
    const seed = (concept as any).variation_seed && Object.keys((concept as any).variation_seed).length
      ? (concept as any).variation_seed
      : {
          title: concept.title,
          direction: concept.direction ?? "",
          modifier: concept.title,
          emphasis: concept.direction ?? "",
        };
    const extra = mode === "more"
      ? "Push significantly more aggressive: bigger wing, deeper splitter, wider arches, lower stance. Do not tone down."
      : "Take this in a different stylistic direction (different cultural reference) but keep the same aggression level.";
    setBusy(mode);
    try {
      const { error } = await supabase.functions.invoke("generate-concepts", {
        body: {
          project_id: projectId,
          brief_id: brief.data.id,
          variation_index: 0,
          variation_seed: seed,
          extra_modifier: extra,
        },
      });
      if (error) throw error;
      toast({ title: "Regenerating tile…", description: "A new concept will appear shortly." });
    } catch (e: any) {
      toast({ title: "Regenerate failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const promptUsed = (concept as any).prompt_used as string | null;

  return (
    <div className="pt-2 border-t border-border space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => regen("more")}
          disabled={!!busy}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[10px] text-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          {busy === "more" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Flame className="h-3 w-3" />} More aggressive
        </button>
        <button
          type="button"
          onClick={() => regen("different")}
          disabled={!!busy}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[10px] text-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          {busy === "different" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Different direction
        </button>
        {promptUsed && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[10px] text-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileText className="h-3 w-3" /> {open ? "Hide prompt" : "View prompt"}
          </button>
        )}
      </div>
      {open && promptUsed && (
        <pre className="text-[10px] text-muted-foreground bg-surface-1 border border-border rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap">
          {promptUsed}
        </pre>
      )}
    </div>
  );
}

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
  const { data: activeConceptSet } = useActiveConceptSet(projectId);
  const updateConcept = useUpdateConcept();
  const deleteConcept = useDeleteConcept();
  const buildKit = useBuildAeroKit();
  const { data: heroStl } = useHeroStlForProject(projectId);
  const [generating, setGenerating] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const autoTriggered = useRef(false);
  const generatingInBackground = activeConceptSet?.status === "generating";

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
      if ((data as any)?.queued) {
        toast({ title: "Generation started", description: "Concepts are rendering in the background now." });
        await refetch();
        return;
      }
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
          <Button variant="hero" size="lg" onClick={generate} disabled={!hasBrief || generating || generatingInBackground}>
            {generating || generatingInBackground ? (
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

        {generatingInBackground && (
          <Alert>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <AlertDescription>
              Concepts are still rendering in the background; this page will update automatically as each variation finishes.
            </AlertDescription>
          </Alert>
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
                bodySwapMode={!!(brief as any)?.body_swap_mode}
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
  projectId, concept, heroReady, bodySwapMode, onApprove, onReject, onFavourite, onDelete, onBuildKit,
}: {
  projectId: string;
  concept: Concept;
  heroReady: boolean;
  bodySwapMode?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFavourite: () => void;
  onDelete: () => void;
  onBuildKit: () => void;
}) {
  const { toast } = useToast();
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
  const c = concept as any;
  const fullAngles: Array<{ key: ViewKey; label: string; url: string | null }> = [
    { key: "front",  label: "Front 3/4", url: concept.render_front_url },
    { key: "side",   label: "Side",      url: concept.render_side_url },
    { key: "rear34", label: "Rear 3/4",  url: c.render_rear34_url as string | null },
    { key: "rear",   label: "Rear",      url: concept.render_rear_url },
  ];
  const carbonAngles: Array<{ key: ViewKey; label: string; url: string | null }> = [
    { key: "front",  label: "Front 3/4", url: c.render_front_carbon_url ?? null },
    { key: "side",   label: "Side",      url: c.render_side_carbon_url ?? null },
    { key: "rear34", label: "Rear 3/4",  url: c.render_rear34_carbon_url ?? null },
    { key: "rear",   label: "Rear",      url: c.render_rear_carbon_url ?? null },
  ];

  const initialCarbonStatus = (c.carbon_status as string | undefined) ?? "idle";
  const carbonPolling = initialCarbonStatus === "generating" || initialCarbonStatus === "queued";
  const polledCarbon = useCarbonStatus(concept.id, carbonPolling);
  const carbonStatus = (polledCarbon.data?.carbon_status ?? initialCarbonStatus) as
    "idle" | "generating" | "queued" | "ready" | "failed";
  const carbonError = polledCarbon.data?.carbon_error ?? (c.carbon_error as string | null | undefined);
  const carbonReady = carbonStatus === "ready";
  const carbonBusy = carbonStatus === "generating" || carbonStatus === "queued";
  const isolateCarbon = useIsolateCarbon();

  // Combined carbon-kit mesh (single GLB for the whole kit, user splits in CAD).
  const initialKitStatus = (c.carbon_kit_status as string | undefined) ?? "idle";
  const [kitStartPending, setKitStartPending] = useState(false);
  const kitPolling = kitStartPending || initialKitStatus === "generating" || initialKitStatus === "queued";
  const polledKit = useCarbonKitStatus(concept.id, kitPolling);
  const kitStatus = (polledKit.data?.carbon_kit_status ?? initialKitStatus) as
    "idle" | "queued" | "generating" | "ready" | "failed";
  const kitGlbUrl = polledKit.data?.carbon_kit_glb_url ?? (c.carbon_kit_glb_url as string | null | undefined);
  const kitStlUrl = polledKit.data?.carbon_kit_stl_url ?? (c.carbon_kit_stl_url as string | null | undefined);
  const kitScaleM = polledKit.data?.carbon_kit_scale_m ?? (c.carbon_kit_scale_m as number | null | undefined);
  const kitError = polledKit.data?.carbon_kit_error ?? (c.carbon_kit_error as string | null | undefined);
  const kitBusy = kitStartPending || kitStatus === "generating" || kitStatus === "queued";
  const meshifyKit = useMeshifyCarbonKit();

  // If the polled response carries fresh carbon URLs, prefer those.
  const liveCarbonAngles = polledCarbon.data ? [
    { key: "front"  as ViewKey, label: "Front 3/4", url: polledCarbon.data.render_front_carbon_url },
    { key: "side"   as ViewKey, label: "Side",      url: polledCarbon.data.render_side_carbon_url },
    { key: "rear34" as ViewKey, label: "Rear 3/4",  url: polledCarbon.data.render_rear34_carbon_url },
    { key: "rear"   as ViewKey, label: "Rear",      url: polledCarbon.data.render_rear_carbon_url },
  ] : carbonAngles;

  const [carbonMode, setCarbonMode] = useState(false);
  const angles = carbonMode ? liveCarbonAngles : fullAngles;
  const visibleAngles = angles.filter((a) => !!a.url) as Array<{ key: ViewKey; label: string; url: string }>;

  const [angleIdx, setAngleIdx] = useState(0);
  /** Three-state mode: none, AI pick (legacy), or manual trace (new). */
  const [partMode, setPartMode] = useState<"none" | "pick" | "trace">("none");
  const pickMode = partMode === "pick";
  const traceMode = partMode === "trace";
  const [zoomOpen, setZoomOpen] = useState(false);
  const current = visibleAngles[angleIdx];
  const hasMultiple = visibleAngles.length > 1;

  // Keep angleIdx in range when toggling modes / data changes.
  useEffect(() => {
    if (angleIdx >= visibleAngles.length) setAngleIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carbonMode, visibleAngles.length]);

  const handleCarbonToggle = async () => {
    if (carbonBusy) return;
    if (carbonReady || carbonAngles.some((a) => !!a.url)) {
      setCarbonMode((m) => !m);
      return;
    }
    // First time — kick off generation and flip on optimistically.
    setCarbonMode(true);
    try { await isolateCarbon.mutateAsync(concept.id); } catch { /* surface via status */ }
  };

  const handleMeshifyKit = async () => {
    if (kitBusy || meshifyKit.isPending) return;
    setKitStartPending(true);
    toast({
      title: "Carbon kit meshing started",
      description: "Preparing matte-white kit renders, then sending side + rear views to Rodin.",
    });
    try {
      await meshifyKit.mutateAsync(concept.id);
      toast({ title: "Rodin reconstruction queued", description: "The card will update while the mesh is generated." });
    } catch (e: any) {
      toast({ title: "Couldn’t start mesh", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setKitStartPending(false);
    }
  };

  const goPrev = () => setAngleIdx((i) => (i - 1 + visibleAngles.length) % visibleAngles.length);
  const goNext = () => setAngleIdx((i) => (i + 1) % visibleAngles.length);

  // Keyboard arrows when the zoom dialog is open.
  useEffect(() => {
    if (!zoomOpen || !hasMultiple) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomOpen, hasMultiple, visibleAngles.length]);

  // Touch swipe — horizontal flick > 40px switches angles.
  const touchStartX = useRef<number | null>(null);
  const anyPartMode = pickMode || traceMode;
  const onTouchStart = (e: React.TouchEvent) => {
    if (!hasMultiple || anyPartMode) return;
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!hasMultiple || anyPartMode || touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) goPrev(); else goNext();
  };

  const renderViewer = (variant: "card" | "zoom") => (
    <>
      {current ? (
        variant === "card" ? (
          <button
            type="button"
            onClick={(e) => {
              if (anyPartMode) return;
              e.stopPropagation();
              setZoomOpen(true);
            }}
            className="absolute inset-0 block group"
            title={anyPartMode ? "Pick or trace a part" : "Open large view"}
          >
            <img
              key={current.url}
              src={current.url}
              alt={`${concept.title} — ${current.label}`}
              className="absolute inset-0 h-full w-full object-cover animate-fade-in"
            />
            {!anyPartMode && (
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

      {/* Click-to-extract hotspots overlay (AI pick mode) */}
      {current && pickMode && (
        <PartHotspotOverlay
          active={pickMode}
          view={current.key}
          projectId={projectId}
          conceptId={concept.id}
          conceptTitle={concept.title}
          sourceImageUrl={current.url}
        />
      )}

      {/* Manual trace overlay — deterministic, no AI */}
      {current && traceMode && (
        <PartTraceOverlay
          active={traceMode}
          view={current.key}
          projectId={projectId}
        />
      )}

      <div className={cn(
        "absolute top-2 right-2 flex items-center gap-1.5 z-30",
        // In the zoom dialog the built-in close (X) sits at top-right, so
        // shift this toolbar left to avoid the click target overlapping it.
        variant === "zoom" && "right-12",
      )}>
        <button
          onClick={(e) => { e.stopPropagation(); void handleCarbonToggle(); }}
          disabled={carbonBusy}
          className={cn(
            "rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 text-xs text-mono uppercase tracking-widest border backdrop-blur transition-colors",
            carbonMode
              ? "bg-foreground text-background border-foreground"
              : "bg-surface-0/85 text-muted-foreground border-border hover:text-foreground",
            carbonBusy && "opacity-70 cursor-wait",
          )}
          title={
            carbonStatus === "failed" && carbonError
              ? `${bodySwapMode ? "Swap-shell" : "Carbon"} isolation failed: ${carbonError}. Click to retry.`
              : carbonBusy
                ? bodySwapMode
                  ? "Extracting full swap shell in carbon weave…"
                  : "Generating carbon-only renders…"
                : bodySwapMode
                  ? "Show only the swap-shell bodywork (re-skinned in carbon)"
                  : "Show only the aftermarket carbon bodywork"
          }
        >
          {carbonBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />}
          {carbonStatus === "failed"
            ? (bodySwapMode ? "Retry shell" : "Retry carbon")
            : carbonMode
              ? (bodySwapMode ? "Shell on" : "Carbon on")
              : (bodySwapMode ? "Swap shell only" : "Carbon only")}
        </button>
        {/* Manual trace — primary recommended path */}
        <button
          onClick={(e) => { e.stopPropagation(); setPartMode((m) => m === "trace" ? "none" : "trace"); }}
          className={cn(
            "rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 text-xs text-mono uppercase tracking-widest border backdrop-blur transition-colors",
            traceMode
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-surface-0/85 text-muted-foreground border-border hover:text-foreground",
          )}
          title="Manually trace each kit piece — deterministic CAD geometry, valid STL every time"
        >
          <Pencil className="h-3.5 w-3.5" />
          {traceMode ? "Tracing" : "Trace kit"}
        </button>
        {/* AI pick — secondary, kept for power users */}
        <button
          onClick={(e) => { e.stopPropagation(); setPartMode((m) => m === "pick" ? "none" : "pick"); }}
          className={cn(
            "rounded-md px-3 py-1.5 inline-flex items-center gap-1.5 text-xs text-mono uppercase tracking-widest border backdrop-blur transition-colors",
            pickMode
              ? "bg-primary/90 text-primary-foreground border-primary"
              : "bg-surface-0/85 text-muted-foreground border-border hover:text-foreground",
          )}
          title="AI-detected hotspots — experimental, may misidentify overlapping parts"
        >
          <MousePointer2 className="h-3.5 w-3.5" />
          {pickMode ? "Picking" : "AI pick"}
        </button>
        {variant === "card" && <StatusChip tone={tone as any} size="sm">{concept.status}</StatusChip>}
        {variant === "card" && current && !anyPartMode && (
          <button
            onClick={(e) => { e.stopPropagation(); setZoomOpen(true); }}
            className="rounded-md px-2 py-1.5 inline-flex items-center gap-1 text-xs text-mono uppercase tracking-widest border bg-surface-0/85 text-muted-foreground border-border hover:text-foreground backdrop-blur transition-colors"
            title="Open large view"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {carbonMode && !current && (
        <div className="absolute inset-0 grid place-items-center text-center px-6 pointer-events-none">
          <div className="space-y-2 max-w-xs">
            <Boxes className="mx-auto h-8 w-8 text-muted-foreground" />
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {carbonBusy
                ? "Isolating carbon parts…"
                : carbonStatus === "failed"
                  ? "Carbon isolation failed. Tap retry."
                  : "No carbon-only renders yet."}
            </div>
            {carbonBusy && (
              <RefreshCw className="mx-auto h-4 w-4 animate-spin text-primary" />
            )}
          </div>
        </div>
      )}

      {hasMultiple && !anyPartMode && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-10 grid place-items-center h-9 w-9 rounded-full bg-surface-0/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground hover:bg-surface-0 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 group-[.is-zoom]:opacity-100"
            aria-label="Previous angle"
            title="Previous angle (←)"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 grid place-items-center h-9 w-9 rounded-full bg-surface-0/80 backdrop-blur border border-border text-muted-foreground hover:text-foreground hover:bg-surface-0 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 group-[.is-zoom]:opacity-100"
            aria-label="Next angle"
            title="Next angle (→)"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}

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
      <div
        className="relative aspect-[4/3] bg-surface-2 grid-bg-fine group"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
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
        {traceMode && (
          <div className="text-[10px] text-mono uppercase tracking-widest text-primary/80">
            Pick a part type, drag a box → saved to your fitted kit
          </div>
        )}

        <ConceptRegenAndPrompt concept={concept} projectId={projectId} />

        {/* Combined carbon-kit mesh — EXPERIMENTAL.
         *  Image-to-3D struggles with full kits; manual trace is the recommended path. */}
        {(carbonReady || carbonAngles.some((a) => !!a.url) || kitStatus !== "idle") && (
          <div className="pt-2 border-t border-border space-y-2">
            <div className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground">
              Experimental — prefer “Trace kit” for reliable STLs
            </div>
            <Button
              variant="glass"
              size="sm"
              className="w-full"
              disabled={kitBusy || meshifyKit.isPending || (!carbonReady && !carbonAngles.some((a) => !!a.url))}
              onClick={handleMeshifyKit}
              title="Experimental: reconstruct the entire carbon body kit as one mesh. Often unreliable — use Trace kit instead."
            >
              {kitBusy || meshifyKit.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Boxes className="mr-1.5 h-3.5 w-3.5" />}
              {kitStartPending || meshifyKit.isPending ? "Starting carbon kit mesh…"
                : kitBusy ? "Reconstructing combined kit… ~60s"
                : kitStatus === "ready" ? "Re-mesh full kit (experimental)"
                : "Mesh full carbon kit (experimental)"}
            </Button>
            {kitStatus === "failed" && kitError && (
              <div className="text-[10px] text-mono text-destructive">{kitError}</div>
            )}
            {kitStatus === "ready" && kitGlbUrl && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="glass"
                    size="sm"
                    onClick={async () => {
                      try {
                        const resp = await fetch(kitGlbUrl);
                        const blob = await resp.blob();
                        const u = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = u;
                        a.download = `${concept.title || "carbon-kit"}.glb`;
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(() => URL.revokeObjectURL(u), 1000);
                      } catch (e: any) {
                        toast({ title: "GLB download failed", description: String(e?.message ?? e), variant: "destructive" });
                      }
                    }}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" /> GLB
                  </Button>
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={!kitGlbUrl}
                    onClick={async () => {
                      // Rodin returns a GLB. Convert it client-side to a real
                      // binary STL so Fusion / SolidWorks don't choke on the
                      // glTF magic bytes inside a .stl-named file.
                      try {
                        const { fetchAsDownloadableMesh } = await import("@/lib/glb-to-stl");
                        const { blob } = await fetchAsDownloadableMesh(
                          kitGlbUrl,
                          "model/gltf-binary",
                        );
                        const u = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = u;
                        a.download = `${concept.title || "carbon-kit"}.stl`;
                        document.body.appendChild(a); a.click(); a.remove();
                        setTimeout(() => URL.revokeObjectURL(u), 1000);
                      } catch (e: any) {
                        toast({
                          title: "STL conversion failed",
                          description: String(e?.message ?? e),
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" /> STL
                  </Button>
                </div>
                <div className="text-[10px] text-mono text-muted-foreground leading-relaxed">
                  Whole carbon kit as one mesh. Open in Fusion / Blender to split into individual parts.
                  {typeof kitScaleM === "number" && (
                    <> Scale anchor: <span className="text-foreground">{kitScaleM.toFixed(2)} m</span> (longest dimension).</>
                  )}
                </div>
              </>
            )}
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
          <div
            className="relative w-full h-full bg-surface-2 grid-bg-fine group is-zoom"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {renderViewer("zoom")}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
