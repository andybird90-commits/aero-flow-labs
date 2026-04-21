/**
 * SendToGeometryWorker
 *
 * Dialog opened from `ExtractedPartPreview` when the picked part is
 * body-conforming (arches, scoops, skirts, lips). Collects mount-zone, side
 * and fitting params, then dispatches a `fit_part_to_zone` job to the
 * external Blender worker via the `dispatch-geometry-job` edge function.
 *
 * Polls `geometry-job-status` until the job succeeds, then surfaces the
 * download links. The fitted result also lands in `/library` automatically
 * via the `sync_geometry_job_library_items` trigger.
 */
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Send, Download, AlertTriangle, CheckCircle2, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDispatchGeometryJob, useGeometryJob } from "@/lib/geometry-jobs";
import { MOUNT_ZONES } from "@/lib/prototyper/mount-zones";
import { FIT_CLASS_DESCRIPTION } from "@/lib/part-classification";

interface Props {
  open: boolean;
  onClose: () => void;
  conceptId: string | null;
  projectId?: string | null;
  partKind: string;
  partLabel: string;
  /** URL of the saved base car STL — required for fit_part_to_zone. */
  baseMeshUrl?: string | null;
  /** Optional rough part template; if omitted the worker uses the kind default. */
  partTemplateUrl?: string | null;
}

export function SendToGeometryWorker({
  open, onClose, conceptId, projectId, partKind, partLabel, baseMeshUrl, partTemplateUrl,
}: Props) {
  const { toast } = useToast();
  const dispatch = useDispatchGeometryJob();
  const [zone, setZone] = useState<string>("front_quarter");
  const [side, setSide] = useState<"left" | "right" | "center">("left");
  const [wallThickness, setWallThickness] = useState("2.0");
  const [offset, setOffset] = useState("1.5");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useGeometryJob(jobId);

  useEffect(() => {
    if (!open) {
      setJobId(null);
    }
  }, [open]);

  const onSubmit = async () => {
    if (!baseMeshUrl) {
      toast({
        title: "No base mesh",
        description: "Save a base car STL on this project before fitting body-conforming parts.",
        variant: "destructive",
      });
      return;
    }
    try {
      const id = await dispatch.mutateAsync({
        concept_id: conceptId,
        project_id: projectId ?? null,
        part_kind: partKind,
        mount_zone: zone,
        side,
        job_type: "fit_part_to_zone",
        inputs: {
          base_mesh_url: baseMeshUrl,
          part_template_url: partTemplateUrl ?? null,
          zone,
          side,
          params: {
            wall_thickness_mm: Number(wallThickness),
            offset_mm: Number(offset),
          },
        },
      });
      setJobId(id);
      toast({ title: "Job queued", description: "Sent to the geometry worker." });
    } catch (e: any) {
      toast({
        title: "Dispatch failed",
        description: String(e.message ?? e),
        variant: "destructive",
      });
    }
  };

  const status = job.data?.status;
  const outputs = job.data?.outputs ?? {};
  const stlUrl = (outputs.fitted_stl_url ?? outputs.stl_url) as string | undefined;
  const glbUrl = outputs.glb_url as string | undefined;
  const previewUrl = outputs.preview_png_url as string | undefined;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Fit {partLabel} to body
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {partKind}
            </span>
          </DialogTitle>
          <DialogDescription>
            {FIT_CLASS_DESCRIPTION.body_conforming}
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          <div className="space-y-4 text-sm">
            {!baseMeshUrl && (
              <div className="rounded-md border border-warning/40 bg-warning/10 text-warning text-xs p-3 inline-flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  No base car mesh saved on this project. Add one in Garage → Hero-car STL
                  before fitting body-conforming parts.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                  Mount zone
                </Label>
                <Select value={zone} onValueChange={setZone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOUNT_ZONES.map((z) => (
                      <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                  Side
                </Label>
                <Select value={side} onValueChange={(v) => setSide(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                  Wall thickness (mm)
                </Label>
                <Input
                  type="number" step="0.1" min="0.5" max="10"
                  value={wallThickness}
                  onChange={(e) => setWallThickness(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-widest font-mono text-muted-foreground">
                  Body offset (mm)
                </Label>
                <Input
                  type="number" step="0.1" min="0" max="20"
                  value={offset}
                  onChange={(e) => setOffset(e.target.value)}
                />
              </div>
            </div>
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
                  {status === "succeeded" ? "Fitted" :
                   status === "failed" ? "Failed" :
                   status === "running" ? "Running on worker…" :
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
                <img
                  src={previewUrl}
                  alt="Fitted part preview"
                  className="w-full h-48 object-contain"
                />
              </div>
            )}

            {status === "succeeded" && (stlUrl || glbUrl) && (
              <div className="flex flex-wrap gap-2">
                {stlUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={stlUrl} download target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4 mr-1" /> Download STL
                    </a>
                  </Button>
                )}
                {glbUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={glbUrl} download target="_blank" rel="noreferrer">
                      <ImageIcon className="h-4 w-4 mr-1" /> Download GLB
                    </a>
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {!jobId && (
            <Button onClick={onSubmit} disabled={dispatch.isPending || !baseMeshUrl}>
              {dispatch.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Dispatching…</>
                : <><Send className="h-4 w-4 mr-1" /> Send to geometry worker</>}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
