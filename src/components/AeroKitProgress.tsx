/**
 * AeroKitProgress — 3-step strip showing where the boolean-kit pipeline is
 * for a given concept. Driven by `concepts.aero_kit_status`:
 *
 *   idle / null  → strip hidden
 *   queued       → all steps grey
 *   displacing   → step 1 active, 2/3 grey
 *   displaced    → step 1 done, 2 active, 3 grey
 *   subtracting  → step 1 done, 2 active, 3 grey
 *   splitting    → steps 1+2 done, 3 active
 *   ready        → all steps done
 *   failed       → red banner with error
 */
import { CheckCircle2, Loader2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type AeroKitStatus =
  | "idle" | "queued" | "displacing" | "displaced"
  | "subtracting" | "splitting" | "ready" | "failed";

const STEPS = [
  { key: "displace", label: "Displace" },
  { key: "subtract", label: "Subtract" },
  { key: "split",    label: "Split" },
] as const;

function stateForStep(stepIdx: number, status: AeroKitStatus): "done" | "active" | "todo" {
  switch (status) {
    case "ready":       return "done";
    case "failed":      return "todo";
    case "queued":      return stepIdx === 0 ? "active" : "todo";
    case "displacing":  return stepIdx === 0 ? "active" : "todo";
    case "displaced":
    case "subtracting": return stepIdx === 0 ? "done" : stepIdx === 1 ? "active" : "todo";
    case "splitting":   return stepIdx <= 1 ? "done" : "active";
    default:            return "todo";
  }
}

export function AeroKitProgress({
  status, error, warning, className,
}: { status: AeroKitStatus; error?: string | null; warning?: string | null; className?: string }) {
  if (status === "idle") return null;

  if (status === "failed") {
    return (
      <div className={cn("rounded-md border border-destructive/40 bg-destructive/5 p-2.5 flex items-start gap-2", className)}>
        <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
        <div className="min-w-0 text-[11px]">
          <div className="text-destructive font-semibold">Aero kit build failed</div>
          {error && <div className="text-destructive/80 break-words mt-0.5">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {warning && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2 flex items-start gap-2">
          <AlertCircle className="h-3 w-3 text-warning mt-0.5 shrink-0" />
          <div className="text-[10px] text-warning break-words">{warning}</div>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {STEPS.map((step, i) => {
          const s = stateForStep(i, status);
          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] text-mono uppercase tracking-widest",
                s === "done" && "border-success/40 bg-success/10 text-success",
                s === "active" && "border-primary/50 bg-primary/10 text-primary",
                s === "todo" && "border-border text-muted-foreground",
              )}
            >
              {s === "done" && <CheckCircle2 className="h-3 w-3" />}
              {s === "active" && <Loader2 className="h-3 w-3 animate-spin" />}
              {s === "todo" && <Circle className="h-3 w-3" />}
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
