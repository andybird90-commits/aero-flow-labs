/**
 * Admin: hero-car STL library.
 *
 * Upload one STL per car_template, choose its forward axis (matches the
 * concept renderer's camera convention), and run the repair pass to make it
 * eligible for the boolean aero-kit pipeline.
 *
 * Gated by the `admin` role. Non-admins get a polite "no access" panel
 * instead of the upload UI.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { z } from "zod";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import {
  useIsAdmin, useCarStls, useUpsertCarStl, useDeleteCarStl, useUpdateCarStlAxis,
  useCarTemplates, useCreateCarTemplate, useUploadCarGlb, useDeleteCarGlb,
  type CarStl, type CarTemplate,
} from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { decimateClientSide } from "@/lib/decimate-client";
import {
  Upload, Wrench, Trash2, CheckCircle2, AlertTriangle, Loader2, FileBox, Plus, X, Sparkles, Palette, Scissors, ChevronDown, ChevronUp, Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCarPanels,
  useRunAutoSplit,
  useUpdateCarPanelSlot,
  panelDisplayLabel,
  PANEL_SLOT_LABELS,
  type CarPanel,
} from "@/lib/build-studio/car-panels";
import { CarPanelsPreview } from "@/components/admin/CarPanelsPreview";

// Anything above this gets quadric-edge-collapse decimated in a Web Worker
// before upload so the edge worker can repair it within its 256 MB cap.
// Quadric collapse preserves silhouettes far better than vertex clustering,
// so we can run with a much higher triangle budget without quality loss.
const DECIMATE_THRESHOLD_BYTES = 30 * 1024 * 1024;
const DECIMATE_TARGET_TRIANGLES = 500_000;

const newTemplateSchema = z.object({
  make: z.string().trim().min(1, "Make required").max(60),
  model: z.string().trim().min(1, "Model required").max(60),
  trim: z.string().trim().max(60).optional().or(z.literal("")),
  yearRange: z.string().trim().max(20).optional().or(z.literal("")),
});

const FORWARD_AXES = [
  { value: "-z", label: "−Z forward (default, three.js / glTF)" },
  { value: "+z", label: "+Z forward" },
  { value: "-x", label: "−X forward" },
  { value: "+x", label: "+X forward" },
  { value: "-y", label: "−Y forward (Z-up)" },
  { value: "+y", label: "+Y forward" },
];

export default function AdminCarStls() {
  const { user, loading: authLoading } = useAuth();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);

  if (authLoading || roleLoading) {
    return (
      <AppLayout>
        <div className="grid place-items-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </AppLayout>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-2xl px-6 py-16">
          <div className="glass rounded-xl p-8 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-warning" />
            <h2 className="mt-3 text-lg font-semibold tracking-tight">Admins only</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              The hero-car STL library is restricted. Ask an administrator if you need upload access.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }
  return (
    <AppLayout>
      <CarStlsInner userId={user.id} />
    </AppLayout>
  );
}

function CarStlsInner({ userId }: { userId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: templates = [] } = useCarTemplates();
  const { data: rows = [], isLoading } = useCarStls();
  const upsert = useUpsertCarStl();
  const del = useDeleteCarStl();
  const updateAxis = useUpdateCarStlAxis();
  const createTemplate = useCreateCarTemplate();

  const [pendingTemplateId, setPendingTemplateId] = useState<string>("");
  const [pendingAxis, setPendingAxis] = useState<string>("-z");
  const [repairing, setRepairing] = useState<string | null>(null);
  const [decimating, setDecimating] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inline new-template form state.
  const [showNewForm, setShowNewForm] = useState(false);
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newTrim, setNewTrim] = useState("");
  const [newYear, setNewYear] = useState("");

  const usedTemplateIds = useMemo(() => new Set(rows.map((r) => r.car_template_id)), [rows]);
  const availableTemplates = templates.filter((t) => !usedTemplateIds.has(t.id));

  // Paint-map status per car_stl (admin-curated vs auto vs none).
  const stlIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const { data: paintMaps = [] } = useQuery({
    queryKey: ["car_material_maps_summary", stlIds.join(",")],
    enabled: stlIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("car_material_maps")
        .select("car_stl_id, method")
        .in("car_stl_id", stlIds);
      if (error) throw error;
      return data as { car_stl_id: string; method: string }[];
    },
  });
  const paintMapByStlId = useMemo(() => {
    const m = new Map<string, string>();
    paintMaps.forEach((r) => m.set(r.car_stl_id, r.method));
    return m;
  }, [paintMaps]);

  const submitNewTemplate = async () => {
    const parsed = newTemplateSchema.safeParse({
      make: newMake, model: newModel, trim: newTrim, yearRange: newYear,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast({ title: "Check the form", description: first.message, variant: "destructive" });
      return;
    }
    try {
      const created = await createTemplate.mutateAsync(parsed.data);
      toast({ title: "Template added", description: `${created.make} ${created.model} is ready for an STL.` });
      setPendingTemplateId(created.id);
      setShowNewForm(false);
      setNewMake(""); setNewModel(""); setNewTrim(""); setNewYear("");
    } catch (e: any) {
      toast({ title: "Couldn’t add template", description: String(e.message ?? e), variant: "destructive" });
    }
  };


  const onPickFile = async (file: File) => {
    if (!pendingTemplateId) {
      toast({ title: "Choose a car template first", variant: "destructive" });
      return;
    }
    if (!/\.(stl|obj)$/i.test(file.name)) {
      toast({ title: "STL or OBJ files only", variant: "destructive" });
      return;
    }

    let toUpload = file;
    // Decimate large meshes client-side so the repair edge function fits
    // inside the 256 MB worker. Vertex-clustering preserves silhouette.
    if (file.size > DECIMATE_THRESHOLD_BYTES) {
      try {
        setDecimating(file.name);
        toast({
          title: "Simplifying mesh…",
          description: `${(file.size / 1024 / 1024).toFixed(1)} MB is too large to repair as-is. Reducing to ~${DECIMATE_TARGET_TRIANGLES.toLocaleString()} triangles in your browser.`,
        });
        const res = await decimateClientSide(file, DECIMATE_TARGET_TRIANGLES);
        toUpload = res.file;
        toast({
          title: "Mesh simplified",
          description: `${res.triCountIn.toLocaleString()} → ${res.triCountOut.toLocaleString()} tris · ${(res.originalSizeBytes / 1024 / 1024).toFixed(1)} → ${(res.decimatedSizeBytes / 1024 / 1024).toFixed(1)} MB`,
        });
      } catch (e: any) {
        toast({ title: "Couldn’t simplify mesh", description: String(e.message ?? e), variant: "destructive" });
        setDecimating(null);
        return;
      } finally {
        setDecimating(null);
      }
    }

    try {
      await upsert.mutateAsync({
        userId,
        carTemplateId: pendingTemplateId,
        file: toUpload,
        forwardAxis: pendingAxis,
      });
      toast({ title: "STL uploaded", description: "Run repair to make it eligible for boolean kits." });
      setPendingTemplateId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      toast({ title: "Upload failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const runRepair = async (row: CarStl) => {
    setRepairing(row.id);
    try {
      const { data, error } = await supabase.functions.invoke("repair-car-stl", {
        body: { car_stl_id: row.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({
        title: "Repair queued",
        description: "Sent to Blender — this can take 1–3 minutes for the voxel remesh.",
      });

      // Poll the row until manifold_clean flips or notes show a failure.
      const startedAt = Date.now();
      const TIMEOUT_MS = 6 * 60 * 1000;
      while (Date.now() - startedAt < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 4000));
        const { data: fresh } = await supabase
          .from("car_stls")
          .select("manifold_clean, repaired_stl_path, triangle_count, notes, updated_at")
          .eq("id", row.id)
          .maybeSingle();
        if (!fresh) continue;

        // Failure path — runRepair on the server writes "[repair failed] ..." to notes.
        if (fresh.notes?.startsWith("[repair failed]")) {
          throw new Error(fresh.notes.replace("[repair failed] ", ""));
        }
        // Success: the row was updated with a repaired path AFTER we kicked off.
        if (
          fresh.repaired_stl_path &&
          new Date(fresh.updated_at).getTime() > startedAt - 5000
        ) {
          qc.invalidateQueries({ queryKey: ["car_stls"] });
          qc.invalidateQueries({ queryKey: ["car_stl_for_template", row.car_template_id] });
          qc.invalidateQueries({ queryKey: ["hero_stl_for_project"] });
          toast({
            title: fresh.manifold_clean ? "Repair complete · manifold ✓" : "Repair complete · still non-manifold",
            description: `${fresh.triangle_count?.toLocaleString() ?? "?"} tris · ${fresh.notes ?? ""}`,
          });
          return;
        }
      }
      throw new Error("Repair timed out waiting for the worker.");
    } catch (e: any) {
      toast({ title: "Repair failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setRepairing(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 space-y-6">
      <div>
        <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Admin · Reference geometry</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Hero-car STL library</h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
          One ground-truth STL per car template. The boolean aero-kit pipeline pushes this surface outward
          where the concept silhouette extends past it, then subtracts the original to leave a printable kit.
        </p>
      </div>

      {/* Upload card */}
      <div className="glass rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Add a hero mesh (STL or OBJ)</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowNewForm((s) => !s)}
            className="text-mono text-[10px] uppercase tracking-widest"
          >
            {showNewForm ? <><X className="mr-1 h-3 w-3" /> Cancel</> : <><Plus className="mr-1 h-3 w-3" /> New template</>}
          </Button>
        </div>

        {showNewForm && (
          <div className="rounded-lg border border-border bg-surface-1/50 p-3 space-y-2">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Add any car — make &amp; model required
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Make (e.g. BMW)" value={newMake} onChange={(e) => setNewMake(e.target.value)} maxLength={60} />
              <Input placeholder="Model (e.g. M3)" value={newModel} onChange={(e) => setNewModel(e.target.value)} maxLength={60} />
              <Input placeholder="Trim (optional, e.g. Competition)" value={newTrim} onChange={(e) => setNewTrim(e.target.value)} maxLength={60} />
              <Input placeholder="Year range (optional, e.g. 2021-2024)" value={newYear} onChange={(e) => setNewYear(e.target.value)} maxLength={20} />
            </div>
            <div className="flex justify-end">
              <Button variant="hero" size="sm" onClick={submitNewTemplate} disabled={createTemplate.isPending}>
                {createTemplate.isPending ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Adding…</>
                ) : (
                  <><Plus className="mr-1.5 h-3.5 w-3.5" /> Add template</>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
          <Select value={pendingTemplateId} onValueChange={setPendingTemplateId}>
            <SelectTrigger>
              <SelectValue placeholder={availableTemplates.length ? "Choose car template…" : "All templates have an STL — add a new one"} />
            </SelectTrigger>
            <SelectContent>
              {availableTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.make} {t.model}{t.trim ? ` ${t.trim}` : ""}{t.year_range ? ` · ${t.year_range}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pendingAxis} onValueChange={setPendingAxis}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORWARD_AXES.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".stl,.obj,model/stl,model/obj,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
            }}
          />
          <Button
            variant="hero"
            disabled={!pendingTemplateId || upsert.isPending || !!decimating}
            onClick={() => fileInputRef.current?.click()}
          >
            {decimating ? (
              <><Sparkles className="mr-2 h-4 w-4 animate-pulse" /> Simplifying…</>
            ) : upsert.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="mr-2 h-4 w-4" /> Choose STL / OBJ</>
            )}
          </Button>
        </div>
        <p className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Accepts .stl or .obj. Files over {(DECIMATE_THRESHOLD_BYTES / 1024 / 1024).toFixed(0)} MB are auto-simplified to ~{DECIMATE_TARGET_TRIANGLES.toLocaleString()} triangles in your browser. Forward axis must match how the model's nose points.
        </p>
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="grid place-items-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <FileBox className="mx-auto h-8 w-8 text-primary/60" />
            <h3 className="mt-3 text-lg font-semibold tracking-tight">No hero STLs yet</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Upload one STL per car template to enable the boolean aero-kit flow.
            </p>
          </div>
        ) : (
          rows.map((row) => (
            <CarStlRow
              key={row.id}
              row={row}
              template={row.car_template}
              repairing={repairing === row.id}
              paintMapMethod={paintMapByStlId.get(row.id) ?? null}
              onRepair={() => runRepair(row)}
              onDelete={async () => {
                if (!confirm(`Delete the STL for ${row.car_template?.make ?? "this template"}?`)) return;
                try {
                  await del.mutateAsync(row);
                  toast({ title: "Deleted" });
                } catch (e: any) {
                  toast({ title: "Delete failed", description: String(e.message ?? e), variant: "destructive" });
                }
              }}
              onAxisChange={(forward_axis) => updateAxis.mutate({ id: row.id, forward_axis })}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CarStlRow({
  row, template, repairing, paintMapMethod, onRepair, onDelete, onAxisChange,
}: {
  row: CarStl;
  template: CarTemplate | null;
  repairing: boolean;
  paintMapMethod: string | null;
  onRepair: () => void;
  onDelete: () => void;
  onAxisChange: (axis: string) => void;
}) {
  const repaired = !!row.repaired_stl_path;
  const manifold = row.manifold_clean;
  const tris = row.triangle_count;
  const { toast } = useToast();

  const { data: panels = [] } = useCarPanels(row.id);
  const runSplit = useRunAutoSplit();
  const updateSlot = useUpdateCarPanelSlot();
  const [showPanels, setShowPanels] = useState(false);
  const [splitConfirmOpen, setSplitConfirmOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  const onAutoSplit = async () => {
    setSplitConfirmOpen(false);
    try {
      const res = await runSplit.mutateAsync({ car_stl_id: row.id });
      if (!res.ok) {
        const failed = res as { ok: false; reason: string; message: string };
        toast({
          title: failed.reason === "no_shut_lines_detected"
            ? "No shut lines detected"
            : "Couldn't auto-split",
          description: failed.message,
          variant: "destructive",
        });
        return;
      }
      setShowPanels(true);
      toast({
        title: `Split into ${res.total_panels} panels`,
        description: `${res.named_panels} named · ${res.unknown_panels} unknown · ${res.sharp_edges.toLocaleString()} sharp edges`,
      });
    } catch (e: any) {
      toast({
        title: "Auto-split failed",
        description: String(e.message ?? e),
        variant: "destructive",
      });
    }
  };

  const splitBadge = panels.length > 0 ? (
    <Badge variant="outline" className="border-primary/40 text-primary">
      <Scissors className="mr-1 h-3 w-3" /> {panels.length} panels
    </Badge>
  ) : null;

  return (
    <div className="glass rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-semibold tracking-tight truncate">
              {template ? `${template.make} ${template.model}` : "Unknown template"}
              {template?.trim ? <span className="text-muted-foreground"> {template.trim}</span> : null}
            </div>
            {!repaired ? (
              <Badge variant="outline" className="border-warning/40 text-warning">Needs repair</Badge>
            ) : manifold ? (
              <Badge variant="outline" className="border-success/40 text-success">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Manifold
              </Badge>
            ) : (
              <Badge variant="outline" className="border-warning/40 text-warning">
                <AlertTriangle className="mr-1 h-3 w-3" /> Non-manifold
              </Badge>
            )}
            {paintMapMethod === "manual" ? (
              <Badge variant="outline" className="border-success/40 text-success">
                <Palette className="mr-1 h-3 w-3" /> Paint: curated
              </Badge>
            ) : paintMapMethod ? (
              <Badge variant="outline" className="border-warning/40 text-warning">
                <Palette className="mr-1 h-3 w-3" /> Paint: auto
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <Palette className="mr-1 h-3 w-3" /> Paint: none
              </Badge>
            )}
            {splitBadge}
          </div>
          <div className="mt-1 text-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">
            {row.stl_path}
            {tris ? ` · ${tris.toLocaleString()} tris` : ""}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={row.forward_axis} onValueChange={onAxisChange}>
            <SelectTrigger className="h-8 w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORWARD_AXES.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="glass"
            size="sm"
            onClick={onRepair}
            disabled={repairing}
            className={cn(repaired && manifold && "opacity-70")}
          >
            {repairing ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Repairing…</>
            ) : (
              <><Wrench className="mr-1.5 h-3.5 w-3.5" /> {repaired ? "Re-repair" : "Run repair"}</>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!repaired || runSplit.isPending}
            onClick={() => panels.length > 0 ? setSplitConfirmOpen(true) : onAutoSplit()}
            title={!repaired ? "Run repair first" : "Auto-split into body panels along shut lines"}
          >
            {runSplit.isPending ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Splitting…</>
            ) : (
              <><Scissors className="mr-1.5 h-3.5 w-3.5" /> {panels.length > 0 ? "Re-split" : "Auto-split"}</>
            )}
          </Button>
          <Button asChild variant="outline" size="sm" disabled={!repaired}>
            <Link to={`/settings/car-stls/${row.id}/paint-map`}>
              <Palette className="mr-1.5 h-3.5 w-3.5" /> Edit paint map
            </Link>
          </Button>
          {panels.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPanels((s) => !s)}
              title={showPanels ? "Hide panels" : "Show panels"}
            >
              {showPanels ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {splitConfirmOpen && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <div className="font-semibold text-warning">Re-split this car?</div>
          <p className="mt-1 text-muted-foreground">
            The {panels.length} existing panel{panels.length === 1 ? "" : "s"} will be replaced. Auto-derived hardpoints linked to those panels will also be removed.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSplitConfirmOpen(false)}>Cancel</Button>
            <Button size="sm" variant="hero" onClick={onAutoSplit}>Re-split</Button>
          </div>
        </div>
      )}

      {showPanels && panels.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
          <CarPanelsPreview panels={panels} highlightedPanelId={highlighted} />
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
              Detected panels · click slot to relabel
            </div>
            {panels.map((p) => (
              <PanelRow
                key={p.id}
                panel={p}
                highlighted={highlighted === p.id}
                onHover={(on) => setHighlighted(on ? p.id : null)}
                onRelabel={(slot) =>
                  updateSlot.mutate({ id: p.id, car_stl_id: row.id, slot })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelRow({
  panel, highlighted, onHover, onRelabel,
}: {
  panel: CarPanel;
  highlighted: boolean;
  onHover: (on: boolean) => void;
  onRelabel: (slot: string) => void;
}) {
  const isUnknown = panel.slot.startsWith("unknown");
  const conf = panel.confidence;
  const confColor = conf >= 0.75 ? "text-success" : conf >= 0.6 ? "text-warning" : "text-destructive";
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-surface-1/40 p-2 transition-colors",
        highlighted && "border-primary/60 bg-primary/5",
      )}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Select value={isUnknown ? "" : panel.slot.replace(/_(\d+)$/, "")} onValueChange={onRelabel}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={panelDisplayLabel(panel.slot)} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PANEL_SLOT_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className={cn("text-mono text-[10px] uppercase tracking-widest", confColor)}>
          {(conf * 100).toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 text-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {panel.triangle_count.toLocaleString()} tris · {(panel.area_m2).toFixed(2)} m²
      </div>
    </div>
  );
}
