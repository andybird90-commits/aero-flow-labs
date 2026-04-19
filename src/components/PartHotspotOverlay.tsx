/**
 * PartHotspotOverlay
 *
 * Sits on top of a concept render image. When "pick mode" is active, asks the
 * `detect-concept-hotspots` edge function for AI-detected bounding boxes of
 * the body kit parts visible in the *current view*, then renders those boxes
 * as clickable zones. Results are cached per (concept, view) on the concepts
 * row so subsequent opens are instant.
 *
 * Why AI detection: Gemini renders cars at varying positions and scales, so
 * hardcoded normalised boxes never reliably hit the right parts. Asking the
 * vision model to locate them once produces accurate, render-specific boxes.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExtractedPartPreview } from "@/components/ExtractedPartPreview";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type ViewKey = "front" | "side" | "rear34" | "rear";
type PartKind =
  | "splitter" | "lip" | "canard" | "side_skirt"
  | "wide_arch" | "diffuser" | "ducktail" | "wing";

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
}

interface Preview {
  kind: PartKind;
  label: string;
  filenameBase: string;
}

export function PartHotspotOverlay({ active, view, projectId, conceptId, conceptTitle }: Props) {
  const { toast } = useToast();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-(concept,view) memo so re-toggling pick mode is instant after first detect
  const cacheRef = useRef<Map<string, Box[]>>(new Map());
  const cacheKey = `${conceptId}:${view}`;

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
          body: { concept_id: conceptId, view },
        });
        if (cancelled) return;
        if (fnErr) throw fnErr;
        if ((data as any)?.error) throw new Error((data as any).error);
        const got: Box[] = Array.isArray((data as any)?.boxes) ? (data as any).boxes : [];
        cacheRef.current.set(cacheKey, got);
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
  }, [active, cacheKey, conceptId, view, toast]);

  const onPick = (zone: Box) => {
    const safeTitle = conceptTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "concept";
    const safeLabel = zone.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    setPreview({
      kind: zone.kind,
      label: zone.label,
      filenameBase: `${safeTitle}__${safeLabel || zone.kind}`,
    });
  };

  return (
    <>
      {active && (
        <div className="absolute inset-0 pointer-events-none">
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

          {!loading && boxes?.map((z, i) => (
            <button
              key={`${z.kind}-${i}`}
              type="button"
              onClick={(e) => { e.stopPropagation(); onPick(z); }}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
              style={{
                left:   `${z.x * 100}%`,
                top:    `${z.y * 100}%`,
                width:  `${z.w * 100}%`,
                height: `${z.h * 100}%`,
              }}
              className={cn(
                "absolute pointer-events-auto rounded-md border-2 border-dashed transition-all",
                "flex items-center justify-center text-[10px] text-mono uppercase tracking-widest",
                hoverIdx === i
                  ? "border-primary bg-primary/20 text-primary cursor-pointer scale-[1.02]"
                  : "border-primary/50 bg-primary/5 text-primary/90 hover:bg-primary/10",
              )}
            >
              <span className="rounded bg-surface-0/85 backdrop-blur px-1.5 py-0.5 border border-border inline-flex items-center gap-1 shadow-sm">
                <Wand2 className="h-2.5 w-2.5" />
                {z.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {preview && (
        <ExtractedPartPreview
          open={!!preview}
          onClose={() => setPreview(null)}
          conceptId={conceptId}
          kind={preview.kind}
          label={preview.label}
          filenameBase={preview.filenameBase}
        />
      )}
    </>
  );
}

export type { ViewKey };
