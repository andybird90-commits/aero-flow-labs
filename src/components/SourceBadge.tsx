/**
 * SourceBadge — tiny chip indicating where a concept_part came from.
 * Three sources: parametric (green), extracted (blue), boolean (orange).
 */
import { cn } from "@/lib/utils";
import { Wrench, MousePointer2, Layers } from "lucide-react";

export type PartSource = "parametric" | "extracted" | "boolean";

const META: Record<PartSource, { label: string; cls: string; Icon: any }> = {
  parametric: { label: "Parametric", cls: "border-success/40 bg-success/10 text-success",   Icon: Wrench },
  extracted:  { label: "Extracted",  cls: "border-primary/40 bg-primary/10 text-primary",   Icon: MousePointer2 },
  boolean:    { label: "Boolean",    cls: "border-warning/40 bg-warning/10 text-warning",   Icon: Layers },
};

export function SourceBadge({ source, className }: { source: PartSource; className?: string }) {
  const m = META[source] ?? META.extracted;
  const { Icon } = m;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] text-mono uppercase tracking-widest",
      m.cls, className,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {m.label}
    </span>
  );
}
