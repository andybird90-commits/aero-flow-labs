import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { CarViewer3D } from "@/components/CarViewer3D";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { Switch } from "@/components/ui/switch";
import {
  useGeometry, useApprovedConcept, useActiveConceptSet, useFittedParts, useUpsertFittedPart,
} from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, RefreshCw, ArrowRight, Wrench, AlertCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const PART_KINDS = [
  { kind: "splitter",    label: "Front splitter",   defaults: { depth: 80, fence_height: 30, fence_inset: 60 } },
  { kind: "lip",         label: "Lip extension",    defaults: { depth: 30 } },
  { kind: "canard",      label: "Canards",          defaults: { angle: 12, count: 1, span: 180 } },
  { kind: "side_skirt",  label: "Side skirts",      defaults: { depth: 70, drop: 25 } },
  { kind: "wide_arch",   label: "Wide arches",      defaults: { flare: 50 } },
  { kind: "bonnet_vent", label: "Bonnet vent",      defaults: { length: 240, width: 120, louvre_count: 5, depth: 18 } },
  { kind: "wing_vent",   label: "Wing vent",        defaults: { length: 180, width: 90,  louvre_count: 4, depth: 14 } },
  { kind: "diffuser",    label: "Rear diffuser",    defaults: { angle: 12, strake_count: 5, strake_height: 60 } },
  { kind: "ducktail",    label: "Ducktail",         defaults: { height: 38, kick: 10 } },
  { kind: "wing",        label: "Rear wing",        defaults: { aoa: 8, chord: 280, gurney: 12, span_pct: 78, stand_height: 220 } },
];

export default function Parts() {
  return (
    <WorkspaceShell>
      {({ project, projectId }) => <PartsInner projectId={projectId!} project={project} />}
    </WorkspaceShell>
  );
}

function PartsInner({ projectId, project }: { projectId: string; project: any }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: geometry } = useGeometry(projectId);
  const { data: approved } = useApprovedConcept(projectId);
  const { data: conceptSet } = useActiveConceptSet(projectId);
  const { data: parts = [] } = useFittedParts(conceptSet?.id);
  const upsert = useUpsertFittedPart();
  const [measuring, setMeasuring] = useState(false);
  const [reasoning, setReasoning] = useState<Record<string, string>>({});

  const partByKind = (k: string) => parts.find((p) => p.kind === k);

  const togglePart = async (kind: string) => {
    if (!user || !conceptSet) return;
    const existing = partByKind(kind);
    const def = PART_KINDS.find((p) => p.kind === kind)!;
    await upsert.mutateAsync({
      userId: user.id,
      conceptSetId: conceptSet.id,
      id: existing?.id,
      kind,
      params: existing?.params ?? def.defaults,
      enabled: !(existing?.enabled),
    });
  };

  const measureConcept = async () => {
    if (!user || !conceptSet) return;
    if (!approved) {
      toast({ title: "Approve a concept first", description: "Go to Concepts and approve one.", variant: "destructive" });
      return;
    }
    setMeasuring(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-part-params", {
        body: { project_id: projectId, concept_id: approved.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const suggestions = (data as any)?.parts as Array<{ kind: string; params: any; enabled: boolean; reasoning?: string }> | undefined;
      if (!suggestions || suggestions.length === 0) {
        toast({ title: "No measurements returned", variant: "destructive" });
        return;
      }
      const reasoningMap: Record<string, string> = {};
      for (const s of suggestions) {
        if (s.reasoning) reasoningMap[s.kind] = s.reasoning;
        const existing = partByKind(s.kind);
        await upsert.mutateAsync({
          userId: user.id,
          conceptSetId: conceptSet.id,
          id: existing?.id,
          kind: s.kind,
          params: s.params,
          enabled: s.enabled,
        });
      }
      setReasoning(reasoningMap);
      const enabledCount = suggestions.filter((s) => s.enabled).length;
      toast({ title: "Concept measured", description: `${enabledCount}/${suggestions.length} parts present in the concept.` });
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (msg.includes("429")) toast({ title: "Rate limit reached", variant: "destructive" });
      else if (msg.includes("402")) toast({ title: "AI credits exhausted", variant: "destructive" });
      else toast({ title: "Measurement failed", description: msg, variant: "destructive" });
    } finally {
      setMeasuring(false);
    }
  };

  /* If concept is approved but no fitted_parts yet, auto-trigger measurement once. */
  useEffect(() => {
    if (!approved || !conceptSet || !user) return;
    if (parts.length > 0) return;
    if (measuring) return;
    measureConcept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approved?.id, conceptSet?.id, parts.length]);

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        <div className="glass rounded-xl overflow-hidden h-[640px] relative">
          {geometry ? (
            <CarViewer3D template={project.car?.template ?? null} geometry={geometry} parts={parts} />
          ) : (
            <div className="h-full grid place-items-center text-muted-foreground">Loading viewer…</div>
          )}
          <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-surface-0/80 backdrop-blur px-2.5 py-1.5 border border-border">
            <Wrench className="h-3.5 w-3.5 text-primary" />
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Your STL · Fitted body kit
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Step 4 · Fitted Parts</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Body kit measured from concept</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Each part is parametric, fitted to your STL, and exports as a clean printable file.
          </p>
        </div>

        {!approved && (
          <div className="glass rounded-xl p-3 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="text-muted-foreground">
                Approve a concept first.{" "}
                <Link to={`/concepts?project=${projectId}`} className="text-primary hover:underline">
                  Go to Concepts
                </Link>
              </p>
            </div>
          </div>
        )}

        <Button
          variant="hero"
          size="lg"
          className="w-full"
          onClick={measureConcept}
          disabled={!approved || !conceptSet || measuring}
        >
          {measuring ? (
            <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Measuring concept…</>
          ) : parts.length === 0 ? (
            <><Wand2 className="mr-2 h-4 w-4" /> Generate kit from concept</>
          ) : (
            <><RefreshCw className="mr-2 h-4 w-4" /> Re-measure concept</>
          )}
        </Button>

        <div className="glass rounded-xl">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Body kit parts</h3>
            <StatusChip tone="neutral" size="sm">{parts.filter((p) => p.enabled).length} enabled</StatusChip>
          </div>
          <div className="p-3 space-y-1">
            {PART_KINDS.map((p) => {
              const existing = partByKind(p.kind);
              const on = !!existing?.enabled;
              const why = reasoning[p.kind];
              return (
                <div key={p.kind} className={cn(
                  "rounded-md px-2.5 py-2 transition-colors",
                  on ? "bg-primary/[0.06]" : "hover:bg-surface-2",
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{p.label}</span>
                    <Switch checked={on} onCheckedChange={() => togglePart(p.kind)} />
                  </div>
                  {why && (
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <Sparkles className="h-2.5 w-2.5 text-primary/70 mt-1 shrink-0" />
                      <p className="text-[11px] text-muted-foreground leading-snug">{why}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Button variant="glass" size="lg" className="w-full" asChild disabled={parts.filter((p) => p.enabled).length === 0}>
          <Link to={`/refine?project=${projectId}`}>
            Refine parts <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
