/**
 * BakeBodyKitButton — kicks off a "freeze the shell into a panel kit" bake
 * and shows the list of existing/in-flight kits for this project.
 *
 * Step 2 only inserts the `body_kits` row in `queued` status — the edge
 * worker that does the actual subtract/split lands in step 3. This UI is
 * deliberately decoupled so the button works against the live data model
 * the moment the worker is wired up.
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Package, Loader2, CheckCircle2, AlertCircle, Trash2, Sparkles, Eye } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  useBodyKits,
  useBakeBodyKit,
  useDeleteBodyKit,
  bodyKitStatusLabel,
  isBodyKitInFlight,
  type BodyKit,
  type BodyKitStatus,
  type AutofitPartKind,
} from "@/lib/build-studio/body-kits";
import type { ShellTransform } from "@/components/build-studio/BuildStudioViewport";
import { BodyKitViewerDialog } from "@/components/build-studio/BodyKitViewerDialog";

interface Props {
  projectId: string | null;
  userId: string | null;
  /** Currently selected shell skin id — required to bake. */
  bodySkinId: string | null;
  /** Donor car template id (forwarded to the bake job for alignment). */
  donorCarTemplateId: string | null;
  /** Current shell_alignments row id, if persisted. */
  shellAlignmentId: string | null;
  /** Current shell transform (snapshot stored on the kit). */
  shellTransform: ShellTransform | null;
  /** Persisted preference: stretch on X allowed. */
  stretchEnabled: boolean;
  disabled?: boolean;
}

const PART_KIND_OPTIONS: Array<{ value: AutofitPartKind; label: string; w: number; h: number; d: number }> = [
  { value: "wing",     label: "Wing",     w: 1500, h: 200, d: 400 },
  { value: "spoiler",  label: "Spoiler",  w: 1400, h: 120, d: 250 },
  { value: "bumper",   label: "Bumper",   w: 1700, h: 350, d: 500 },
  { value: "lip",      label: "Lip",      w: 1600, h: 80,  d: 200 },
  { value: "skirt",    label: "Skirt",    w: 1800, h: 100, d: 180 },
  { value: "diffuser", label: "Diffuser", w: 1500, h: 150, d: 400 },
];

export function BakeBodyKitButton({
  projectId,
  userId,
  bodySkinId,
  donorCarTemplateId,
  shellAlignmentId,
  shellTransform,
  stretchEnabled,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [viewKit, setViewKit] = useState<BodyKit | null>(null);
  const [partKind, setPartKind] = useState<AutofitPartKind>("wing");
  const [widthMm, setWidthMm] = useState<number>(1500);
  const [heightMm, setHeightMm] = useState<number>(200);
  const [depthMm, setDepthMm] = useState<number>(400);
  const { data: kits = [], isLoading } = useBodyKits(projectId);
  const bake = useBakeBodyKit();
  const del = useDeleteBodyKit();

  const canBake = !!projectId && !!userId && !!bodySkinId && !!shellTransform;

  const handlePartKindChange = (value: AutofitPartKind) => {
    setPartKind(value);
    const preset = PART_KIND_OPTIONS.find((p) => p.value === value);
    if (preset) {
      setWidthMm(preset.w);
      setHeightMm(preset.h);
      setDepthMm(preset.d);
    }
  };

  const handleBake = async () => {
    if (!canBake) {
      toast.error("Load a shell skin and align it before baking.");
      return;
    }
    try {
      await bake.mutateAsync({
        user_id: userId!,
        project_id: projectId!,
        body_skin_id: bodySkinId!,
        shell_alignment_id: shellAlignmentId,
        donor_car_template_id: donorCarTemplateId,
        baked_transform: {
          position: shellTransform!.position,
          rotation: shellTransform!.rotation,
          scale: shellTransform!.scale,
          scale_to_wheelbase: stretchEnabled,
        },
        part_kind: partKind,
        width_mm: widthMm,
        height_mm: heightMm,
        depth_mm: depthMm,
      });
      toast.success(`${partKind} fitted ✓`);
    } catch (e) {
      toast.error(`Autofit failed: ${(e as Error).message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!projectId) return;
    if (!confirm("Delete this bodykit and all its panels?")) return;
    try {
      await del.mutateAsync({ id, project_id: projectId });
      toast.success("Bodykit deleted");
    } catch (e) {
      toast.error(`Delete failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-9 px-3 text-xs"
          disabled={disabled || !bodySkinId}
          title={bodySkinId ? "Bake bodykit from shell" : "Load a shell skin first"}
        >
          <Package className="mr-1.5 h-3.5 w-3.5 text-primary" /> Bodykit
          {kits.length > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
              {kits.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-3">
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Bodykit bake</h3>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
          Freeze the aligned shell into individual panels (splitter, skirts,
          wing…) ready to attach as snap parts or list on the marketplace.
        </p>

        <Button
          onClick={handleBake}
          disabled={!canBake || bake.isPending}
          size="sm"
          className="h-8 w-full justify-start text-xs"
        >
          {bake.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Package className="mr-2 h-3.5 w-3.5" />
          )}
          Bake bodykit from current shell
        </Button>
        {!canBake && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Requires a loaded shell skin with a saved alignment.
          </p>
        )}

        <Separator className="my-3" />

        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Project kits
          </span>
          <span className="text-[10px] text-muted-foreground">{kits.length}</span>
        </div>

        {isLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            <Loader2 className="mx-auto mb-1 h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : kits.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
            No bodykits yet. Bake one from the current shell.
          </div>
        ) : (
          <ul className="max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
            {kits.map((k) => (
              <li
                key={k.id}
                className="rounded-md border border-border bg-card/40 p-2"
              >
                <div className="flex items-start gap-2">
                  <StatusIcon status={k.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{k.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                        {bodyKitStatusLabel(k.status)}
                      </Badge>
                      <span>·</span>
                      <span>{k.panel_count} panel{k.panel_count === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{formatDistanceToNow(new Date(k.created_at), { addSuffix: true })}</span>
                    </div>
                    {k.error && (
                      <div className="mt-1 text-[10px] text-destructive">{k.error}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {k.status === "ready" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={() => setViewKit(k)}
                        title="View bodykit"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(k.id)}
                      title="Delete bodykit"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
    <BodyKitViewerDialog
      kit={viewKit}
      open={!!viewKit}
      onOpenChange={(o) => !o && setViewKit(null)}
    />
    </>
  );
}

function StatusIcon({ status }: { status: BodyKitStatus }) {
  if (status === "ready") return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "failed") return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (isBodyKitInFlight(status)) return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  return <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}
