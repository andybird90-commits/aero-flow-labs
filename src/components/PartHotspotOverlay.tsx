/**
 * PartHotspotOverlay
 *
 * Sits on top of a concept render image. When "pick mode" is active, shows
 * clickable zones over the parts of the car that the current view exposes.
 * Click a zone → calls extract-part-from-concept → measures that one part →
 * generates a parametric STL fitted to the user's car bounds → triggers a
 * download.
 *
 * Coordinates are normalised (0-1) so the same zones work on any aspect ratio.
 */
import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { downloadStl, partToStlString } from "@/lib/part-stl";
import { cn } from "@/lib/utils";
import { ExtractedPartPreview } from "@/components/ExtractedPartPreview";

type ViewKey = "front" | "side" | "rear34" | "rear";
type PartKind =
  | "splitter" | "lip" | "canard" | "side_skirt"
  | "wide_arch" | "diffuser" | "ducktail" | "wing";

interface Zone {
  kind: PartKind;
  label: string;
  /** Box in normalised image coords (0-1). x,y = top-left. */
  x: number; y: number; w: number; h: number;
}

/** Hand-tuned zones per render angle. Tuned for our typical Gemini renders
 * where the car sits roughly centred at ~40-90% horizontal width. */
const ZONES: Record<ViewKey, Zone[]> = {
  front: [
    { kind: "splitter",  label: "Splitter", x: 0.18, y: 0.78, w: 0.64, h: 0.14 },
    { kind: "lip",       label: "Lip",      x: 0.22, y: 0.88, w: 0.56, h: 0.07 },
    { kind: "canard",    label: "Canards",  x: 0.10, y: 0.62, w: 0.18, h: 0.18 },
    { kind: "wide_arch", label: "Front arch (L)", x: 0.04, y: 0.45, w: 0.18, h: 0.30 },
    { kind: "wide_arch", label: "Front arch (R)", x: 0.78, y: 0.45, w: 0.18, h: 0.30 },
  ],
  side: [
    { kind: "side_skirt", label: "Side skirt", x: 0.18, y: 0.72, w: 0.64, h: 0.10 },
    { kind: "wide_arch",  label: "Front arch", x: 0.10, y: 0.42, w: 0.22, h: 0.34 },
    { kind: "wide_arch",  label: "Rear arch",  x: 0.66, y: 0.42, w: 0.22, h: 0.34 },
    { kind: "ducktail",   label: "Ducktail",   x: 0.62, y: 0.30, w: 0.20, h: 0.10 },
    { kind: "wing",       label: "Wing",       x: 0.58, y: 0.18, w: 0.32, h: 0.16 },
  ],
  rear34: [
    { kind: "diffuser", label: "Diffuser", x: 0.20, y: 0.74, w: 0.56, h: 0.16 },
    { kind: "wing",     label: "Wing",     x: 0.18, y: 0.18, w: 0.68, h: 0.20 },
    { kind: "ducktail", label: "Ducktail", x: 0.28, y: 0.36, w: 0.44, h: 0.10 },
    { kind: "wide_arch", label: "Rear arch", x: 0.04, y: 0.48, w: 0.20, h: 0.32 },
  ],
  rear: [
    { kind: "diffuser", label: "Diffuser", x: 0.18, y: 0.74, w: 0.64, h: 0.16 },
    { kind: "wing",     label: "Wing",     x: 0.14, y: 0.18, w: 0.72, h: 0.20 },
    { kind: "ducktail", label: "Ducktail", x: 0.26, y: 0.36, w: 0.48, h: 0.10 },
  ],
};

interface Props {
  active: boolean;
  view: ViewKey;
  projectId: string;
  conceptId: string;
  conceptTitle: string;
}

interface Preview {
  kind: PartKind;
  label: string;
  params: Record<string, number>;
  reasoning: string;
  filename: string;
}

export function PartHotspotOverlay({ active, view, projectId, conceptId, conceptTitle }: Props) {
  const { toast } = useToast();
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const zones = ZONES[view] ?? [];

  const onPick = async (zone: Zone) => {
    if (busyKind) return;
    const busyKey = `${zone.kind}:${zone.label}`;
    setBusyKind(busyKey);
    try {
      const { data, error } = await supabase.functions.invoke("extract-part-from-concept", {
        body: { project_id: projectId, concept_id: conceptId, part_kind: zone.kind },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      const params = (data as any).params as Record<string, number>;
      const reasoning = (data as any).reasoning as string;
      const present = !!(data as any).present;

      const safeTitle = conceptTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "concept";
      const filename = `${safeTitle}__${zone.kind}.stl`;

      // Show preview modal — user confirms download from there
      setPreview({
        kind: zone.kind,
        label: zone.label,
        params,
        reasoning: present ? reasoning : `${reasoning ?? ""} (Part not clearly visible — using sensible defaults.)`.trim(),
        filename,
      });
    } catch (e: any) {
      const msg = String(e.message ?? e);
      if (msg.includes("429")) toast({ title: "Rate limit reached", variant: "destructive" });
      else if (msg.includes("402")) toast({ title: "AI credits exhausted", variant: "destructive" });
      else toast({ title: "Extraction failed", description: msg, variant: "destructive" });
    } finally {
      setBusyKind(null);
    }
  };

  const confirmDownload = () => {
    if (!preview) return;
    const stl = partToStlString(preview.kind, preview.params);
    downloadStl(preview.filename, stl);
    toast({ title: `${preview.label} downloaded`, description: preview.filename });
    setPreview(null);
  };

  return (
    <>
      {active && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Subtle dimming to make hotspots pop without hiding the render */}
          <div className="absolute inset-0 bg-background/20" />

          {zones.map((z, i) => {
            const busyKey = `${z.kind}:${z.label}`;
            const busy = busyKind === busyKey;
            const dim = busyKind && !busy;
            return (
              <button
                key={`${z.kind}-${i}`}
                type="button"
                onClick={(e) => { e.stopPropagation(); onPick(z); }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                disabled={!!busyKind}
                style={{
                  left:   `${z.x * 100}%`,
                  top:    `${z.y * 100}%`,
                  width:  `${z.w * 100}%`,
                  height: `${z.h * 100}%`,
                }}
                className={cn(
                  "absolute pointer-events-auto rounded-md border-2 border-dashed transition-all",
                  "flex items-center justify-center text-[10px] text-mono uppercase tracking-widest",
                  busy
                    ? "border-primary bg-primary/30 text-primary-foreground"
                    : hoverIdx === i
                      ? "border-primary bg-primary/20 text-primary cursor-pointer scale-[1.02]"
                      : "border-primary/50 bg-primary/5 text-primary/90 hover:bg-primary/10",
                  dim && "opacity-40",
                )}
              >
                <span className="rounded bg-surface-0/85 backdrop-blur px-1.5 py-0.5 border border-border inline-flex items-center gap-1 shadow-sm">
                  {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Wand2 className="h-2.5 w-2.5" />}
                  {z.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {preview && (
        <ExtractedPartPreview
          open={!!preview}
          onClose={() => setPreview(null)}
          onDownload={confirmDownload}
          kind={preview.kind}
          label={preview.label}
          params={preview.params}
          reasoning={preview.reasoning}
          filename={preview.filename}
        />
      )}
    </>
  );
}

export type { ViewKey };
