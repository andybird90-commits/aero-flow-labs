import { Link, useSearchParams } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { CarViewer3D } from "@/components/CarViewer3D";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  useGeometry, useActiveConceptSet, useFittedParts, useUpsertFittedPart,
  type FittedPart,
} from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { ArrowRight, Sliders, Eye, EyeOff, Download, Box } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { downloadStl, partToStlString } from "@/lib/part-stl";

interface RefineSpec {
  kind: string;
  label: string;
  controls: {
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    unit: string;
  }[];
}

const REFINE_SPECS: RefineSpec[] = [
  {
    kind: "splitter", label: "Front splitter",
    controls: [
      { key: "depth", label: "Depth", min: 30, max: 200, step: 5, unit: "mm" },
      { key: "nudge_x", label: "Forward offset", min: -0.2, max: 0.2, step: 0.01, unit: "m" },
      { key: "nudge_y", label: "Vertical offset", min: -0.1, max: 0.1, step: 0.005, unit: "m" },
    ],
  },
  {
    kind: "lip", label: "Lip extension",
    controls: [{ key: "depth", label: "Depth", min: 10, max: 80, step: 2, unit: "mm" }],
  },
  {
    kind: "canard", label: "Canards",
    controls: [{ key: "angle", label: "Angle", min: 0, max: 30, step: 1, unit: "°" }],
  },
  {
    kind: "side_skirt", label: "Side skirts",
    controls: [{ key: "depth", label: "Depth", min: 30, max: 150, step: 5, unit: "mm" }],
  },
  {
    kind: "wide_arch", label: "Wide arches",
    controls: [{ key: "flare", label: "Flare", min: 20, max: 120, step: 5, unit: "mm" }],
  },
  {
    kind: "front_arch", label: "Front arch",
    controls: [
      { key: "flare", label: "Flare", min: 20, max: 120, step: 5, unit: "mm" },
      { key: "arch_radius", label: "Arch radius", min: 260, max: 560, step: 10, unit: "mm" },
    ],
  },
  {
    kind: "rear_arch", label: "Rear arch",
    controls: [
      { key: "flare", label: "Flare", min: 20, max: 140, step: 5, unit: "mm" },
      { key: "arch_radius", label: "Arch radius", min: 260, max: 580, step: 10, unit: "mm" },
    ],
  },
  {
    kind: "diffuser", label: "Rear diffuser",
    controls: [{ key: "angle", label: "Angle", min: 0, max: 25, step: 1, unit: "°" }],
  },
  {
    kind: "ducktail", label: "Ducktail",
    controls: [{ key: "height", label: "Height", min: 15, max: 90, step: 3, unit: "mm" }],
  },
  {
    kind: "wing", label: "Rear wing",
    controls: [
      { key: "aoa",    label: "Angle of attack", min: 0, max: 20, step: 1, unit: "°" },
      { key: "chord",  label: "Chord",           min: 180, max: 420, step: 10, unit: "mm" },
      { key: "gurney", label: "Gurney lip",      min: 0, max: 30, step: 1, unit: "mm" },
    ],
  },
];

export default function Refine() {
  return (
    <WorkspaceShell>
      {({ project, projectId }) => <RefineInner projectId={projectId!} project={project} />}
    </WorkspaceShell>
  );
}

function RefineInner({ projectId, project }: { projectId: string; project: any }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const focusedKind = searchParams.get("part");
  const { data: geometry } = useGeometry(projectId);
  const { data: conceptSet } = useActiveConceptSet(projectId);
  const { data: parts = [] } = useFittedParts(conceptSet?.id);
  const upsert = useUpsertFittedPart();
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  const enabled = parts.filter((p) => p.enabled);
  const focusedPart = focusedKind ? enabled.find((p) => p.kind === focusedKind) : undefined;
  const displayedParts = focusedPart ? [focusedPart] : enabled;
  const visibility = useMemo(() => {
    if (focusedPart) return Object.fromEntries(enabled.map((p) => [p.kind, p.id === focusedPart.id]));
    return Object.fromEntries(enabled.map((p) => [p.kind, !hidden[p.kind]]));
  }, [enabled, focusedPart, hidden]);

  const update = (part: FittedPart, key: string, value: number) => {
    if (!user || !conceptSet) return;
    upsert.mutate({
      userId: user.id,
      conceptSetId: conceptSet.id,
      id: part.id,
      kind: part.kind,
      params: { ...((part.params as object) ?? {}), [key]: value },
      enabled: part.enabled,
    });
  };

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_420px]">
      <div className="glass rounded-xl overflow-hidden h-[640px] lg:sticky lg:top-32 lg:self-start relative">
        {geometry ? (
          <CarViewer3D
            template={project.car?.template ?? null}
            geometry={geometry}
            parts={parts}
            partVisibility={visibility}
          />
        ) : (
          <div className="h-full grid place-items-center text-muted-foreground">Loading…</div>
        )}
        <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-surface-0/80 backdrop-blur px-2.5 py-1.5 border border-border">
          <Sliders className="h-3.5 w-3.5 text-primary" />
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Live refinement
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Step 5 · Refine</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Tune the fitted parts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live preview · adjustments save automatically.
          </p>
        </div>

        {enabled.length === 0 && (
          <div className="glass rounded-xl p-6 text-center">
            <p className="text-sm text-muted-foreground">No parts to refine yet.</p>
            <Button variant="hero" size="sm" className="mt-3" asChild>
              <Link to={`/parts?project=${projectId}`}>Generate parts</Link>
            </Button>
          </div>
        )}

        {enabled.map((part) => {
          const spec = REFINE_SPECS.find((s) => s.kind === part.kind);
          if (!spec) return null;
          const isHidden = !!hidden[part.kind];
          return (
            <div key={part.id} className={cn("glass rounded-xl", isHidden && "opacity-60")}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold tracking-tight">{spec.label}</h3>
                <button
                  onClick={() => setHidden((h) => ({ ...h, [part.kind]: !h[part.kind] }))}
                  className="text-muted-foreground hover:text-foreground"
                  title={isHidden ? "Show in viewer" : "Hide from viewer"}
                >
                  {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="p-4 space-y-4">
                {spec.controls.map((c) => {
                  const value = (part.params as any)?.[c.key] ?? 0;
                  return (
                    <div key={c.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</span>
                        <span className="text-mono text-[11px] text-foreground tabular-nums">
                          {value.toFixed(c.step < 1 ? 2 : 0)} {c.unit}
                        </span>
                      </div>
                      <Slider
                        value={[value]}
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        onValueChange={(v) => update(part, c.key, v[0])}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {enabled.length > 0 && (
          <Button variant="hero" size="lg" className="w-full" asChild>
            <Link to={`/exports?project=${projectId}`}>
              Continue to exports <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
