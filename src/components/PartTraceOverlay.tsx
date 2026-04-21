/**
 * PartTraceOverlay
 *
 * Manual-trace alternative to PartHotspotOverlay. The user picks a part type
 * first (front arch, side skirt, splitter…), then drags a bounding box on
 * the concept render. We convert that box into params for the parametric
 * geometry builder and persist it as a `fitted_parts` row — no AI mesh
 * inference, no part-label guessing.
 *
 * Why this exists: image-to-3D meshers struggle with overlapping body kit
 * pieces and often misidentify arches as skirts (and vice versa). A user
 * tracing the part is faster, deterministic, and produces clean STL/OBJ
 * directly from `part-geometry.ts`.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2, Pencil, Check, Undo2, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useUpsertFittedPart, useActiveConceptSet, useFittedParts } from "@/lib/repo";

export type TracePartKind =
  | "wide_arch" | "front_arch" | "rear_arch"
  | "side_skirt" | "splitter" | "lip" | "canard"
  | "diffuser" | "ducktail" | "wing"
  | "bonnet_vent" | "wing_vent";

interface PartOption {
  kind: TracePartKind;
  label: string;
  /** What the user is being asked to draw. */
  hint: string;
  /** Convert a normalised box to fitted-part params. Box dims are 0..1
   *  fractions of the rendered image. */
  paramsFromBox: (box: Box, viewKey: ViewKey) => Record<string, number>;
}

interface Box { x: number; y: number; w: number; h: number }
type ViewKey = "front" | "side" | "rear34" | "rear";

/** Map of trace inputs → fitted-part params.
 *  We keep this deliberately conservative — the user will refine on the
 *  Refine page with sliders. The point of the trace is to seed sensible
 *  defaults, not to produce a finished mesh. */
const PART_OPTIONS: PartOption[] = [
  {
    kind: "front_arch", label: "Front arch",
    hint: "Drag a box around one front wheel arch.",
    paramsFromBox: (b) => ({
      flare: Math.round(40 + b.w * 80),                // 40–120 mm
      arch_radius: Math.round(280 + b.h * 240),        // 280–520 mm
      arch_thickness: Math.round(60 + b.w * 70),       // 60–130 mm
    }),
  },
  {
    kind: "rear_arch", label: "Rear arch",
    hint: "Drag a box around one rear wheel arch.",
    paramsFromBox: (b) => ({
      flare: Math.round(50 + b.w * 90),
      arch_radius: Math.round(300 + b.h * 250),
      arch_thickness: Math.round(70 + b.w * 70),
    }),
  },
  {
    kind: "wide_arch", label: "All four arches",
    hint: "Drag a box on one arch — we'll fit all four.",
    paramsFromBox: (b) => ({
      flare: Math.round(40 + b.w * 80),
      arch_radius: Math.round(300 + b.h * 240),
      arch_thickness: Math.round(60 + b.w * 70),
    }),
  },
  {
    kind: "side_skirt", label: "Side skirt",
    hint: "Drag a long thin box along the door sill.",
    paramsFromBox: (b) => ({
      depth: Math.round(40 + b.h * 110),               // 40–150 mm tall
      drop: Math.round(15 + b.h * 40),                 // 15–55 mm extra drop
      length_pct: Math.round(40 + b.w * 50),           // 40–90 % of car length
    }),
  },
  {
    kind: "splitter", label: "Front splitter",
    hint: "Drag a box across the front lip / splitter.",
    paramsFromBox: (b) => ({
      depth: Math.round(40 + b.h * 160),               // 40–200 mm projection
      width_pct: Math.round(80 + b.w * 20),            // 80–100 % of car width
      fence_height: 30,
      fence_inset: 60,
    }),
  },
  {
    kind: "lip", label: "Lip extension",
    hint: "Drag a thin box where the lip should sit.",
    paramsFromBox: (b) => ({
      depth: Math.round(15 + b.h * 60),
      width_pct: Math.round(80 + b.w * 18),
    }),
  },
  {
    kind: "canard", label: "Canards",
    hint: "Drag a box around one canard fin.",
    paramsFromBox: (b) => ({
      span: Math.round(120 + b.w * 200),
      angle: Math.round(8 + b.h * 18),
      count: 1,
    }),
  },
  {
    kind: "diffuser", label: "Diffuser",
    hint: "Drag a box across the rear undertray.",
    paramsFromBox: (b) => ({
      length: Math.round(400 + b.h * 400),
      width_pct: Math.round(75 + b.w * 20),
      angle: Math.round(8 + b.h * 14),
      strake_count: Math.max(3, Math.min(7, Math.round(3 + b.w * 5))),
      strake_height: Math.round(40 + b.h * 60),
    }),
  },
  {
    kind: "ducktail", label: "Ducktail",
    hint: "Drag a thin horizontal box across the rear deck.",
    paramsFromBox: (b) => ({
      height: Math.round(20 + b.h * 90),
      kick: Math.round(5 + b.h * 18),
      width: Math.round(900 + b.w * 400),
      chord: Math.round(160 + b.h * 200),
    }),
  },
  {
    kind: "wing", label: "Rear wing",
    hint: "Drag a box around the wing blade.",
    paramsFromBox: (b) => ({
      chord: Math.round(200 + b.h * 250),
      aoa: Math.round(4 + b.h * 14),
      span_pct: Math.round(60 + b.w * 35),
      stand_height: Math.round(150 + b.h * 200),
      gurney: 12,
    }),
  },
  {
    kind: "bonnet_vent", label: "Bonnet vent",
    hint: "Drag a box around one vent opening.",
    paramsFromBox: (b) => ({
      length: Math.round(150 + b.w * 200),
      width: Math.round(80 + b.h * 120),
      depth: 18,
      louvre_count: Math.max(3, Math.min(8, Math.round(3 + b.w * 5))),
    }),
  },
  {
    kind: "wing_vent", label: "Wing/fender vent",
    hint: "Drag a box around the side vent.",
    paramsFromBox: (b) => ({
      length: Math.round(120 + b.w * 180),
      width: Math.round(60 + b.h * 100),
      depth: 16,
      louvre_count: Math.max(3, Math.min(7, Math.round(3 + b.w * 4))),
    }),
  },
];

interface Props {
  active: boolean;
  view: ViewKey;
  projectId: string;
}

const MIN_SIZE = 0.04;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function PartTraceOverlay({ active, view, projectId }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: conceptSet } = useActiveConceptSet(projectId);
  const { data: existingParts = [] } = useFittedParts(conceptSet?.id);
  const upsert = useUpsertFittedPart();

  const [selectedKind, setSelectedKind] = useState<TracePartKind>("front_arch");
  const [box, setBox] = useState<Box | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);

  const opt = PART_OPTIONS.find((o) => o.kind === selectedKind)!;

  // Reset trace when view changes / mode toggles off.
  useEffect(() => { setBox(null); }, [view, active]);

  const beginDraw = (e: React.PointerEvent) => {
    if (!containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    startRef.current = { x, y, rect };
    setBox({ x, y, w: 0, h: 0 });
    setDrawing(true);
  };

  const onMove = useCallback((e: PointerEvent) => {
    const s = startRef.current;
    if (!s || !drawing) return;
    const cx = clamp((e.clientX - s.rect.left) / s.rect.width, 0, 1);
    const cy = clamp((e.clientY - s.rect.top) / s.rect.height, 0, 1);
    const x = Math.min(s.x, cx);
    const y = Math.min(s.y, cy);
    const w = Math.abs(cx - s.x);
    const h = Math.abs(cy - s.y);
    setBox({ x, y, w, h });
  }, [drawing]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    startRef.current = null;
  }, []);

  useEffect(() => {
    if (!drawing) return;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDraw);
    window.addEventListener("pointercancel", endDraw);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDraw);
      window.removeEventListener("pointercancel", endDraw);
    };
  }, [drawing, onMove, endDraw]);

  const onSave = async () => {
    if (!box || box.w < MIN_SIZE || box.h < MIN_SIZE) {
      toast({ title: "Trace too small", description: "Draw a larger box around the part.", variant: "destructive" });
      return;
    }
    if (!user) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    if (!conceptSet) {
      toast({ title: "No concept set yet", description: "Generate concepts before tracing parts.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const params = opt.paramsFromBox(box, view);
      // If a fitted part of this kind already exists, update it; otherwise insert.
      const existing = existingParts.find((p) => p.kind === opt.kind);
      await upsert.mutateAsync({
        userId: user.id,
        conceptSetId: conceptSet.id,
        id: existing?.id,
        kind: opt.kind,
        params: { ...((existing?.params as object) ?? {}), ...params, traced_view: view },
        enabled: true,
      });
      toast({
        title: `${opt.label} saved`,
        description: existing ? "Updated existing part — refine on the Refine page." : "Added to your kit. Refine sliders next.",
      });
      setBox(null);
    } catch (e: any) {
      toast({ title: "Couldn't save trace", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!active) return null;

  return (
    <div ref={containerRef} className="absolute inset-0 z-20">
      {/* Subtle dim so trace lines pop */}
      <div className="absolute inset-0 bg-background/25 pointer-events-none" />

      {/* Part type picker — saved kinds get a green tick */}
      <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1 pointer-events-auto z-30">
        {PART_OPTIONS.map((o) => {
          const isSaved = existingParts.some((p) => p.kind === o.kind && p.enabled);
          const isSelected = selectedKind === o.kind;
          return (
            <button
              key={o.kind}
              type="button"
              onClick={(e) => { e.stopPropagation(); setSelectedKind(o.kind); setBox(null); }}
              className={cn(
                "rounded-md px-2 py-1 border text-mono text-[10px] uppercase tracking-widest backdrop-blur transition-colors inline-flex items-center gap-1",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : isSaved
                    ? "bg-success/15 text-success border-success/40 hover:bg-success/25"
                    : "bg-surface-0/85 text-muted-foreground border-border hover:text-foreground",
              )}
            >
              {isSaved && !isSelected && <CheckCircle2 className="h-2.5 w-2.5" />}
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Hint banner */}
      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 rounded-md bg-surface-0/90 backdrop-blur px-3 py-1.5 border border-border text-mono text-[10px] uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5 pointer-events-none">
        <Pencil className="h-3 w-3 text-primary" />
        {opt.hint}
      </div>

      {/* Saved kit summary — bottom-right, always visible when parts exist */}
      {existingParts.filter((p) => p.enabled).length > 0 && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md bg-surface-0/95 backdrop-blur px-2 py-1.5 border border-border shadow-md z-30 pointer-events-auto">
          <CheckCircle2 className="h-3 w-3 text-success" />
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {existingParts.filter((p) => p.enabled).length} part{existingParts.filter((p) => p.enabled).length === 1 ? "" : "s"} in kit
          </span>
          <Link
            to={`/parts?project=${projectId}`}
            onClick={(e) => e.stopPropagation()}
            className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-mono uppercase tracking-widest text-primary hover:bg-primary/10"
          >
            View 3D <ArrowRight className="h-2.5 w-2.5" />
          </Link>
        </div>
      )}

      {/* Drawing surface */}
      <div
        onPointerDown={beginDraw}
        className={cn(
          "absolute inset-0 cursor-crosshair",
          // Reserve room at the top for the part picker chips.
          "mt-12",
        )}
      />

      {/* The box itself */}
      {box && (
        <div
          style={{
            left:   `${box.x * 100}%`,
            top:    `${box.y * 100}%`,
            width:  `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
          className="absolute border-2 border-primary bg-primary/15 rounded-md pointer-events-none"
        >
          <span className="absolute -top-6 left-0 rounded bg-primary text-primary-foreground text-[10px] text-mono uppercase tracking-widest px-1.5 py-0.5 whitespace-nowrap">
            {opt.label}
          </span>
        </div>
      )}

      {/* Save / clear toolbar */}
      {box && !drawing && box.w >= MIN_SIZE && box.h >= MIN_SIZE && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-md bg-surface-0/95 backdrop-blur px-2 py-1.5 border border-border shadow-md z-30">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void onSave(); }}
            disabled={saving}
            className="rounded px-2.5 py-1 inline-flex items-center gap-1 text-[10px] text-mono uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save {opt.label}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setBox(null); }}
            className="rounded px-2 py-1 inline-flex items-center gap-1 text-[10px] text-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <Undo2 className="h-3 w-3" /> Redraw
          </button>
        </div>
      )}
    </div>
  );
}
