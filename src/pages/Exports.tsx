import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { cn } from "@/lib/utils";
import {
  ChevronRight, FileText, Image as ImageIcon, FileSpreadsheet, Box, ClipboardList,
  Layers, Download, CheckCircle2, Clock, Eye, Sparkles, Mail, Link as LinkIcon,
  ShieldCheck, Hash, Gauge, Wind, Crown, Lightbulb, AlertCircle, Settings2,
  Lock, Globe, Users, Loader2, FileCheck2, History, ChevronDown, Printer,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────────── */
/*  Data                                                               */
/* ─────────────────────────────────────────────────────────────────── */

type ExportKey =
  | "pdf" | "images" | "comparison" | "summary" | "stl" | "assumptions";

interface ExportOption {
  key: ExportKey;
  icon: typeof FileText;
  title: string;
  desc: string;
  format: string;
  size: string;
  pages?: string;
  highlight?: boolean;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    key: "pdf", icon: FileText, title: "PDF engineering report", highlight: true,
    desc: "Full client-ready report with charts, visuals and recommendations.",
    format: "PDF · A4", size: "~ 4.2 MB", pages: "18 pp",
  },
  {
    key: "images", icon: ImageIcon, title: "Image pack",
    desc: "Pressure, streamline, wake and force-vector renders at 4K.",
    format: "PNG · 3840×2160", size: "~ 11 MB", pages: "12 frames",
  },
  {
    key: "comparison", icon: FileSpreadsheet, title: "Variant comparison sheet",
    desc: "Side-by-side metrics for baseline, current and optimized variants.",
    format: "XLSX + CSV", size: "~ 96 KB",
  },
  {
    key: "summary", icon: ClipboardList, title: "Aero package summary",
    desc: "One-page spec card of the selected variant — parts, params, scores.",
    format: "PDF · A4", size: "~ 1.1 MB", pages: "1 pp",
  },
  {
    key: "stl", icon: Box, title: "STL geometry pack",
    desc: "Generated add-on parts (splitter, wing, diffuser, canards) as STL.",
    format: "STL · ZIP", size: "~ 14.8 MB", pages: "6 parts",
  },
  {
    key: "assumptions", icon: Layers, title: "Build assumptions sheet",
    desc: "Solver settings, mesh stats, environment and confidence notes.",
    format: "PDF · A4", size: "~ 380 KB", pages: "3 pp",
  },
];

interface HistoryItem {
  id: string;
  name: string;
  type: ExportKey;
  variant: string;
  size: string;
  when: string;
  by: string;
  status: "ready" | "processing" | "expired";
}

const HISTORY: HistoryItem[] = [
  { id: "EXP-2186", name: "GR86_TrackBuild_Optimized_v3.pdf",     type: "pdf",         variant: "Optimized v3", size: "4.2 MB",  when: "2 min ago",  by: "You",         status: "ready" },
  { id: "EXP-2185", name: "GR86_Comparison_Baseline_vs_v3.xlsx",   type: "comparison",  variant: "3 variants",   size: "96 KB",   when: "12 min ago", by: "You",         status: "ready" },
  { id: "EXP-2184", name: "image_pack_v3_streamlines.zip",         type: "images",      variant: "Optimized v3", size: "11.4 MB", when: "today 09:42", by: "M. Aldous",   status: "ready" },
  { id: "EXP-2183", name: "aero_pack_v3_stl_parts.zip",            type: "stl",         variant: "Optimized v3", size: "14.8 MB", when: "today 09:38", by: "M. Aldous",   status: "ready" },
  { id: "EXP-2179", name: "GR86_AssumptionsSheet_v2.pdf",          type: "assumptions", variant: "Current v2",   size: "380 KB",  when: "yesterday",   by: "You",         status: "ready" },
  { id: "EXP-2168", name: "GR86_PreviewReport.pdf",                type: "pdf",         variant: "Current v1",   size: "2.1 MB",  when: "Mar 14",      by: "L. Patel",    status: "expired" },
];

/* ─────────────────────────────────────────────────────────────────── */
/*  Card shell                                                         */
/* ─────────────────────────────────────────────────────────────────── */
function Card({ icon: Icon, title, hint, action, children }: {
  icon: typeof FileText; title: string; hint?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold tracking-tight truncate">{title}</h3>
          {hint && <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground truncate">{hint}</span>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Export options grid                                                */
/* ─────────────────────────────────────────────────────────────────── */
function ExportOptions({ selected, toggle }: {
  selected: Set<ExportKey>; toggle: (k: ExportKey) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {EXPORT_OPTIONS.map((opt) => {
        const isSel = selected.has(opt.key);
        const Icon = opt.icon;
        return (
          <button
            key={opt.key}
            onClick={() => toggle(opt.key)}
            className={cn(
              "rounded-md border p-4 text-left transition-all relative group",
              isSel
                ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                : "border-border bg-surface-1 hover:border-primary/30",
            )}
          >
            {opt.highlight && (
              <span className="absolute -top-2 left-4 text-mono text-[9px] uppercase tracking-widest rounded border border-primary/40 bg-background px-1.5 py-0.5 text-primary">
                Recommended
              </span>
            )}
            <div className="flex items-start justify-between gap-2">
              <div className={cn(
                "flex h-9 w-9 items-center justify-center rounded-md shrink-0",
                isSel ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
              )}>
                <Icon className="h-4 w-4" />
              </div>
              <span className={cn(
                "h-4 w-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors",
                isSel ? "border-primary bg-primary" : "border-border",
              )}>
                {isSel && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
              </span>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold leading-tight">{opt.title}</div>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{opt.desc}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className="text-foreground/80">{opt.format}</span>
              <span className="text-border">·</span>
              <span>{opt.size}</span>
              {opt.pages && (<><span className="text-border">·</span><span>{opt.pages}</span></>)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Report content checklist                                           */
/* ─────────────────────────────────────────────────────────────────── */
type ReportSectionKey =
  | "vehicle" | "variant" | "objective" | "assumptions"
  | "metrics" | "visuals" | "comparison" | "recommendations" | "confidence";

const REPORT_SECTIONS: { key: ReportSectionKey; title: string; icon: typeof Hash; sub: string; required?: boolean }[] = [
  { key: "vehicle",         title: "Vehicle details",        icon: Gauge,        sub: "Make, model, dimensions, photos" , required: true },
  { key: "variant",         title: "Variant details",        icon: Crown,        sub: "Selected aero package & parameters", required: true },
  { key: "objective",       title: "Objective",              icon: Sparkles,     sub: "Optimization goal & weights" },
  { key: "assumptions",     title: "Simulation assumptions", icon: Settings2,    sub: "Solver, mesh, environment, yaw sweep" },
  { key: "metrics",         title: "Key metrics",            icon: Hash,         sub: "Cd, DF, L/D, balance, top speed", required: true },
  { key: "visuals",         title: "Result visuals",         icon: ImageIcon,    sub: "Streamlines, pressure, wake, forces" },
  { key: "comparison",      title: "Comparison summary",     icon: FileSpreadsheet, sub: "Baseline vs current vs optimized" },
  { key: "recommendations", title: "Recommendations",        icon: Lightbulb,    sub: "Next steps & manufacturing notes" },
  { key: "confidence",      title: "Confidence notes",       icon: ShieldCheck,  sub: "Solver fidelity, caveats, validation" },
];

function ReportContents({ selected, toggle }: {
  selected: Set<ReportSectionKey>; toggle: (k: ReportSectionKey) => void;
}) {
  return (
    <Card icon={ClipboardList} title="Report contents" hint={`${selected.size} of ${REPORT_SECTIONS.length} included`}>
      <div className="grid gap-2 md:grid-cols-2">
        {REPORT_SECTIONS.map((sec) => {
          const isOn = selected.has(sec.key);
          const Icon = sec.icon;
          return (
            <div
              key={sec.key}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3 transition-colors",
                isOn ? "border-primary/25 bg-primary/5" : "border-border bg-surface-1",
                sec.required && !isOn && "border-warning/30",
              )}
            >
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md shrink-0",
                isOn ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
              )}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate">{sec.title}</span>
                  {sec.required && (
                    <span className="text-mono text-[9px] uppercase tracking-widest text-warning">Required</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug truncate">{sec.sub}</p>
              </div>
              <Switch
                checked={isOn}
                onCheckedChange={() => !sec.required && toggle(sec.key)}
                disabled={sec.required}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Report preview (mock document)                                     */
/* ─────────────────────────────────────────────────────────────────── */
function ReportPreview({ included }: { included: Set<ReportSectionKey> }) {
  const [page, setPage] = useState(1);
  const totalPages = 18;

  return (
    <Card
      icon={Eye}
      title="Report preview"
      hint={`Page ${page} of ${totalPages}`}
      action={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPage(Math.max(1, page - 1))}>
            <ChevronRight className="h-3 w-3 rotate-180" />
          </Button>
          <span className="text-mono text-[11px] tabular-nums w-10 text-center">{page} / {totalPages}</span>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setPage(Math.min(totalPages, page + 1))}>
            <ChevronRight className="h-3 w-3" />
          </Button>
          <div className="h-4 w-px bg-border mx-1" />
          <Button variant="ghost" size="sm" className="h-7">
            <Printer className="mr-1.5 h-3 w-3" /> Print
          </Button>
        </div>
      }
    >
      {/* A4-ish paper */}
      <div className="rounded-md bg-surface-2/30 p-6 lg:p-8">
        <div className="mx-auto bg-[hsl(0_0%_98%)] text-[hsl(220_15%_15%)] shadow-xl ring-1 ring-black/10 rounded-sm overflow-hidden"
             style={{ aspectRatio: "1 / 1.414", maxWidth: 560 }}>
          {/* Header band */}
          <div className="bg-gradient-to-r from-[hsl(220_24%_11%)] to-[hsl(220_24%_15%)] text-[hsl(0_0%_98%)] px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-sm bg-[hsl(188_95%_55%)] flex items-center justify-center">
                <Wind className="h-3.5 w-3.5 text-[hsl(220_24%_11%)]" />
              </div>
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[hsl(188_95%_75%)]">AeroLab</div>
                <div className="text-[11px] font-semibold">Engineering Report</div>
              </div>
            </div>
            <div className="text-right text-[9px] uppercase tracking-widest text-[hsl(0_0%_75%)]">
              <div>EXP-2186 · v3</div>
              <div>18 Apr 2026</div>
            </div>
          </div>

          {/* Page content */}
          <div className="p-6 space-y-3">
            <div>
              <div className="text-[8px] uppercase tracking-[0.25em] text-[hsl(188_70%_35%)]">Project · Toyota GR86 Track Build</div>
              <h2 className="mt-1 text-[18px] font-semibold leading-tight tracking-tight">
                Aerodynamic Performance Report
              </h2>
              <p className="mt-0.5 text-[10px] text-[hsl(220_10%_40%)]">
                Optimized aero package · Variant v3 (C-04A) · prepared for Internal Engineering
              </p>
            </div>

            {/* Section list mirrors selection */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {REPORT_SECTIONS.filter(s => included.has(s.key)).map((s, i) => (
                <div key={s.key} className="flex items-center gap-1.5 text-[9px]">
                  <span className="text-[hsl(188_70%_35%)] font-mono w-3.5">{(i + 1).toString().padStart(2, "0")}</span>
                  <span className="truncate text-[hsl(220_15%_25%)]">{s.title}</span>
                  <span className="ml-auto h-px flex-1 bg-[hsl(220_10%_85%)]" />
                  <span className="text-[hsl(220_10%_55%)] font-mono">{(i * 2 + 3).toString().padStart(2, "0")}</span>
                </div>
              ))}
            </div>

            {/* Mini hero visual */}
            <div className="relative mt-2 rounded border border-[hsl(220_10%_85%)] bg-[hsl(220_15%_96%)] overflow-hidden" style={{ aspectRatio: "16 / 7" }}>
              <svg viewBox="0 0 320 140" className="absolute inset-0 h-full w-full">
                <defs>
                  <linearGradient id="cp" x1="0" x2="1">
                    <stop offset="0%" stopColor="hsl(220 80% 45%)" />
                    <stop offset="50%" stopColor="hsl(50 90% 55%)" />
                    <stop offset="100%" stopColor="hsl(0 80% 50%)" />
                  </linearGradient>
                </defs>
                <path d="M60,108 L88,86 L150,72 L210,75 L250,92 L280,108 L60,108 Z" fill="url(#cp)" stroke="hsl(220 30% 25%)" strokeWidth="0.6" opacity="0.85" />
                {Array.from({ length: 5 }).map((_, k) => (
                  <path key={k} d={`M10,${40 + k * 14} Q160,${36 + k * 14} 310,${40 + k * 14}`}
                    stroke="hsl(220 50% 35%)" strokeWidth="0.4" fill="none" opacity={0.5 - k * 0.07} />
                ))}
              </svg>
              <div className="absolute bottom-1 left-2 text-[8px] uppercase tracking-widest text-[hsl(220_15%_30%)]">
                Fig 01 · Cp distribution · 180 km/h
              </div>
            </div>

            {/* Mini metric strip */}
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { l: "Cd",  v: "0.328", d: "−10.4%" },
                { l: "L/D", v: "2.93",  d: "+0.18" },
                { l: "DF",  v: "+316",  d: "+44 kgf" },
                { l: "Bal", v: "43.7%", d: "F-bias" },
              ].map((m) => (
                <div key={m.l} className="rounded border border-[hsl(220_10%_85%)] bg-white px-2 py-1.5">
                  <div className="text-[8px] uppercase tracking-widest text-[hsl(220_10%_50%)]">{m.l}</div>
                  <div className="text-[12px] font-semibold tabular-nums leading-tight">{m.v}</div>
                  <div className="text-[8px] tabular-nums text-[hsl(140_50%_35%)]">{m.d}</div>
                </div>
              ))}
            </div>

            <p className="text-[9px] leading-relaxed text-[hsl(220_15%_30%)]">
              The selected variant achieves a 10.4% reduction in drag coefficient and a 44 kgf increase in
              total downforce versus the OEM baseline. Aero balance shifts 1.8 pp rearward, within the
              43 ± 2 pp window. All hard constraints satisfied. Solver-validated with k-ω SST steady-state.
            </p>
          </div>

          {/* Footer */}
          <div className="absolute" />
          <div className="border-t border-[hsl(220_10%_88%)] px-6 py-2 flex items-center justify-between text-[8px] uppercase tracking-widest text-[hsl(220_10%_50%)]">
            <span>AeroLab · Confidential · Internal use</span>
            <span>{page} / {totalPages}</span>
          </div>
        </div>

        {/* Caption */}
        <div className="mt-4 flex items-center justify-center gap-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <FileCheck2 className="h-3 w-3 text-primary" />
          Live preview · reflects selected sections
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Run summary panel (right rail)                                     */
/* ─────────────────────────────────────────────────────────────────── */
function RunSummary() {
  return (
    <Card icon={Crown} title="Selected variant" hint="Optimized v3 · C-04A">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ConfidenceBadge level="high" compact />
          <StatusChip tone="success" size="sm">Solver-validated</StatusChip>
        </div>

        <div className="rounded-md border border-border bg-surface-1/40 p-3 space-y-2">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Vehicle</div>
          <div className="text-sm font-medium leading-tight">Toyota GR86 · 2024 · Track Build</div>
          <div className="text-mono text-[11px] text-muted-foreground">4.265 × 1.775 × 1.310 m · 1,275 kg</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { l: "Cd",  v: "0.328" },
            { l: "L/D", v: "2.93"  },
            { l: "DF",  v: "+316 kgf" },
            { l: "Bal", v: "43.7% F" },
          ].map((m) => (
            <div key={m.l} className="rounded-md border border-border bg-surface-1/40 px-3 py-2">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{m.l}</div>
              <div className="text-mono text-base font-semibold tabular-nums">{m.v}</div>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-border bg-surface-1/40 p-3 space-y-1.5">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Objective</div>
          <div className="text-sm">Track use · score 94/100</div>
          <div className="text-mono text-[10px] text-muted-foreground leading-relaxed">
            Adjoint-derived · k-ω SST steady · 248 candidates evaluated
          </div>
        </div>

        <div className="rounded-md border border-warning/25 bg-warning/5 p-3 flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p className="text-[11px] text-foreground/85 leading-relaxed">
            Wheel rotation modelled as MRF (simplified). Real degradation may be 3–5% higher on rear DF.
            Disclosed in confidence notes.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  History                                                            */
/* ─────────────────────────────────────────────────────────────────── */
function HistoryPanel() {
  const iconFor = (t: ExportKey) => EXPORT_OPTIONS.find((o) => o.key === t)?.icon ?? FileText;
  return (
    <Card icon={History} title="Export history" hint={`${HISTORY.length} files · last 30 days`}
      action={
        <Button variant="ghost" size="sm" className="h-7 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          View all <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      }>
      <div className="rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 border-b border-border bg-surface-1/40 px-3 py-2 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="w-7" />
          <span>File</span>
          <span className="hidden md:inline">Variant</span>
          <span>Size</span>
          <span>When</span>
          <span className="w-16 text-right">Actions</span>
        </div>
        {HISTORY.map((h) => {
          const Icon = iconFor(h.type);
          const expired = h.status === "expired";
          return (
            <div key={h.id}
              className={cn(
                "grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 border-b border-border/40 last:border-b-0 px-3 py-2.5 items-center transition-colors hover:bg-surface-1/40",
                expired && "opacity-60",
              )}>
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md",
                expired ? "bg-surface-2 text-muted-foreground" : "bg-primary/10 text-primary",
              )}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{h.name}</div>
                <div className="text-mono text-[10px] text-muted-foreground">
                  {h.id} · by {h.by}
                </div>
              </div>
              <div className="hidden md:block text-mono text-[11px] text-muted-foreground tabular-nums">{h.variant}</div>
              <div className="text-mono text-[11px] tabular-nums">{h.size}</div>
              <div className="flex items-center gap-1 text-mono text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" /> {h.when}
              </div>
              <div className="flex items-center justify-end gap-1">
                {expired ? (
                  <StatusChip tone="warning" size="sm">Expired</StatusChip>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Preview">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Copy link">
                      <LinkIcon className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Download">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/*  Page                                                               */
/* ─────────────────────────────────────────────────────────────────── */
const Exports = () => {
  const [selected, setSelected] = useState<Set<ExportKey>>(new Set(["pdf", "comparison", "summary"]));
  const [sections, setSections] = useState<Set<ReportSectionKey>>(
    new Set(REPORT_SECTIONS.map((s) => s.key)),
  );
  const [audience, setAudience] = useState<"internal" | "client" | "public">("client");
  const [busy, setBusy] = useState(false);

  const toggle = (k: ExportKey) => {
    const s = new Set(selected);
    s.has(k) ? s.delete(k) : s.add(k);
    setSelected(s);
  };
  const toggleSection = (k: ReportSectionKey) => {
    const s = new Set(sections);
    s.has(k) ? s.delete(k) : s.add(k);
    setSections(s);
  };

  const totalSize = useMemo(() => {
    const sizes: Record<ExportKey, number> = {
      pdf: 4.2, images: 11, comparison: 0.096, summary: 1.1, stl: 14.8, assumptions: 0.38,
    };
    let n = 0;
    selected.forEach((k) => (n += sizes[k]));
    return n;
  }, [selected]);

  const handleExport = () => {
    setBusy(true);
    setTimeout(() => setBusy(false), 1800);
  };

  return (
    <AppLayout>
      {/* Sticky header */}
      <div className="sticky top-14 z-20 border-b border-border bg-surface-0/80 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-6 py-3">
          <nav className="flex items-center gap-1.5 text-mono text-[11px] uppercase tracking-widest">
            <Link to="/garage" className="text-muted-foreground hover:text-foreground transition-colors">Garage</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <Link to="/build" className="text-muted-foreground hover:text-foreground transition-colors">GR86 Track Build</Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-foreground">Exports & Reports</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <StatusChip tone="solver" size="sm">
              <FileCheck2 className="mr-1 h-3 w-3" /> Variant v3 ready
            </StatusChip>
            <div className="h-5 w-px bg-border mx-1" />
            <Button variant="glass" size="sm">
              <Mail className="mr-2 h-3.5 w-3.5" /> Email package
            </Button>
            <Button variant="hero" size="sm" onClick={handleExport} disabled={busy || selected.size === 0}>
              {busy ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</>
              ) : (
                <><Download className="mr-2 h-3.5 w-3.5" /> Generate {selected.size} export{selected.size === 1 ? "" : "s"}</>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-mono text-[11px] uppercase tracking-[0.2em] text-primary/80">
              Step 06 · Deliverables
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Exports & Reports</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Package the selected variant as a client-presentable engineering report, raw datasets and STL geometry.
              Every export is reproducible and links back to its source simulation run.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-border bg-surface-1/60 px-3 py-1.5">
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Total size</div>
              <div className="text-mono text-sm font-semibold tabular-nums">
                {totalSize.toFixed(1)} <span className="text-[10px] text-muted-foreground">MB</span>
              </div>
            </div>
          </div>
        </div>

        {/* Export options */}
        <Card icon={Download} title="Export options" hint={`${selected.size} of ${EXPORT_OPTIONS.length} selected`}
          action={
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                onClick={() => setSelected(new Set(EXPORT_OPTIONS.map((o) => o.key)))}>
                All
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                onClick={() => setSelected(new Set())}>
                None
              </Button>
            </div>
          }>
          <ExportOptions selected={selected} toggle={toggle} />

          {/* Audience / privacy strip */}
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              { id: "internal" as const, icon: Lock,  title: "Internal",       desc: "Full solver data, all caveats, raw runs" },
              { id: "client"   as const, icon: Users, title: "Client-ready",   desc: "Branded layout, plain-language summary" },
              { id: "public"   as const, icon: Globe, title: "Public / press", desc: "Hero visuals only, no proprietary params" },
            ].map((a) => {
              const sel = a.id === audience;
              const Icon = a.icon;
              return (
                <button key={a.id} onClick={() => setAudience(a.id)}
                  className={cn(
                    "rounded-md border p-3 text-left transition-all",
                    sel ? "border-primary/40 bg-primary/10 ring-1 ring-primary/30" : "border-border bg-surface-1 hover:border-primary/30",
                  )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", sel ? "text-primary" : "text-muted-foreground")} />
                      <span className="text-sm font-medium">{a.title}</span>
                    </div>
                    {sel && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{a.desc}</p>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Two-column: report contents + run summary */}
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <ReportContents selected={sections} toggle={toggleSection} />
          </div>
          <div className="xl:col-span-1">
            <RunSummary />
          </div>
        </div>

        {/* Preview */}
        <ReportPreview included={sections} />

        {/* History */}
        <HistoryPanel />

        {/* Bottom action bar */}
        <div className="glass-strong rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-primary shadow-glow">
              <FileText className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-medium">
                {selected.size} export{selected.size === 1 ? "" : "s"} · {totalSize.toFixed(1)} MB · {audience === "client" ? "Client-ready layout" : audience === "internal" ? "Internal layout" : "Public layout"}
              </div>
              <div className="text-mono text-[11px] text-muted-foreground">
                Generated package will appear in history with a 30-day shareable link
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="glass" size="sm">
              <LinkIcon className="mr-2 h-3.5 w-3.5" /> Copy share link
            </Button>
            <Button variant="glass" size="sm" asChild>
              <Link to="/results"><Eye className="mr-2 h-3.5 w-3.5" /> Back to results</Link>
            </Button>
            <Button variant="hero" size="sm" onClick={handleExport} disabled={busy || selected.size === 0}>
              {busy ? (
                <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Generating…</>
              ) : (
                <><Download className="mr-2 h-3.5 w-3.5" /> Generate package</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Exports;
