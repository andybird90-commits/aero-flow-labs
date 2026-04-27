/**
 * Compact chip displayed on Library + Part Rail cards summarising what's
 * actually inside a GLB. Auto-inspects on mount if not yet cached.
 *
 *   "Single shell · 84k tris"   (one fused mesh — sculpt-friendly)
 *   "12 parts · 5 mats"          (multi-mesh kit — per-part recolour-friendly)
 *   "Inspecting…"                (first view, async)
 */
import { Loader2, Box, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  useEnsureStructureInspected,
  getCachedStructure,
  classifyStructure,
} from "@/lib/build-studio/glb-inspect";
import type { LibraryItem } from "@/lib/repo";

interface Props {
  item: LibraryItem;
  /** Render as a single tiny line (rail) vs full pill (library card). */
  variant?: "pill" | "inline";
  className?: string;
}

function fmtTris(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function MeshStructureChip({ item, variant = "pill", className }: Props) {
  useEnsureStructureInspected(item);
  const structure = getCachedStructure(item);
  const kind = classifyStructure(structure);

  // Only meaningful for mesh assets — silently render nothing for images.
  const url = (item.asset_url ?? "").toLowerCase().split("?")[0];
  const mime = (item.asset_mime ?? "").toLowerCase();
  const isMesh =
    mime.includes("gltf") || mime.includes("glb") || mime.includes("stl") ||
    url.endsWith(".glb") || url.endsWith(".gltf") || url.endsWith(".stl");
  if (!isMesh) return null;

  if (!structure) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] text-muted-foreground", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Inspecting…
      </span>
    );
  }

  const Icon = kind === "single-shell" ? Box : Layers;
  const label =
    kind === "single-shell"
      ? `Single shell · ${fmtTris(structure.triangleCount)} tris`
      : `${structure.meshCount} parts · ${structure.materialCount} mat${structure.materialCount === 1 ? "" : "s"}`;

  const tooltip = (
    <div className="space-y-1 text-xs">
      <div className="font-medium">
        {kind === "single-shell" ? "Single fused shell" : `${structure.meshCount}-piece kit`}
      </div>
      <div className="text-muted-foreground">
        {fmtTris(structure.triangleCount)} triangles · {structure.materialCount} material{structure.materialCount === 1 ? "" : "s"}
      </div>
      {structure.nodeNames.length > 0 && (
        <div className="text-[10px] text-muted-foreground/80">
          {structure.nodeNames.slice(0, 6).join(", ")}
          {structure.nodeNames.length > 6 ? "…" : ""}
        </div>
      )}
      <div className="pt-1 text-[10px] text-muted-foreground/70">
        {kind === "single-shell"
          ? "Best for sculpting bodywork as one surface."
          : "Best for swapping or recolouring individual panels."}
      </div>
    </div>
  );

  const base =
    variant === "pill"
      ? "inline-flex items-center gap-1 rounded-md border border-border bg-surface-0/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
      : "inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/80";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(base, className)}>
            <Icon className="h-3 w-3" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
