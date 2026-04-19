import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { CarViewer3D, type CarViewer3DHandle } from "@/components/CarViewer3D";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { useBrief, useConcepts, useGeometry, useUpdateConcept, useDeleteConcept, type Concept } from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles, Camera, Check, X, RefreshCw, Star, Wand2, ArrowRight, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  const { data: geometry } = useGeometry(projectId);
  const { data: brief } = useBrief(projectId);
  const { data: concepts = [], refetch } = useConcepts(projectId);
  const updateConcept = useUpdateConcept();
  const deleteConcept = useDeleteConcept();
  const viewerRef = useRef<CarViewer3DHandle>(null);
  const [generating, setGenerating] = useState(false);

  const hasMesh = !!geometry?.stl_path;
  const hasBrief = !!(brief?.prompt && brief.prompt.trim().length > 10);

  const generate = async () => {
    if (!user || !brief || !geometry) return;
    if (!hasBrief) {
      toast({ title: "Add a design brief first", variant: "destructive" });
      return;
    }
    setGenerating(true);

    // Capture multiple viewer angles for a stronger reference set + future turntable.
    let snapshots: Record<string, string | null> = {};
    try {
      const v = viewerRef.current;
      if (v) {
        snapshots = {
          front_three_quarter: v.captureAngle("front_three_quarter"),
          side: v.captureAngle("side"),
          rear_three_quarter: v.captureAngle("rear_three_quarter"),
          rear: v.captureAngle("rear_three_quarter"), // same preset but model will re-render rear
        };
      }
    } catch {}

    try {
      const { data, error } = await supabase.functions.invoke("generate-concepts", {
        body: {
          project_id: projectId,
          brief_id: brief.id,
          // Keep legacy field for backward-compat in the edge function
          snapshot_data_url: snapshots.front_three_quarter ?? null,
          snapshots,
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

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Step 3 · Concepts</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Generated styling concepts</h1>
          </div>
          <Button variant="hero" size="lg" onClick={generate} disabled={!hasMesh || !hasBrief || generating}>
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

        {(!hasMesh || !hasBrief) && (
          <div className="glass rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-sm">
              {!hasMesh && (
                <p className="text-muted-foreground">
                  Upload a car model first.{" "}
                  <Link to={`/upload?project=${projectId}`} className="text-primary hover:underline">
                    Go to Upload
                  </Link>
                </p>
              )}
              {hasMesh && !hasBrief && (
                <p className="text-muted-foreground">
                  Add a design brief first.{" "}
                  <Link to={`/brief?project=${projectId}`} className="text-primary hover:underline">
                    Go to Brief
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}

        {concepts.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary/60" />
            <h3 className="mt-3 text-lg font-semibold tracking-tight">No concepts yet</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Click <span className="text-foreground">Generate concepts</span> to create AI styling concepts based on your brief and uploaded model.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {concepts.map((c) => (
              <ConceptCard
                key={c.id}
                concept={c}
                onApprove={() => updateConcept.mutate({ id: c.id, patch: { status: "approved" } })}
                onReject={() => updateConcept.mutate({ id: c.id, patch: { status: "rejected" } })}
                onFavourite={() => updateConcept.mutate({ id: c.id, patch: { status: "favourited" } })}
                onDelete={() => deleteConcept.mutate(c.id)}
              />
            ))}
          </div>
        )}

        {concepts.some((c) => c.status === "approved") && (
          <div className="glass-strong rounded-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Check className="h-5 w-5 text-success shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight">Concept approved</div>
                <div className="text-mono text-[10px] text-muted-foreground">
                  Generate fitted body kit parts based on the approved concept.
                </div>
              </div>
            </div>
            <Button variant="hero" size="sm" asChild>
              <Link to={`/parts?project=${projectId}`}>
                Generate parts <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4 lg:sticky lg:top-32 lg:self-start">
        <div className="glass rounded-xl overflow-hidden h-[400px] relative">
          {geometry ? (
            <CarViewer3D
              ref={viewerRef}
              template={project.car?.template ?? null}
              geometry={geometry}
              hideParts
              preset="front_three_quarter"
            />
          ) : (
            <div className="h-full grid place-items-center text-muted-foreground">Loading…</div>
          )}
          <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-surface-0/80 backdrop-blur px-2.5 py-1.5 border border-border">
            <Camera className="h-3.5 w-3.5 text-primary" />
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Reference frame
            </span>
          </div>
        </div>

        <div className="glass rounded-xl p-4">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Brief summary</div>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-6">
            {brief?.prompt || <em className="text-muted-foreground/60">No brief yet.</em>}
          </p>
          {brief?.style_tags && brief.style_tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {brief.style_tags.slice(0, 6).map((t) => (
                <span key={t} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-mono uppercase tracking-widest text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConceptCard({
  concept, onApprove, onReject, onFavourite, onDelete,
}: {
  concept: Concept;
  onApprove: () => void;
  onReject: () => void;
  onFavourite: () => void;
  onDelete: () => void;
}) {
  const tone = concept.status === "approved"
    ? "success"
    : concept.status === "rejected"
      ? "neutral"
      : concept.status === "favourited"
        ? "preview"
        : "neutral";
  return (
    <div className={cn(
      "glass rounded-xl overflow-hidden flex flex-col transition-colors",
      concept.status === "approved" && "border-success/40 ring-1 ring-success/20",
      concept.status === "rejected" && "opacity-50",
    )}>
      <div className="relative aspect-[4/3] bg-surface-2 grid-bg-fine">
        {concept.render_front_url ? (
          <img src={concept.render_front_url} alt={concept.title} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Sparkles className="h-8 w-8" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <StatusChip tone={tone as any} size="sm">{concept.status}</StatusChip>
        </div>
      </div>
      <div className="p-3 flex-1">
        <div className="text-sm font-semibold tracking-tight truncate">{concept.title}</div>
        {concept.direction && (
          <div className="text-mono text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{concept.direction}</div>
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
    </div>
  );
}
