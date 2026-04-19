import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { CarViewer3D } from "@/components/CarViewer3D";
import { ConceptMeshViewer } from "@/components/ConceptMeshViewer";
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
import { Wand2, RefreshCw, ArrowRight, Wrench, AlertCircle, Sparkles, Box, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

const PART_KINDS = [
  { kind: "splitter",   label: "Front splitter",   defaults: { depth: 80, nudge_x: 0, nudge_y: 0, nudge_z: 0 } },
  { kind: "lip",        label: "Lip extension",    defaults: { depth: 30 } },
  { kind: "canard",     label: "Canards",          defaults: { angle: 12 } },
  { kind: "side_skirt", label: "Side skirts",      defaults: { depth: 70 } },
  { kind: "wide_arch",  label: "Wide arches",      defaults: { flare: 50 } },
  { kind: "diffuser",   label: "Rear diffuser",    defaults: { angle: 10 } },
  { kind: "ducktail",   label: "Ducktail",         defaults: { height: 38 } },
  { kind: "wing",       label: "Rear wing",        defaults: { aoa: 8, chord: 280, gurney: 12 } },
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
  const [suggesting, setSuggesting] = useState(false);
  const [generatingMesh, setGeneratingMesh] = useState(false);
  const [generatingPartId, setGeneratingPartId] = useState<string | null>(null);

  // Kinds we support per-part AI mesh generation for (prototype scope).
  const AI_PART_SUPPORTED = new Set(["wing", "splitter", "diffuser"]);

  const partByKind = (k: string) => parts.find((p) => p.kind === k);

  /* Poll while a mesh is generating so the UI updates without a refresh. */
  const meshStatus = (approved as any)?.preview_mesh_status as string | undefined;
  const meshUrl = (approved as any)?.preview_mesh_url as string | undefined;
  useEffect(() => {
    if (meshStatus !== "generating") return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["concept_approved", projectId] });
    }, 4000);
    return () => clearInterval(t);
  }, [meshStatus, projectId, qc]);

  /* Poll fitted_parts while any per-part AI mesh job is running. */
  const anyPartGenerating = parts.some((p) => (p as any).ai_mesh_status === "generating");
  useEffect(() => {
    if (!anyPartGenerating || !conceptSet?.id) return;
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["fitted_parts", conceptSet.id] });
    }, 4000);
    return () => clearInterval(t);
  }, [anyPartGenerating, conceptSet?.id, qc]);

  const generatePartMesh = async (partId: string, kind: string) => {
    setGeneratingPartId(partId);
    try {
      const { data, error } = await supabase.functions.invoke("generate-part-mesh", {
        body: { fitted_part_id: partId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      qc.invalidateQueries({ queryKey: ["fitted_parts", conceptSet?.id] });
      toast({
        title: "AI mesh generation started",
        description: `Generating a custom 3D ${kind} — this takes 1–3 minutes.`,
      });
    } catch (e: any) {
      toast({
        title: "AI mesh generation failed",
        description: String(e.message ?? e),
        variant: "destructive",
      });
    } finally {
      setGeneratingPartId(null);
    }
  };


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

  const aiSuggest = async () => {
    if (!user || !conceptSet) return;
    if (!approved) {
      toast({ title: "Approve a concept first", description: "Go to Concepts and approve one.", variant: "destructive" });
      return;
    }
    setSuggesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("suggest-part-params", {
        body: { project_id: projectId, concept_id: approved.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const suggestions = (data as any)?.parts as Array<{ kind: string; params: any; enabled: boolean }> | undefined;
      if (!suggestions || suggestions.length === 0) {
        toast({ title: "No suggestions returned", variant: "destructive" });
        return;
      }
      for (const s of suggestions) {
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
      toast({ title: "Parts generated", description: `${suggestions.length} part(s) configured from concept.` });
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (msg.includes("429")) toast({ title: "Rate limit reached", variant: "destructive" });
      else if (msg.includes("402")) toast({ title: "AI credits exhausted", variant: "destructive" });
      else toast({ title: "Suggestion failed", description: msg, variant: "destructive" });
    } finally {
      setSuggesting(false);
    }
  };

  const generateMesh = async () => {
    if (!approved) return;
    setGeneratingMesh(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-concept-mesh", {
        body: { concept_id: approved.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      qc.invalidateQueries({ queryKey: ["concept_approved", projectId] });
      toast({ title: "3D preview started", description: "Generating in the background — this takes 2-3 minutes." });
    } catch (e: any) {
      toast({ title: "Mesh generation failed", description: String(e.message ?? e), variant: "destructive" });
      qc.invalidateQueries({ queryKey: ["concept_approved", projectId] });
    } finally {
      setGeneratingMesh(false);
    }
  };

  const isGenerating = generatingMesh || meshStatus === "generating";

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Side-by-side viewers */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Real STL + parametric kit */}
          <div className="glass rounded-xl overflow-hidden h-[460px] relative">
            {geometry ? (
              <CarViewer3D template={project.car?.template ?? null} geometry={geometry} parts={parts} />
            ) : (
              <div className="h-full grid place-items-center text-muted-foreground">Loading viewer…</div>
            )}
            <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-surface-0/80 backdrop-blur px-2.5 py-1.5 border border-border">
              <Wrench className="h-3.5 w-3.5 text-primary" />
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Your STL · Parametric kit
              </span>
            </div>
          </div>

          {/* Experimental AI mesh */}
          <div className="glass rounded-xl overflow-hidden h-[460px] relative">
            {meshUrl ? (
              <ConceptMeshViewer meshUrl={meshUrl} />
            ) : (
              <div className="h-full grid place-items-center text-center px-6">
                <div className="space-y-3 max-w-[260px]">
                  <Box className="h-8 w-8 mx-auto text-muted-foreground" />
                  {isGenerating ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Generating 3D preview from your approved concept…
                      </p>
                      <p className="text-xs text-muted-foreground">
                        This usually takes 30–90 seconds.
                      </p>
                      <RefreshCw className="h-4 w-4 mx-auto animate-spin text-primary" />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No 3D preview yet. Generate one from the approved concept render.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-surface-0/80 backdrop-blur px-2.5 py-1.5 border border-border">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                AI 3D preview · experimental
              </span>
            </div>
            {meshUrl && (
              <div className="absolute bottom-3 right-3">
                <Button
                  variant="glass"
                  size="sm"
                  onClick={generateMesh}
                  disabled={isGenerating || !approved}
                >
                  <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isGenerating && "animate-spin")} />
                  Regenerate
                </Button>
              </div>
            )}
          </div>
        </div>

        {meshStatus === "failed" && (approved as any)?.preview_mesh_error && (
          <div className="glass rounded-xl p-3 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground">
              Mesh generation failed: {(approved as any).preview_mesh_error}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Step 4 · Fitted Parts</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Generate body kit parts</h1>
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
          onClick={aiSuggest}
          disabled={!approved || !conceptSet || suggesting}
        >
          {suggesting ? (
            <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> AI suggesting parts…</>
          ) : (
            <><Wand2 className="mr-2 h-4 w-4" /> Generate parts from concept</>
          )}
        </Button>

        {/* Experimental 3D preview generation */}
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <h3 className="text-sm font-semibold tracking-tight">AI 3D preview</h3>
            <span className="ml-auto text-mono text-[9px] uppercase tracking-widest text-muted-foreground">
              experimental
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Turn your approved concept render into a rough 3D mesh for visual reference.
            Not exportable — the parametric kit is still the source of truth.
          </p>
          <Button
            variant="glass"
            size="sm"
            className="w-full"
            onClick={generateMesh}
            disabled={!approved || isGenerating}
          >
            {isGenerating ? (
              <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Generating mesh…</>
            ) : meshUrl ? (
              <><RefreshCw className="mr-2 h-4 w-4" /> Regenerate 3D preview</>
            ) : (
              <><Box className="mr-2 h-4 w-4" /> Generate 3D preview</>
            )}
          </Button>
        </div>

        <div className="glass rounded-xl">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Body kit parts</h3>
            <StatusChip tone="neutral" size="sm">{parts.filter((p) => p.enabled).length} enabled</StatusChip>
          </div>
          <div className="p-3 space-y-1">
            {PART_KINDS.map((p) => {
              const existing = partByKind(p.kind);
              const on = !!existing?.enabled;
              const aiSupported = AI_PART_SUPPORTED.has(p.kind);
              const aiStatus = (existing as any)?.ai_mesh_status as string | undefined;
              const aiUrl = (existing as any)?.ai_mesh_url as string | undefined;
              const isAiGenerating = aiStatus === "generating" || generatingPartId === existing?.id;
              return (
                <div key={p.kind} className={cn(
                  "rounded-md px-2.5 py-2 transition-colors",
                  on ? "bg-primary/[0.06]" : "hover:bg-surface-2",
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{p.label}</span>
                      {aiUrl && aiStatus === "ready" && (
                        <span className="inline-flex items-center gap-1 rounded-sm bg-accent/15 px-1.5 py-0.5 text-mono text-[9px] uppercase tracking-widest text-accent">
                          <Sparkles className="h-2.5 w-2.5" /> AI mesh
                        </span>
                      )}
                    </div>
                    <Switch checked={on} onCheckedChange={() => togglePart(p.kind)} />
                  </div>
                  {on && aiSupported && (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {aiStatus === "ready" ? "Custom AI geometry"
                          : aiStatus === "failed" ? "AI mesh failed"
                          : isAiGenerating ? "Generating AI mesh…"
                          : "Parametric placeholder"}
                      </span>
                      <Button
                        variant="glass"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => existing?.id && generatePartMesh(existing.id, p.kind)}
                        disabled={!existing?.id || isAiGenerating}
                      >
                        {isAiGenerating ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Cpu className="mr-1.5 h-3 w-3" />
                            <span className="text-[11px]">{aiUrl ? "Regenerate" : "AI mesh"}</span>
                          </>
                        )}
                      </Button>
                    </div>
                  )}
                  {aiStatus === "failed" && (existing as any)?.ai_mesh_error && (
                    <p className="mt-1.5 text-[11px] text-destructive/80">{(existing as any).ai_mesh_error}</p>
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
