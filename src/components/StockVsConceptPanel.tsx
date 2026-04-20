/**
 * StockVsConceptPanel — side-by-side comparison of the hero-car STL silhouette
 * and the approved concept renders, at the same 4 angles the concept generator
 * uses. This is the sanity-check viewer that proves the displacement step has
 * matching cameras to work with.
 *
 * Renders nothing if the project's car template doesn't have a hero STL yet.
 * That's intentional — boolean kits are an opt-in flow and the rest of the
 * app must keep working without one.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, Layers, ImageOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useCarStlForTemplate, useSignedCarStlUrl, useConcepts, type Concept,
} from "@/lib/repo";
import { renderStlAngles, type AngleKey, type ForwardAxis } from "@/lib/stl-render";
import { cn } from "@/lib/utils";

const ANGLE_LABELS: Record<AngleKey, string> = {
  front_three_quarter: "Front 3/4",
  side: "Side",
  rear_three_quarter: "Rear 3/4",
  rear: "Rear",
};

const ANGLE_ORDER: AngleKey[] = ["front_three_quarter", "side", "rear_three_quarter", "rear"];

/** Pull the right concept-render URL for a given camera angle. */
function conceptUrlFor(angle: AngleKey, c: Concept): string | null {
  switch (angle) {
    case "front_three_quarter": return c.render_front_url;
    case "side":                return c.render_side_url;
    case "rear_three_quarter":  return (c as any).render_rear34_url ?? null;
    case "rear":                return c.render_rear_url;
  }
}

interface Props {
  projectId: string;
  carTemplateId: string | null | undefined;
}

export function StockVsConceptPanel({ projectId, carTemplateId }: Props) {
  const { toast } = useToast();
  const { data: stlRow, isLoading: stlLoading } = useCarStlForTemplate(carTemplateId);
  const { data: signedUrl } = useSignedCarStlUrl(stlRow);
  const { data: concepts = [] } = useConcepts(projectId);

  // Prefer the user-approved concept; otherwise the most recent.
  const concept = useMemo<Concept | null>(() => {
    const approved = concepts.find((c) => c.status === "approved" || c.status === "favourited");
    return approved ?? concepts[0] ?? null;
  }, [concepts]);

  const [renders, setRenders] = useState<Record<AngleKey, string> | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Trigger the STL render whenever we get a new signed URL or the
  // forward-axis setting changes on the row.
  useEffect(() => {
    if (!signedUrl || !stlRow) return;
    let cancelled = false;
    setRendering(true);
    setRenderError(null);
    renderStlAngles(signedUrl, { forwardAxis: stlRow.forward_axis as ForwardAxis, size: 384 })
      .then((out) => { if (!cancelled) setRenders(out); })
      .catch((e) => {
        if (!cancelled) {
          const msg = String(e?.message ?? e);
          setRenderError(msg);
          toast({ title: "Couldn’t render STL", description: msg, variant: "destructive" });
        }
      })
      .finally(() => { if (!cancelled) setRendering(false); });
    return () => { cancelled = true; };
  }, [signedUrl, stlRow?.forward_axis, stlRow?.id, toast]);

  // Hide the panel entirely if there's no hero STL for this template — keeps
  // the Library page clean for projects on cars without one yet.
  if (!stlLoading && !stlRow) return null;

  const stlIsReady = !!stlRow?.repaired_stl_path && stlRow.manifold_clean;

  return (
    <section className="glass rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <Layers className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Stock body vs concept</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Same camera as the concept renders — the boolean kit pipeline displaces wherever the concept silhouette extends past the stock body.
            </p>
          </div>
        </div>
        <Button
          variant="glass"
          size="sm"
          onClick={() => {
            if (!signedUrl || !stlRow) return;
            setRendering(true);
            setRenderError(null);
            renderStlAngles(signedUrl, { forwardAxis: stlRow.forward_axis as ForwardAxis, size: 384 })
              .then(setRenders)
              .catch((e) => setRenderError(String(e?.message ?? e)))
              .finally(() => setRendering(false));
          }}
          disabled={rendering || !signedUrl}
        >
          {rendering
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Rendering…</>
            : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Re-render</>}
        </Button>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2 flex-wrap text-mono text-[10px] uppercase tracking-widest">
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
          stlIsReady
            ? "border-success/40 text-success"
            : "border-warning/40 text-warning",
        )}>
          {stlIsReady ? "Ready (manifold)" : (stlRow?.repaired_stl_path ? "Non-manifold" : "Awaiting repair")}
        </span>
        {!concept && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground">
            No concept yet
          </span>
        )}
        {!stlIsReady && (
          <Link
            to="/settings/car-stls"
            className="text-primary hover:underline normal-case tracking-normal text-[11px]"
          >
            Open hero-STL admin →
          </Link>
        )}
      </div>

      {renderError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">STL render failed</div>
            <div className="text-xs opacity-80 break-all">{renderError}</div>
          </div>
        </div>
      )}

      {/* Grid: 4 angles × {stock, concept} */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ANGLE_ORDER.map((angle) => {
          const stockUrl = renders?.[angle] ?? null;
          const conceptUrl = concept ? conceptUrlFor(angle, concept) : null;
          return (
            <div key={angle} className="rounded-lg border border-border bg-surface-1/40 overflow-hidden">
              <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between">
                <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {ANGLE_LABELS[angle]}
                </span>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border">
                <Tile
                  url={stockUrl}
                  label="Stock"
                  loading={rendering && !stockUrl}
                />
                <Tile
                  url={conceptUrl}
                  label="Concept"
                  emptyLabel={concept ? "No render" : "No concept"}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Tile({
  url, label, loading, emptyLabel,
}: { url: string | null; label: string; loading?: boolean; emptyLabel?: string }) {
  return (
    <div className="relative aspect-square bg-surface-0">
      {url ? (
        <img src={url} alt={label} className="absolute inset-0 h-full w-full object-cover" />
      ) : loading ? (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground/60">
          <div className="flex flex-col items-center gap-1">
            <ImageOff className="h-4 w-4" />
            <span className="text-[10px] text-mono uppercase tracking-widest">
              {emptyLabel ?? "—"}
            </span>
          </div>
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-surface-0/85 backdrop-blur px-1.5 py-0.5 text-[9px] text-mono uppercase tracking-widest text-muted-foreground border border-border">
        {label}
      </span>
    </div>
  );
}
