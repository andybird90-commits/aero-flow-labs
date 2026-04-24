/**
 * SendToCadWorker
 *
 * Dialog opened from `ExtractedPartPreview` when the user picks "Build with
 * CAD". Generates a parametric recipe via Gemini, then dispatches it to the
 * external CAD worker (CadQuery reference impl) via `dispatch-cad-job`. Polls
 * `cad-job-status` until the worker returns STEP / STL / GLB / preview, then
 * surfaces download links.
 *
 * The result also lands in `/library` automatically via the
 * `sync_cad_job_library_items` trigger.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Send, Download, AlertTriangle, CheckCircle2, Wrench, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useGenerateCadRecipe,
  useDispatchCadJob,
  useCadJob,
  useRefreshCadJob,
} from "@/lib/cad-jobs";
import { useCadWorkerStatus } from "@/lib/cad-worker-status";
import { CadWorkerSetupCard } from "@/components/CadWorkerSetupCard";

interface Props {
  open: boolean;
  onClose: () => void;
  conceptId: string | null;
  projectId?: string | null;
  partKind: string;
  partLabel: string;
  /** Optional reference images (the AI-rendered isolated views) — given to
   *  the recipe generator so the geometry matches what the user just approved. */
  referenceImageUrls?: string[];
  /** Optional base car STL — useful for body-conforming parts so the recipe
   *  can project against the real body surface. */
  baseMeshUrl?: string | null;
}

export function SendToCadWorker({
  open, onClose, conceptId, projectId, partKind, partLabel,
  referenceImageUrls = [], baseMeshUrl,
}: Props) {
  const { toast } = useToast();
  const generate = useGenerateCadRecipe();
  const dispatch = useDispatchCadJob();
  const refresh = useRefreshCadJob();
  const [notes, setNotes] = useState("");
  const [recipe, setRecipe] = useState<Record<string, any> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useCadJob(jobId);
  const status = job.data?.status;
  const refreshErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRecipe(null);
      setJobId(null);
      setNotes("");
      refreshErrorRef.current = null;
    }
  }, [open]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!jobId) return;
    if (status === "succeeded" || status === "failed") return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let consecutiveErrors = 0;

    const poll = async () => {
      if (cancelled) return;
      let nextDelay = 5000;
      try {
        await refreshRef.current.mutateAsync(jobId);
        refreshErrorRef.current = null;
        consecutiveErrors = 0;
      } catch (e: any) {
        consecutiveErrors += 1;
        const message = String(e?.message ?? e);
        if (refreshErrorRef.current !== message) {
          refreshErrorRef.current = message;
          toastRef.current({
            title: "CAD status refresh failed",
            description: message,
            variant: "destructive",
          });
        }
        if (consecutiveErrors >= 5) return;
        nextDelay = Math.min(60000, 5000 * 2 ** (consecutiveErrors - 1));
      }
      if (!cancelled) timeoutId = window.setTimeout(poll, nextDelay);
    };

    timeoutId = window.setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [jobId, status]);

  const onGenerate = async () => {
    try {
      const r = await generate.mutateAsync({
        concept_id: conceptId,
        part_kind: partKind,
        part_label: partLabel,
        reference_image_urls: referenceImageUrls,
        base_mesh_url: baseMeshUrl ?? null,
        notes,
      });
      setRecipe(r);
      toast({ title: "Recipe ready", description: `${r?.features?.length ?? 0} CAD features.` });
    } catch (e: any) {
      toast({ title: "Recipe failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const onDispatch = async () => {
    if (!recipe) return;
    try {
      const id = await dispatch.mutateAsync({
        concept_id: conceptId,
        project_id: projectId ?? null,
        part_kind: partKind,
        part_label: partLabel,
        recipe,
        inputs: { base_mesh_url: baseMeshUrl ?? null },
      });
      setJobId(id);
      toast({ title: "CAD job queued", description: "Sent to the CadQuery worker." });
    } catch (e: any) {
      toast({ title: "Dispatch failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const outputs = job.data?.outputs ?? {};
  const stepUrl = outputs.step_url as string | undefined;
  const stlUrl = outputs.stl_url as string | undefined;
  const glbUrl = outputs.glb_url as string | undefined;
  const previewUrl = outputs.preview_png_url as string | undefined;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            Build {partLabel} with CAD
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {partKind}
            </span>
          </DialogTitle>
          <DialogDescription>
            Parametric CadQuery build. Generates a feature recipe (sketches, extrudes, fillets), dispatches
            it to the CAD worker, and re-hosts the resulting STEP / STL / GLB.
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                Designer notes (optional)
              </Label>
              <Textarea
                placeholder="e.g. 25mm flare on each arch, NACA 6412 wing profile, single-seat splitter section…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            {!recipe ? (
              <div className="rounded-md border border-border bg-surface-0 p-3 text-xs text-muted-foreground">
                Step 1: Generate a parametric recipe from the picked part + your notes.
              </div>
            ) : (
              <div className="rounded-md border border-success/40 bg-success/10 text-xs p-3 inline-flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-success" />
                <div>
                  Recipe ready — <span className="font-mono">{recipe?.features?.length ?? 0}</span> features.
                  Step 2: dispatch to the Onshape worker.
                </div>
              </div>
            )}

            {recipe && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Inspect recipe JSON
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-0 border border-border p-2 font-mono text-[10px] leading-tight">
                  {JSON.stringify(recipe, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border bg-surface-0 p-3 flex items-center gap-3">
              {status === "succeeded" ? (
                <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
              ) : status === "failed" ? (
                <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                  Status
                </div>
                <div className="font-medium">
                  {status === "succeeded" ? "Built" :
                   status === "failed" ? "Failed" :
                   status === "running" ? "Building in CAD…" :
                   "Queued"}
                </div>
                {job.data?.error && (
                  <div className="text-xs text-destructive font-mono mt-1 whitespace-pre-wrap">
                    {job.data.error}
                  </div>
                )}
              </div>
            </div>

            {previewUrl && (
              <div className="rounded-md border border-border bg-surface-0 overflow-hidden">
                <img src={previewUrl} alt="CAD preview" className="w-full h-48 object-contain" />
              </div>
            )}

            {status === "succeeded" && (stepUrl || stlUrl || glbUrl) && (
              <div className="flex flex-wrap gap-2">
                {stepUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={stepUrl} download target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4 mr-1" /> STEP
                    </a>
                  </Button>
                )}
                {stlUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={stlUrl} download target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4 mr-1" /> STL
                    </a>
                  </Button>
                )}
                {glbUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={glbUrl} download target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4 mr-1" /> GLB
                    </a>
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {!jobId && !recipe && (
            <Button onClick={onGenerate} disabled={generate.isPending}>
              {generate.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating recipe…</>
                : <><Wrench className="h-4 w-4 mr-1" /> Generate CAD recipe</>}
            </Button>
          )}
          {!jobId && recipe && (
            <Button onClick={onDispatch} disabled={dispatch.isPending}>
              {dispatch.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Dispatching…</>
                : <><Send className="h-4 w-4 mr-1" /> Send to CAD worker</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
