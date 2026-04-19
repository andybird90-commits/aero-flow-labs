/**
 * Geometry page — persists ride heights, underbody fidelity,
 * wheel rotation, and steady-state to the geometries table.
 * On save, all simulation_results for this user are flagged stale
 * (handled by useUpdateGeometry mutation).
 */
import { useState, useEffect, useMemo } from "react";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ParamSlider } from "@/components/ParamSlider";
import { StatusChip } from "@/components/StatusChip";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { LoadingState } from "@/components/LoadingState";
import { useToast } from "@/hooks/use-toast";
import {
  Box, Save, RotateCcw, Disc, Car, AlertTriangle, CheckCircle2, Info,
  Layers, Ruler, Move3d, ShieldCheck,
} from "lucide-react";
import { useGeometry, useUpdateGeometry, type Geometry } from "@/lib/repo";
import { MeshUpload } from "@/components/MeshUpload";
import { MeshOrientationControls } from "@/components/MeshOrientation";
import { cn } from "@/lib/utils";

type UnderbodyModel = "simplified" | "detailed";
type WheelRotation = "static" | "rotating";

interface GeoForm {
  ride_height_front_mm: number;
  ride_height_rear_mm: number;
  underbody_model: UnderbodyModel;
  wheel_rotation: WheelRotation;
  steady_state: boolean;
}

function geoToForm(g: Geometry | null | undefined): GeoForm {
  return {
    ride_height_front_mm: Number(g?.ride_height_front_mm ?? 130),
    ride_height_rear_mm: Number(g?.ride_height_rear_mm ?? 135),
    underbody_model: (g?.underbody_model as UnderbodyModel) ?? "simplified",
    wheel_rotation: (g?.wheel_rotation as WheelRotation) ?? "static",
    steady_state: g?.steady_state ?? true,
  };
}

const Geometry = () => (
  <WorkspaceShell>
    {(ctx) => <GeometryContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

function GeometryContent({ buildId }: { buildId: string }) {
  const { toast } = useToast();
  const { data: geometry, isLoading } = useGeometry(buildId);
  const update = useUpdateGeometry();
  const [form, setForm] = useState<GeoForm>(() => geoToForm(geometry));
  const [dirty, setDirty] = useState(false);

  // Sync form when underlying record changes
  useEffect(() => {
    if (geometry) {
      setForm(geoToForm(geometry));
      setDirty(false);
    }
  }, [geometry?.id]);

  const set = <K extends keyof GeoForm>(key: K, value: GeoForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const reset = () => {
    setForm(geoToForm(geometry));
    setDirty(false);
  };

  const save = async () => {
    if (!geometry) return;
    try {
      await update.mutateAsync({ id: geometry.id, patch: form });
      toast({
        title: "Geometry saved",
        description: "Existing simulation results marked stale.",
      });
      setDirty(false);
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    }
  };

  // Confidence: simplified underbody + static wheels = medium; detailed + rotating = high
  const confidence: "low" | "medium" | "high" = useMemo(() => {
    let score = 0;
    if (form.underbody_model === "detailed") score += 2;
    if (form.wheel_rotation === "rotating") score += 1;
    if (!form.steady_state) score += 1;
    return score >= 3 ? "high" : score >= 1 ? "medium" : "low";
  }, [form]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <LoadingState label="Loading geometry" />
      </div>
    );
  }

  if (!geometry) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="glass rounded-xl p-8 text-center">
          <Box className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold">No geometry record</h3>
          <p className="mt-1 text-sm text-muted-foreground">This build is missing a geometry. Reload the demo or create a new build from the garage.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-6 space-y-6">
      {/* Save bar */}
      {dirty && (
        <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/5 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span>Unsaved changes — saving will mark previous CFD results stale.</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="mr-1.5 h-3 w-3" /> Reset</Button>
            <Button variant="hero" size="sm" onClick={save} disabled={update.isPending}>
              <Save className="mr-1.5 h-3 w-3" /> {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT — geometry viewer scenery */}
        <div className="lg:col-span-2 space-y-4">
          <GeometryViewer form={form} />
          <MeshUpload geometry={geometry} />
          <MeshOrientationControls geometry={geometry} />
          <SourceFooter geometry={geometry} />
        </div>

        {/* RIGHT — editable controls */}
        <div className="space-y-4">
          {/* Ride heights */}
          <div className="glass rounded-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Ruler className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">Ride height</h3>
              </div>
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">mm</span>
            </div>
            <div className="p-4 space-y-4">
              <ParamSlider
                label="Front · ride height"
                value={form.ride_height_front_mm}
                min={40}
                max={180}
                unit=" mm"
                onChange={(v) => set("ride_height_front_mm", v)}
                hint="OEM 130"
              />
              <ParamSlider
                label="Rear · ride height"
                value={form.ride_height_rear_mm}
                min={40}
                max={180}
                unit=" mm"
                onChange={(v) => set("ride_height_rear_mm", v)}
                hint="OEM 135"
              />
              <div className="rounded-md border border-border bg-surface-1 p-3 flex items-center justify-between text-mono text-[11px]">
                <span className="text-muted-foreground">Computed rake</span>
                <span className="text-foreground tabular-nums">
                  {((form.ride_height_rear_mm - form.ride_height_front_mm) * 0.022).toFixed(2)}°
                </span>
              </div>
            </div>
          </div>

          {/* Underbody fidelity */}
          <div className="glass rounded-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">Underbody model</h3>
              </div>
              <StatusChip tone={form.underbody_model === "detailed" ? "success" : "warning"} size="sm">
                {form.underbody_model}
              </StatusChip>
            </div>
            <div className="p-3 space-y-2">
              {(["simplified", "detailed"] as UnderbodyModel[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => set("underbody_model", opt)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                    form.underbody_model === opt
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border bg-surface-1 hover:border-primary/20",
                  )}
                >
                  <div className={cn(
                    "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0",
                    form.underbody_model === opt ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium capitalize">{opt}</div>
                    <div className="text-mono text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                      {opt === "simplified"
                        ? "Smoothed floor approximation. Faster solve, ~4% absolute Cl error."
                        : "Detailed diffuser tunnel + floor channels. Higher fidelity."}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Wheel rotation */}
          <div className="glass rounded-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Disc className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">Wheel modelling</h3>
              </div>
              <StatusChip tone={form.wheel_rotation === "rotating" ? "success" : "warning"} size="sm">
                {form.wheel_rotation}
              </StatusChip>
            </div>
            <div className="p-3 space-y-2">
              {(["static", "rotating"] as WheelRotation[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => set("wheel_rotation", opt)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                    form.wheel_rotation === opt
                      ? "border-primary/40 bg-primary/[0.06]"
                      : "border-border bg-surface-1 hover:border-primary/20",
                  )}
                >
                  <div className={cn(
                    "mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0",
                    form.wheel_rotation === opt ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium capitalize">{opt}</div>
                    <div className="text-mono text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                      {opt === "static"
                        ? "Stationary wheels. Faster, less accurate around the wheel arches."
                        : "MRF rotating wheels driven by U∞. Required for high-fidelity wheel-arch flow."}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Solver state */}
          <div className="glass rounded-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">Solver state</h3>
              </div>
            </div>
            <div className="p-4 flex items-center justify-between">
              <div>
                <Label htmlFor="steady" className="text-sm font-medium">Steady-state RANS</Label>
                <div className="text-mono text-[10px] text-muted-foreground mt-0.5">
                  {form.steady_state ? "k-ω SST · time-averaged" : "URANS · transient (slower)"}
                </div>
              </div>
              <Switch
                id="steady"
                checked={form.steady_state}
                onCheckedChange={(v) => set("steady_state", v)}
              />
            </div>
          </div>

          {/* Confidence summary */}
          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold tracking-tight">Confidence preview</h3>
            </div>
            <ConfidenceBadge level={confidence} />
            <p className="mt-3 text-mono text-[10px] text-muted-foreground leading-relaxed">
              Based on current geometry assumptions. Increasing underbody fidelity, enabling rotating wheels, or running transient (URANS) all raise solver confidence.
            </p>
          </div>

          {/* Save (always visible at bottom) */}
          <div className="flex gap-2">
            <Button variant="glass" size="sm" onClick={reset} disabled={!dirty} className="flex-1">
              <RotateCcw className="mr-1.5 h-3 w-3" /> Reset
            </Button>
            <Button variant="hero" size="sm" onClick={save} disabled={!dirty || update.isPending} className="flex-1">
              <Save className="mr-1.5 h-3 w-3" /> {update.isPending ? "Saving…" : "Save geometry"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Geometry viewer with live ride-height visual ─────────── */
function GeometryViewer({ form }: { form: GeoForm }) {
  // Map ride height (40-180mm) to a visual offset in viewer coords
  const fOff = (form.ride_height_front_mm - 130) * 0.3;
  const rOff = (form.ride_height_rear_mm - 135) * 0.3;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface-0 shadow-elevated">
      <div className="relative h-[460px]">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_55%,hsl(188_95%_55%/0.10),transparent_70%)]" />

        <svg viewBox="0 0 1000 460" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="gShade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(188 95% 55%)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="hsl(220 70% 25%)" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <line x1="60" y1="380" x2="940" y2="380" stroke="hsl(188 95% 55%)" strokeWidth="0.6" strokeDasharray="3 4" opacity="0.4" />
          <text x="60" y="396" fill="hsl(215 14% 58%)" style={{ font: "10px 'JetBrains Mono', monospace" }}>z = 0 · ground plane</text>

          {/* Body — adjusts vertical offset based on average ride */}
          <g transform={`translate(0, ${(fOff + rOff) / 2})`}>
            <path d={`M180,${330 + fOff} L240,${290 + fOff} L380,${260 + fOff} L560,${250 + (fOff+rOff)/2} L700,${270 + rOff} L800,${295 + rOff} L880,${330 + rOff} L180,${330 + fOff} Z`}
              fill="url(#gShade)" stroke="hsl(188 95% 55%)" strokeWidth="1.2" />
            <path d={`M380,${260 + fOff} L500,${232 + (fOff+rOff)/2} L620,${238 + rOff} L700,${260 + rOff} Z`}
              fill="hsl(220 24% 11%)" stroke="hsl(188 95% 55%)" strokeWidth="0.8" opacity="0.85" />
            {/* underbody indicator */}
            {form.underbody_model === "detailed" ? (
              <path d={`M220,${360 + (fOff+rOff)/2} L860,${360 + (fOff+rOff)/2} L860,${376 + (fOff+rOff)/2} L220,${376 + (fOff+rOff)/2} Z`}
                fill="hsl(188 95% 55% / 0.20)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
            ) : (
              <path d={`M220,${360 + (fOff+rOff)/2} L860,${360 + (fOff+rOff)/2} L860,${376 + (fOff+rOff)/2} L220,${376 + (fOff+rOff)/2} Z`}
                fill="hsl(38 95% 58% / 0.10)" stroke="hsl(38 95% 58%)" strokeWidth="0.8" strokeDasharray="3 3" />
            )}
            {/* wheels */}
            <circle cx="290" cy={335 + fOff} r="30" fill="hsl(220 26% 6%)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
            <circle cx="290" cy={335 + fOff} r="14" fill="hsl(220 24% 10%)" />
            {form.wheel_rotation === "rotating" && (
              <line x1={290 - 14} y1={335 + fOff} x2={290 + 14} y2={335 + fOff} stroke="hsl(188 95% 55%)" strokeWidth="1" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from={`0 290 ${335 + fOff}`} to={`360 290 ${335 + fOff}`} dur="0.8s" repeatCount="indefinite" />
              </line>
            )}
            <circle cx="780" cy={335 + rOff} r="30" fill="hsl(220 26% 6%)" stroke="hsl(188 95% 55%)" strokeWidth="1" />
            <circle cx="780" cy={335 + rOff} r="14" fill="hsl(220 24% 10%)" />
            {form.wheel_rotation === "rotating" && (
              <line x1={780 - 14} y1={335 + rOff} x2={780 + 14} y2={335 + rOff} stroke="hsl(188 95% 55%)" strokeWidth="1" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from={`0 780 ${335 + rOff}`} to={`360 780 ${335 + rOff}`} dur="0.8s" repeatCount="indefinite" />
              </line>
            )}
          </g>

          {/* Ride height callouts */}
          <g style={{ font: "10px 'JetBrains Mono', monospace" }}>
            <line x1="200" y1={358 + fOff} x2="200" y2="380" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
            <text x="170" y="375" fill="hsl(38 95% 58%)">F {form.ride_height_front_mm}</text>
            <line x1="860" y1={358 + rOff} x2="860" y2="380" stroke="hsl(38 95% 58%)" strokeWidth="0.6" />
            <text x="868" y="375" fill="hsl(38 95% 58%)">R {form.ride_height_rear_mm}</text>
          </g>
        </svg>

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <StatusChip tone="success" size="sm">Mesh ready</StatusChip>
          <StatusChip tone={form.underbody_model === "simplified" ? "warning" : "success"} size="sm">
            Underbody · {form.underbody_model}
          </StatusChip>
        </div>
        <div className="absolute top-3 right-3 flex items-center gap-3 rounded-md border border-border bg-surface-1/80 px-3 py-1.5 backdrop-blur text-mono text-[10px]">
          <div><span className="text-muted-foreground">Wheels </span><span className="text-foreground">{form.wheel_rotation}</span></div>
          <div><span className="text-muted-foreground">Solve </span><span className="text-foreground">{form.steady_state ? "RANS" : "URANS"}</span></div>
        </div>
      </div>
    </div>
  );
}

function SourceFooter({ geometry }: { geometry: Geometry }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden">
      <div className="bg-surface-1 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
            <Box className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Source</div>
            <div className="text-mono text-[11px] text-foreground capitalize">{geometry.source}</div>
          </div>
        </div>
      </div>
      <div className="bg-surface-1 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
            <Move3d className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Origin</div>
            <div className="text-mono text-[11px] text-foreground">Front-axle · ground · centre</div>
          </div>
        </div>
      </div>
      <div className="bg-surface-1 p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
            {geometry.stl_path ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Info className="h-3.5 w-3.5" />}
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">STL upload</div>
            <div className="text-mono text-[11px] text-foreground">{geometry.stl_path ? "Custom mesh" : "Template baseline"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Geometry;
