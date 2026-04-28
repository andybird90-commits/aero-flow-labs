/**
 * EngineChooser
 *
 * Three-button picker shown after a part has been picked + AI-rendered. Lets
 * the user explicitly choose which build engine to dispatch to:
 *
 *   - CAD       (CadQuery, parametric, clean B-rep, real STEP)
 *   - Mesh AI   (Rodin, image-to-3D, fast & lumpy)
 *   - Blender   (surface-fit against the saved base car mesh)
 *
 * `recommended` is just a badge — no engine is ever disabled based on the
 * part kind classification. Blender is greyed out only when no base car STL
 * is saved (the worker can't fit without it).
 */
import { Button } from "@/components/ui/button";
import { Wrench, Wand2, Send } from "lucide-react";
import { isBodyConforming } from "@/lib/part-classification";

/**
 * Part kinds the `generate-cad-recipe` edge function has a trusted CadQuery
 * builder for. Keep this in sync with the BUILDERS list in
 * `supabase/functions/generate-cad-recipe/index.ts` — anything not listed
 * here will hit a 400 from the function ("No trusted CAD builder yet…").
 */
const CAD_SUPPORTED_PART_KINDS = [
  "front_arch", "front_fender_flare", "wide_arch",
  "arch_left", "arch_right", "fender_flare", "arch",
];

function isCadSupported(partKind: string): boolean {
  const k = (partKind ?? "").toLowerCase();
  return CAD_SUPPORTED_PART_KINDS.some((p) => k.includes(p) || p.includes(k));
}

export type BuildEngine = "cad" | "mesh" | "blender";

interface Props {
  partKind: string;
  hasBaseMesh: boolean;
  onPick: (engine: BuildEngine) => void;
  disabled?: boolean;
}

export function EngineChooser({ partKind, hasBaseMesh, onPick, disabled }: Props) {
  const bodyConforming = isBodyConforming(partKind);
  const recommended: BuildEngine = bodyConforming ? "blender" : "cad";

  const engines: Array<{
    id: BuildEngine;
    label: string;
    icon: any;
    blurb: string;
    eta: string;
    formats: string;
    disabledReason?: string;
  }> = [
    {
      id: "cad",
      label: "Build with CAD",
      icon: Wrench,
      blurb: "Parametric CadQuery build. Clean B-rep, sharp edges, real STEP.",
      eta: "~3 min",
      formats: "STEP · STL · GLB",
    },
    {
      id: "mesh",
      label: "Generate mesh",
      icon: Wand2,
      blurb: "Rodin image-to-3D. Fast, organic — can be lumpy on flat panels.",
      eta: "~90 s",
      formats: "GLB",
    },
    {
      id: "blender",
      label: "Fit to body",
      icon: Send,
      blurb: "Surface-conform a template against your saved base car STL.",
      eta: "~2 min",
      formats: "STL · GLB",
      disabledReason: hasBaseMesh ? undefined : "Save a base car STL on this project first.",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
      {engines.map((e) => {
        const Icon = e.icon;
        const isRec = e.id === recommended;
        const isDisabled = disabled || !!e.disabledReason;
        return (
          <button
            key={e.id}
            type="button"
            disabled={isDisabled}
            onClick={() => onPick(e.id)}
            className={`group text-left rounded-lg border p-3 transition-colors flex flex-col gap-2
              ${isDisabled
                ? "opacity-50 cursor-not-allowed border-border bg-surface-0"
                : "border-border bg-surface-0 hover:border-primary hover:bg-surface-1"}
              ${isRec && !isDisabled ? "ring-1 ring-primary/40" : ""}
            `}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-sm">
                <Icon className="h-4 w-4 text-primary" />
                {e.label}
              </div>
              {isRec && !isDisabled && (
                <span className="text-[9px] uppercase tracking-widest font-mono text-primary border border-primary/40 rounded px-1.5 py-0.5">
                  Recommended
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground leading-snug">{e.blurb}</div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-mono text-muted-foreground mt-auto pt-1 border-t border-border">
              <span>{e.eta}</span>
              <span>{e.formats}</span>
            </div>
            {e.disabledReason && (
              <div className="text-[10px] text-warning leading-snug">{e.disabledReason}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
