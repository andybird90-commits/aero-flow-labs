/**
 * PartHotspotOverlay
 *
 * Sits on top of a concept render image. When "pick mode" is active, asks the
 * `detect-concept-hotspots` edge function for AI-detected bounding boxes of
 * the body kit parts visible in the *current view*, then renders those boxes
 * as clickable zones. Results are cached per (concept, view) on the concepts
 * row so subsequent opens are instant.
 *
 * Boxes are interactive: click to extract immediately, OR grab the body to
 * move and the corner/edge handles to resize for a tighter crop before
 * extracting via the "Use this crop" confirm button.
 */
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Loader2, Wand2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExtractedPartPreview } from "@/components/ExtractedPartPreview";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type ViewKey = "front" | "side" | "rear34" | "rear";
type PartKind =
  // Bolt-on parts (default)
  | "splitter" | "lip" | "canard" | "side_skirt"
  | "wide_arch" | "diffuser" | "ducktail" | "wing"
  | "bonnet_vent" | "wing_vent"
  // Body-swap panels (only used when bodySwapMode is on)
  | "front_clip" | "hood_panel" | "fender_panel" | "door_skin"
  | "side_skirt_panel" | "rear_quarter" | "rear_clip" | "deck_panel";

interface Box {
  kind: PartKind;
  label: string;
  x: number; y: number; w: number; h: number;
}

interface Props {
  active: boolean;
  view: ViewKey;
  projectId: string;
  conceptId: string;
  conceptTitle: string;
  /** URL of the currently displayed concept render. Powers the optional
   *  pre-render lasso trim inside the part preview modal. */
  sourceImageUrl?: string;
  /** When true, the AI will segment the swap shell into body panels
   *  (front clip, hood, fenders, doors, skirts, rear quarters, rear clip,
   *  deck, wing) instead of looking for bolt-on aero parts. */
  bodySwapMode?: boolean;
}

interface Preview {
  kind: PartKind;
  label: string;
  filenameBase: string;
  bbox: { x: number; y: number; w: number; h: number };
  /** The exact image the bbox was measured against — must match what the
   *  cropper sees, otherwise the crop lands on the wrong part. */
  sourceUrl: string;
}

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN_SIZE = 0.02; // 2% of image — prevents collapsing the box

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function PartHotspotOverlay({ active, view, projectId, conceptId, conceptTitle, sourceImageUrl, bodySwapMode }: Props) {
  const { toast } = useToast();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Index of the box the user is currently refining (drag interaction in
   *  progress or just finished). When set, that box renders confirm/reset
   *  controls instead of acting as a one-click extract target. */
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  // Per-(concept,view,mode) memo so re-toggling pick mode is instant after
  // first detect. Mode is part of the key so swap-panel boxes don't pollute
  // the bolt-on cache and vice-versa.
  const cacheRef = useRef<Map<string, Box[]>>(new Map());
  /** Original AI-detected boxes per cache key — used so users can reset their
   *  manual edits back to what the model proposed. */
  const originalRef = useRef<Map<string, Box[]>>(new Map());
  /** The exact image URL the AI analyzed when producing these boxes. We pin
   *  it so extraction crops from the same pixels — carbon-shell vs regular
   *  renders are independently generated and aren't pixel-aligned, so using
   *  the on-screen URL would cause boxes to land on the wrong part. */
  const analyzedUrlRef = useRef<Map<string, string>>(new Map());
  const modeKey = bodySwapMode ? "swap" : "bolton";
  const cacheKey = `${conceptId}:${view}:${modeKey}`;

  // Drag state lives in a ref so listeners don't cause rerenders mid-drag.
  const dragRef = useRef<{
    idx: number;
    handle: Handle;
    startX: number;
    startY: number;
    rect: DOMRect;
    startBox: Box;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (!active) return;

    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setBoxes(cached);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setBoxes(null);

    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("detect-concept-hotspots", {
          body: { concept_id: conceptId, view, body_swap_mode: !!bodySwapMode },
        });
        if (cancelled) return;
        if (fnErr) throw fnErr;
        if ((data as any)?.error) throw new Error((data as any).error);
        const got: Box[] = Array.isArray((data as any)?.boxes) ? (data as any).boxes : [];
        const analyzed = (data as any)?.analyzed_url as string | undefined;
        cacheRef.current.set(cacheKey, got);
        originalRef.current.set(cacheKey, got.map((b) => ({ ...b })));
        if (analyzed) analyzedUrlRef.current.set(cacheKey, analyzed);
        setBoxes(got);
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message ?? e);
        setError(msg);
        if (msg.includes("429")) {
          toast({ title: "Rate limit reached", description: "Try again in a moment.", variant: "destructive" });
        } else if (msg.includes("402")) {
          toast({ title: "AI credits exhausted", description: "Top up to keep using vision detection.", variant: "destructive" });
        } else {
          toast({ title: "Couldn't detect parts", description: msg, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [active, cacheKey, conceptId, view, bodySwapMode, toast]);

  // Reset editing state when the underlying view changes.
  useEffect(() => { setEditingIdx(null); }, [cacheKey]);

  const onPick = useCallback((zone: Box) => {
    const safeTitle = conceptTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "concept";
    const safeLabel = zone.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // Prefer the URL the AI actually analyzed; only fall back to the on-screen
    // image when we don't have one (older cached entries).
    const pinned = analyzedUrlRef.current.get(cacheKey) ?? sourceImageUrl ?? "";
    setPreview({
      kind: zone.kind,
      label: zone.label,
      filenameBase: `${safeTitle}__${safeLabel || zone.kind}`,
      bbox: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
      sourceUrl: pinned,
    });
  }, [conceptTitle, cacheKey, sourceImageUrl]);

  const updateBox = useCallback((idx: number, next: Box) => {
    setBoxes((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      copy[idx] = next;
      cacheRef.current.set(cacheKey, copy);
      return copy;
    });
  }, [cacheKey]);

  const resetBox = useCallback((idx: number) => {
    const orig = originalRef.current.get(cacheKey);
    if (!orig || !orig[idx]) return;
    updateBox(idx, { ...orig[idx] });
  }, [cacheKey, updateBox]);

  // Pointer move/up listeners — attached to window so drags continue when the
  // cursor leaves the box.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || !containerRef.current) return;
      const dx = (e.clientX - d.startX) / d.rect.width;
      const dy = (e.clientY - d.startY) / d.rect.height;
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) d.moved = true;

      let { x, y, w, h } = d.startBox;
      switch (d.handle) {
        case "move":
          x = clamp(x + dx, 0, 1 - w);
          y = clamp(y + dy, 0, 1 - h);
          break;
        case "e":  w = clamp(w + dx, MIN_SIZE, 1 - x); break;
        case "w": {
          const nx = clamp(x + dx, 0, x + w - MIN_SIZE);
          w = w + (x - nx); x = nx; break;
        }
        case "s":  h = clamp(h + dy, MIN_SIZE, 1 - y); break;
        case "n": {
          const ny = clamp(y + dy, 0, y + h - MIN_SIZE);
          h = h + (y - ny); y = ny; break;
        }
        case "se": w = clamp(w + dx, MIN_SIZE, 1 - x); h = clamp(h + dy, MIN_SIZE, 1 - y); break;
        case "ne": {
          w = clamp(w + dx, MIN_SIZE, 1 - x);
          const ny = clamp(y + dy, 0, y + h - MIN_SIZE);
          h = h + (y - ny); y = ny; break;
        }
        case "sw": {
          const nx = clamp(x + dx, 0, x + w - MIN_SIZE);
          w = w + (x - nx); x = nx;
          h = clamp(h + dy, MIN_SIZE, 1 - y); break;
        }
        case "nw": {
          const nx = clamp(x + dx, 0, x + w - MIN_SIZE);
          w = w + (x - nx); x = nx;
          const ny = clamp(y + dy, 0, y + h - MIN_SIZE);
          h = h + (y - ny); y = ny; break;
        }
      }
      updateBox(d.idx, { ...d.startBox, x, y, w, h });
    };

    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      // If the user actually dragged, switch into "editing" mode for that box
      // so a stray click doesn't immediately fire extraction.
      if (d.moved) setEditingIdx(d.idx);
      dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [updateBox]);

  const beginDrag = (e: React.PointerEvent, idx: number, handle: Handle, box: Box) => {
    if (!containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      idx,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      rect: containerRef.current.getBoundingClientRect(),
      startBox: { ...box },
      moved: false,
    };
  };

  return (
    <>
      {active && (
        <div ref={containerRef} className="absolute inset-0 pointer-events-none">
          {/* Subtle dimming to make hotspots pop without hiding the render */}
          <div className="absolute inset-0 bg-background/20" />

          {loading && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-2 rounded-md bg-surface-0/85 backdrop-blur px-3 py-1.5 border border-border text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                Detecting parts…
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="absolute inset-x-4 bottom-4 rounded-md bg-destructive/10 border border-destructive/40 text-destructive text-mono text-[10px] uppercase tracking-widest px-2 py-1 text-center">
              Detection failed — toggle pick mode to retry
            </div>
          )}

          {!loading && boxes && boxes.length === 0 && (
            <div className="absolute inset-x-4 bottom-4 rounded-md bg-surface-0/85 backdrop-blur border border-border text-mono text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-1 text-center">
              No body kit parts detected on this view
            </div>
          )}

          {!loading && boxes?.map((z, i) => {
            const isEditing = editingIdx === i;
            const isHover = hoverIdx === i;
            return (
              <div
                key={`${z.kind}-${i}`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                style={{
                  left:   `${z.x * 100}%`,
                  top:    `${z.y * 100}%`,
                  width:  `${z.w * 100}%`,
                  height: `${z.h * 100}%`,
                }}
                className={cn(
                  "absolute pointer-events-auto rounded-md border-2 border-dashed transition-colors group/box",
                  isEditing
                    ? "border-primary bg-primary/15"
                    : isHover
                      ? "border-primary bg-primary/15 cursor-move"
                      : "border-primary/50 bg-primary/5 hover:bg-primary/10 cursor-move",
                )}
              >
                {/* Body — drag to move, single click (no drag) to extract */}
                <button
                  type="button"
                  onPointerDown={(e) => beginDrag(e, i, "move", z)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isEditing) return; // confirm via the dedicated button
                    if (dragRef.current) return; // suppress click after drag
                    onPick(z);
                  }}
                  className="absolute inset-0 w-full h-full cursor-move"
                  title={isEditing ? "Drag to refine, then confirm" : "Click to extract — or drag to refine first"}
                >
                  <span
                    className={cn(
                      "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                      "rounded bg-surface-0/85 backdrop-blur px-1.5 py-0.5 border border-border inline-flex items-center gap-1 shadow-sm",
                      "text-[10px] text-mono uppercase tracking-widest text-primary whitespace-nowrap",
                    )}
                  >
                    <Wand2 className="h-2.5 w-2.5" />
                    {z.label}
                  </span>
                </button>

                {/* Resize handles — 4 corners + 4 edges */}
                {([
                  ["nw", "top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
                  ["ne", "top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
                  ["sw", "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
                  ["se", "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
                  ["n",  "top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize"],
                  ["s",  "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize"],
                  ["w",  "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
                  ["e",  "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize"],
                ] as Array<[Handle, string]>).map(([h, pos]) => (
                  <span
                    key={h}
                    onPointerDown={(e) => beginDrag(e, i, h, z)}
                    className={cn(
                      "absolute h-2.5 w-2.5 rounded-sm bg-primary border border-primary-foreground/60 shadow",
                      "opacity-0 group-hover/box:opacity-100 transition-opacity",
                      isEditing && "opacity-100",
                      pos,
                    )}
                  />
                ))}

                {/* Confirm/reset toolbar — only when the user has dragged the box */}
                {isEditing && (
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-md bg-surface-0/95 backdrop-blur px-1 py-1 border border-border shadow-md whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onPick(z); }}
                      className="rounded px-2 py-0.5 inline-flex items-center gap-1 text-[10px] text-mono uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Check className="h-2.5 w-2.5" />
                      Use crop
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resetBox(i); setEditingIdx(null); }}
                      className="rounded px-2 py-0.5 text-[10px] text-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <ExtractedPartPreview
          open={!!preview}
          onClose={() => { setPreview(null); setEditingIdx(null); }}
          conceptId={conceptId}
          kind={preview.kind}
          label={preview.label}
          filenameBase={preview.filenameBase}
          sourceImageUrl={preview.sourceUrl || sourceImageUrl}
          bbox={preview.bbox}
        />
      )}
    </>
  );
}

export type { ViewKey };
