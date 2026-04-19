/**
 * Exports — client-side STL/OBJ generation for fitted body kit parts.
 * Generates downloadable artifacts from the parametric parts on the active
 * concept set and records each export in the `exports` table.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  useExports, useCreateExport, useGeometry, useActiveConceptSet, useFittedParts,
  type ExportRow, type FittedPart,
} from "@/lib/repo";
import { buildPartMesh } from "@/lib/part-geometry";
import {
  FileDown, Box, Layers, Loader2, CheckCircle2, AlertCircle, Download, Clock, History,
  Package, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ExportKind = "kit_stl_pack" | "kit_obj_pack" | "single_part_stl" | "single_part_obj" | "project_pack";

const EXPORT_OPTIONS: {
  kind: ExportKind; icon: typeof FileDown; title: string; desc: string; format: string;
}[] = [
  { kind: "kit_stl_pack",     icon: Package, title: "Full kit · STL pack",  desc: "All enabled parts as a zipped STL archive.",         format: "ZIP / STL" },
  { kind: "kit_obj_pack",     icon: Package, title: "Full kit · OBJ pack",  desc: "All enabled parts as a zipped OBJ archive.",         format: "ZIP / OBJ" },
  { kind: "single_part_stl",  icon: Box,     title: "Single part · STL",    desc: "Pick one part and export as a single STL file.",     format: "STL" },
  { kind: "single_part_obj",  icon: Box,     title: "Single part · OBJ",    desc: "Pick one part and export as a single OBJ file.",     format: "OBJ" },
  { kind: "project_pack",     icon: Layers,  title: "Project pack",         desc: "All parts plus a manifest.json with build details.", format: "ZIP" },
];

const Exports = () => (
  <WorkspaceShell>
    {(ctx) => <ExportsContent projectId={ctx.projectId!} project={ctx.project} />}
  </WorkspaceShell>
);

function ExportsContent({ projectId, project }: { projectId: string; project: any }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: geometry } = useGeometry(projectId);
  const { data: conceptSet } = useActiveConceptSet(projectId);
  const { data: parts = [] } = useFittedParts(conceptSet?.id);
  const { data: exports = [], isLoading } = useExports(user?.id);
  const createExport = useCreateExport();

  const [selectedKind, setSelectedKind] = useState<ExportKind>("kit_stl_pack");
  const [singlePartId, setSinglePartId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabledParts = useMemo(() => parts.filter((p) => p.enabled), [parts]);

  const projectExports = useMemo(
    () => (exports as any[]).filter((e) => e.project_id === projectId),
    [exports, projectId],
  );

  const onGenerate = async () => {
    if (!user || enabledParts.length === 0) {
      toast({ title: "No enabled parts", description: "Enable parts in Fitted Parts first.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const targets =
        selectedKind === "single_part_stl" || selectedKind === "single_part_obj"
          ? enabledParts.filter((p) => p.id === (singlePartId ?? enabledParts[0].id))
          : enabledParts;
      if (targets.length === 0) throw new Error("No parts selected.");

      const useObj = selectedKind === "kit_obj_pack" || selectedKind === "single_part_obj";
      const single = selectedKind === "single_part_stl" || selectedKind === "single_part_obj";
      const ext = useObj ? "obj" : "stl";

      let blob: Blob;
      let filename: string;

      if (single) {
        const text = serializePart(targets[0], useObj);
        blob = new Blob([text], { type: "text/plain" });
        filename = `${slug(targets[0].kind)}.${ext}`;
      } else {
        const zip = new JSZip();
        for (const p of targets) {
          const text = serializePart(p, useObj);
          zip.file(`${slug(p.kind)}.${ext}`, text);
        }
        if (selectedKind === "project_pack") {
          zip.file("manifest.json", JSON.stringify({
            project: { id: projectId, name: project.name },
            car: project.car?.name ?? null,
            parts: targets.map((p) => ({ kind: p.kind, params: p.params })),
            exported_at: new Date().toISOString(),
          }, null, 2));
        }
        blob = await zip.generateAsync({ type: "blob" });
        filename = `${slug(project.name)}-${selectedKind}.zip`;
      }

      // Upload to storage
      const path = `${user.id}/${projectId}/${Date.now()}-${filename}`;
      const { error: upErr } = await supabase.storage.from("exports").upload(path, blob, {
        contentType: blob.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw upErr;

      // Record in exports table
      await createExport.mutateAsync({
        userId: user.id,
        projectId,
        kind: selectedKind,
        sections: { parts: targets.map((p) => p.kind) },
        filePath: path,
        fileSizeBytes: blob.size,
      });

      // Trigger immediate browser download
      triggerDownload(blob, filename);

      toast({ title: "Export ready", description: `${filename} (${formatBytes(blob.size)})` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async (row: ExportRow) => {
    if (!row.file_path) return;
    try {
      const { data, error } = await supabase.storage.from("exports").createSignedUrl(row.file_path, 60);
      if (error) throw error;
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = row.file_path.split("/").pop() ?? "export";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) return <div className="px-6 py-6"><LoadingState /></div>;

  const requiresPartPick = selectedKind === "single_part_stl" || selectedKind === "single_part_obj";

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
            Step 6 · Export
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fabrication-ready exports</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Export the generated body kit parts as STL or OBJ files for printing, milling or fabrication.
            All geometry is generated from your fitted parts — no solver, no fakery.
          </p>
        </div>
        <Button variant="hero" size="lg" disabled={busy || enabledParts.length === 0} onClick={onGenerate}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…</> : <><Download className="mr-2 h-4 w-4" /> Generate export</>}
        </Button>
      </div>

      {enabledParts.length === 0 && (
        <div className="glass rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            No enabled parts on this project.{" "}
            <Link to={`/parts?project=${projectId}`} className="text-primary hover:underline">Generate parts first</Link>.
          </div>
        </div>
      )}

      <Card icon={FileDown} title="Export format">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {EXPORT_OPTIONS.map((opt) => {
            const sel = opt.kind === selectedKind;
            const Icon = opt.icon;
            return (
              <button
                key={opt.kind}
                onClick={() => setSelectedKind(opt.kind)}
                className={cn(
                  "rounded-md border p-4 text-left transition-all",
                  sel ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
                )}
              >
                <div className="flex items-start justify-between">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-md",
                    sel ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground")}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {sel && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
                <div className="mt-3 text-sm font-semibold">{opt.title}</div>
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{opt.desc}</p>
                <div className="mt-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{opt.format}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {requiresPartPick && (
        <Card icon={ChevronRight} title="Select part">
          <div className="flex flex-wrap gap-2">
            {enabledParts.map((p) => {
              const sel = (singlePartId ?? enabledParts[0]?.id) === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSinglePartId(p.id)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm transition-colors",
                    sel ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-surface-1 hover:border-primary/30",
                  )}
                >
                  {humanLabel(p.kind)}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card icon={Box} title="Enabled parts" hint={`${enabledParts.length} part(s)`}>
        {enabledParts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts enabled.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {enabledParts.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2">
                <div className="text-sm">{humanLabel(p.kind)}</div>
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {Object.keys((p.params ?? {}) as object).length} params
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card icon={History} title="Export history" hint={`${projectExports.length} files`}>
        {projectExports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exports yet — generate one above.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            {projectExports.map((row: ExportRow) => {
              const opt = EXPORT_OPTIONS.find((o) => o.kind === row.kind);
              const Icon = opt?.icon ?? FileDown;
              const expired = row.expires_at && new Date(row.expires_at) < new Date();
              const ready = row.status === "ready" && !expired;
              return (
                <div key={row.id}
                  className={cn(
                    "grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 border-b border-border/40 last:border-b-0 px-3 py-2.5 items-center transition-colors hover:bg-surface-1/40",
                    !ready && "opacity-70",
                  )}>
                  <div className={cn("flex h-7 w-7 items-center justify-center rounded-md",
                    ready ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted-foreground")}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{opt?.title ?? row.kind}</div>
                    <div className="text-mono text-[10px] text-muted-foreground">
                      {row.id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="text-mono text-[11px] tabular-nums text-muted-foreground">
                    {row.file_size_bytes ? formatBytes(row.file_size_bytes) : "—"}
                  </div>
                  <div className="flex items-center gap-1 text-mono text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(row.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    {row.status === "generating" && (
                      <StatusChip tone="preview" size="sm">
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Generating
                      </StatusChip>
                    )}
                    {row.status === "failed" && (
                      <StatusChip tone="failed" size="sm">
                        <AlertCircle className="mr-1 h-3 w-3" /> Failed
                      </StatusChip>
                    )}
                    {expired && <StatusChip tone="warning" size="sm">Expired</StatusChip>}
                    {ready && (
                      <Button variant="glass" size="sm" onClick={() => onDownload(row)}>
                        <Download className="mr-1.5 h-3 w-3" /> Download
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ icon: Icon, title, hint, children }: {
  icon: typeof FileDown; title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
        {hint && <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ─── helpers ──────────────────────────────────────────── */

function serializePart(part: FittedPart, asObj: boolean): string {
  const mesh = buildPartMesh(part.kind, (part.params ?? {}) as Record<string, number>);
  // Scale metres → mm so slicers (Bambu / Prusa) open parts at real-world print size.
  mesh.scale.setScalar(1000);
  const scene = new THREE.Scene();
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  if (asObj) {
    return new OBJExporter().parse(scene);
  }
  return new STLExporter().parse(scene, { binary: false }) as string;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function humanLabel(kind: string) {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default Exports;
