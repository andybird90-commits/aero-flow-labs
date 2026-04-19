/**
 * Exports — generate downloadable artifacts (PDF / CSV / etc.) via the
 * generate-export edge function and list past exports with signed-URL
 * download links.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/StatusChip";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  useExports, useGenerateExport, useVariants, downloadExport,
  type ExportRow,
} from "@/lib/repo";
import {
  FileText, FileSpreadsheet, ClipboardList, Layers, Box, Image as ImageIcon,
  Download, Loader2, Clock, CheckCircle2, AlertCircle, History, Lock, Users, Globe,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ExportKind = "pdf_report" | "image_pack" | "comparison_sheet" | "aero_summary" | "stl_pack" | "assumptions_sheet";

const EXPORT_OPTIONS: {
  kind: ExportKind; icon: typeof FileText; title: string; desc: string; format: string;
}[] = [
  { kind: "pdf_report",        icon: FileText,        title: "PDF engineering report", desc: "Full client-ready report with metrics + recommendations.", format: "PDF" },
  { kind: "comparison_sheet",  icon: FileSpreadsheet, title: "Comparison sheet",       desc: "Variant metrics in CSV for spreadsheet analysis.",          format: "CSV" },
  { kind: "aero_summary",      icon: ClipboardList,   title: "Aero summary",           desc: "One-page spec card of the selected variant.",                format: "PDF" },
  { kind: "assumptions_sheet", icon: Layers,          title: "Assumptions sheet",      desc: "Solver settings, mesh stats, environment, confidence notes.", format: "PDF" },
  { kind: "image_pack",        icon: ImageIcon,       title: "Image pack",             desc: "Pressure, streamline, wake renders.",                        format: "PDF" },
  { kind: "stl_pack",          icon: Box,             title: "STL geometry pack",      desc: "Generated add-on parts as STL files.",                       format: "PDF" },
];

const REPORT_SECTIONS = [
  { key: "vehicle",         label: "Vehicle details" },
  { key: "variant",         label: "Variant details" },
  { key: "objective",       label: "Objective" },
  { key: "assumptions",     label: "Simulation assumptions" },
  { key: "metrics",         label: "Key metrics" },
  { key: "visuals",         label: "Result visuals" },
  { key: "comparison",      label: "Comparison summary" },
  { key: "recommendations", label: "Recommendations" },
  { key: "confidence",      label: "Confidence notes" },
];

const Exports = () => (
  <WorkspaceShell>
    {(ctx) => <ExportsContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

function ExportsContent({ buildId }: { buildId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search] = useSearchParams();
  const variantId = search.get("v");

  const { data: exports = [], isLoading } = useExports(user?.id);
  const { data: variants = [] } = useVariants(buildId);
  const generate = useGenerateExport();

  const [selectedKind, setSelectedKind] = useState<ExportKind>("pdf_report");
  const [audience, setAudience] = useState<"internal" | "client" | "public">("client");
  const [sections, setSections] = useState<Set<string>>(new Set(REPORT_SECTIONS.map((s) => s.key)));
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(variantId ?? null);

  // Filter exports for this build
  const buildExports = useMemo(
    () => exports.filter((e) => e.build_id === buildId),
    [exports, buildId],
  );

  const toggleSection = (k: string) =>
    setSections((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const onGenerate = async () => {
    try {
      await generate.mutateAsync({
        build_id: buildId,
        variant_id: selectedVariantId,
        kind: selectedKind,
        sections: Array.from(sections),
        audience,
      });
      toast({ title: "Export generated", description: "Available below for download." });
    } catch (e: any) {
      toast({ title: "Couldn't generate export", description: e.message, variant: "destructive" });
    }
  };

  const onDownload = async (row: ExportRow) => {
    if (!row.file_path) return;
    try {
      const ext = row.file_path.split(".").pop() ?? "pdf";
      const filename = `${row.kind}_${row.id.slice(0, 8)}.${ext}`;
      await downloadExport(row.file_path, filename);
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading) return <div className="px-6 py-6"><LoadingState /></div>;

  return (
    <div className="px-6 py-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
            Step 06 · Deliverables
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Exports & Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Generate downloadable engineering reports and data sheets from the current build.
            Files are stored for 30 days with signed-URL access.
          </p>
        </div>
        <Button variant="hero" size="sm" disabled={generate.isPending} onClick={onGenerate}>
          {generate.isPending ? (
            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</>
          ) : (
            <><Download className="mr-2 h-3.5 w-3.5" /> Generate export</>
          )}
        </Button>
      </div>

      {/* Variant picker */}
      {variants.length > 0 && (
        <Card icon={ChevronRight} title="Variant" hint={selectedVariantId ? "scoped to one variant" : "build-level export"}>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedVariantId(null)}
              className={cn(
                "rounded-md border px-3 py-2 text-sm transition-colors",
                !selectedVariantId
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-surface-1 hover:border-primary/30",
              )}
            >
              Build (all variants)
            </button>
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVariantId(v.id)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm transition-colors",
                  selectedVariantId === v.id
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-surface-1 hover:border-primary/30",
                )}
              >
                {v.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Export type */}
      <Card icon={Download} title="Export type">
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
                  <div className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-md",
                    sel ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
                  )}>
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

      {/* Audience */}
      <Card icon={Users} title="Audience">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { id: "internal" as const, icon: Lock,  title: "Internal",    desc: "Full solver data + caveats" },
            { id: "client"   as const, icon: Users, title: "Client-ready", desc: "Branded layout + plain summary" },
            { id: "public"   as const, icon: Globe, title: "Public",      desc: "Hero visuals only, no params" },
          ].map((a) => {
            const sel = a.id === audience;
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                onClick={() => setAudience(a.id)}
                className={cn(
                  "rounded-md border p-3 text-left transition-all",
                  sel ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", sel ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-sm font-medium">{a.title}</span>
                  {sel && <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-primary" />}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{a.desc}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Sections */}
      {selectedKind === "pdf_report" && (
        <Card icon={ClipboardList} title="Report contents" hint={`${sections.size} of ${REPORT_SECTIONS.length}`}>
          <div className="grid gap-2 md:grid-cols-2">
            {REPORT_SECTIONS.map((s) => {
              const on = sections.has(s.key);
              return (
                <div
                  key={s.key}
                  className={cn(
                    "flex items-center justify-between rounded-md border p-3 transition-colors",
                    on ? "border-primary/25 bg-primary/5" : "border-border bg-surface-1",
                  )}
                >
                  <span className="text-sm font-medium">{s.label}</span>
                  <Switch checked={on} onCheckedChange={() => toggleSection(s.key)} className="data-[state=checked]:bg-primary" />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* History */}
      <Card icon={History} title="Export history" hint={`${buildExports.length} files`}>
        {buildExports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exports yet — generate one above.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            {buildExports.map((row) => {
              const opt = EXPORT_OPTIONS.find((o) => o.kind === row.kind);
              const Icon = opt?.icon ?? FileText;
              const expired = row.expires_at && new Date(row.expires_at) < new Date();
              const ready = row.status === "ready" && !expired;
              return (
                <div key={row.id}
                  className={cn(
                    "grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 border-b border-border/40 last:border-b-0 px-3 py-2.5 items-center transition-colors hover:bg-surface-1/40",
                    !ready && "opacity-70",
                  )}>
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md",
                    ready ? "bg-primary/10 text-primary" : "bg-surface-2 text-muted-foreground",
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{opt?.title ?? row.kind}</div>
                    <div className="text-mono text-[10px] text-muted-foreground">
                      {row.id.slice(0, 8)} · {row.audience}
                      {row.variant_id && variants.find((v) => v.id === row.variant_id) && (
                        <> · {variants.find((v) => v.id === row.variant_id)?.name}</>
                      )}
                    </div>
                  </div>
                  <div className="text-mono text-[11px] tabular-nums text-muted-foreground">
                    {row.file_size_bytes ? `${(row.file_size_bytes / 1024).toFixed(1)} KB` : "—"}
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
                      <StatusChip tone="destructive" size="sm">
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
  icon: typeof FileText; title: string; hint?: string; children: React.ReactNode;
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

export default Exports;
