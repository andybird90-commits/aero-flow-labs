/**
 * Aero Parts page
 * ───────────────
 * • Variant picker (?v= URL param) — selects which variant's components are edited.
 * • Optimistic enable/disable + per-parameter editing of aero_components rows.
 * • Add/remove parts. Surrogate-aero estimator gives instant deltas.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ParamSlider } from "@/components/ParamSlider";
import { StatusChip } from "@/components/StatusChip";
import { LoadingState } from "@/components/LoadingState";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, RotateCcw, Wind, Layers, Wrench, Sparkles, ChevronDown,
  ArrowUpRight, Move3d, Grid3x3, Minus, ChevronRight, AlertTriangle,
  Save, PlayCircle,
} from "lucide-react";
import {
  useVariants, useComponents, useUpsertComponent, useDeleteComponent,
  useGeometry, type AeroComponent,
} from "@/lib/repo";
import { estimateAero, aeroDelta } from "@/lib/aero-estimator";
import { cn } from "@/lib/utils";

/* ─── Part schema (kind → param defs) ───────────────────────── */
type ParamDef = { key: string; label: string; min: number; max: number; default: number; unit: string; hint?: string };

interface KindDef {
  kind: string;
  name: string;
  group: "Front" | "Sides" | "Rear" | "Underbody" | "Stance";
  icon: typeof Wind;
  params: ParamDef[];
  defaultParams: Record<string, number | boolean>;
}

const KINDS: KindDef[] = [
  {
    kind: "splitter", name: "Front splitter", group: "Front", icon: Layers,
    params: [
      { key: "splProtrusion", label: "Protrusion",  min: 20, max: 120, default: 60, unit: "mm" },
      { key: "splDepth",      label: "Depth (under)", min: 30, max: 220, default: 110, unit: "mm" },
      { key: "splWidth",      label: "Width",       min: 1400, max: 1900, default: 1740, unit: "mm" },
    ],
    defaultParams: { splProtrusion: 60, splDepth: 110, splWidth: 1740 },
  },
  {
    kind: "canards", name: "Canards", group: "Front", icon: ChevronRight,
    params: [
      { key: "canWidth", label: "Element width", min: 80, max: 260, default: 180, unit: "mm" },
      { key: "canAngle", label: "Incidence", min: 0, max: 22, default: 12, unit: "°", hint: "stall ~18°" },
      { key: "canHeight", label: "Height on bumper", min: 200, max: 600, default: 380, unit: "mm" },
      { key: "elements", label: "Pairs", min: 1, max: 3, default: 1, unit: "" },
    ],
    defaultParams: { canWidth: 180, canAngle: 12, canHeight: 380, elements: 1 },
  },
  {
    kind: "skirts", name: "Side skirts", group: "Sides", icon: Minus,
    params: [
      { key: "skDepth", label: "Skirt depth", min: 20, max: 140, default: 70, unit: "mm" },
      { key: "skLength", label: "Length coverage", min: 60, max: 100, default: 90, unit: "%" },
      { key: "skSeal", label: "Floor seal gap", min: 0, max: 40, default: 8, unit: "mm" },
    ],
    defaultParams: { skDepth: 70, skLength: 90, skSeal: 8 },
  },
  {
    kind: "wing", name: "Rear wing", group: "Rear", icon: Wind,
    params: [
      { key: "chord", label: "Chord length", min: 180, max: 380, default: 280, unit: "mm" },
      { key: "aoa", label: "Angle of attack", min: 0, max: 18, default: 8, unit: "°", hint: "stall ~14°" },
      { key: "elements", label: "Number of elements", min: 1, max: 3, default: 2, unit: "" },
      { key: "gurney", label: "Gurney flap height", min: 0, max: 30, default: 12, unit: "mm" },
      { key: "mount", label: "Mount height (deck)", min: 50, max: 250, default: 120, unit: "mm" },
      { key: "span", label: "Span", min: 1200, max: 1600, default: 1480, unit: "mm" },
    ],
    defaultParams: { chord: 280, aoa: 8, elements: 2, gurney: 12, mount: 120, span: 1480 },
  },
  {
    kind: "ducktail", name: "Ducktail", group: "Rear", icon: ArrowUpRight,
    params: [
      { key: "duckHeight", label: "Lip height", min: 10, max: 80, default: 38, unit: "mm" },
      { key: "duckAngle", label: "Trailing angle", min: 0, max: 24, default: 12, unit: "°" },
    ],
    defaultParams: { duckHeight: 38, duckAngle: 12 },
  },
  {
    kind: "diffuser", name: "Rear diffuser", group: "Underbody", icon: Layers,
    params: [
      { key: "diffAngle", label: "Diffuser angle", min: 4, max: 18, default: 11, unit: "°", hint: "stall ~15°" },
      { key: "diffLength", label: "Length", min: 400, max: 1100, default: 780, unit: "mm" },
      { key: "diffStrakes", label: "Strakes", min: 0, max: 6, default: 4, unit: "" },
    ],
    defaultParams: { diffAngle: 11, diffLength: 780, diffStrakes: 4 },
  },
  {
    kind: "underbody", name: "Underbody aids", group: "Underbody", icon: Grid3x3,
    params: [
      { key: "ubCoverage", label: "Floor coverage", min: 40, max: 100, default: 85, unit: "%" },
      { key: "ubNACA", label: "NACA ducts", min: 0, max: 4, default: 2, unit: "" },
    ],
    defaultParams: { ubCoverage: 85, ubNACA: 2 },
  },
];

const KIND_BY = Object.fromEntries(KINDS.map((k) => [k.kind, k]));

const GROUP_ORDER: KindDef["group"][] = ["Front", "Sides", "Rear", "Underbody", "Stance"];

/* ─── Presets — seed sets of components ─────────────────────── */
const PRESETS: { id: string; name: string; sub: string; icon: typeof Wind; kinds: string[] }[] = [
  { id: "road",    name: "Fast Road",    sub: "Comfort · low drag",      icon: Wind,         kinds: ["splitter"] },
  { id: "track",   name: "Track Day",    sub: "Balanced grip",           icon: Wrench,       kinds: ["splitter", "canards", "wing", "diffuser", "underbody"] },
  { id: "topspd",  name: "High-speed",   sub: "Low Cd · stability",      icon: ArrowUpRight, kinds: ["splitter", "ducktail", "underbody"] },
  { id: "rear",    name: "Max Rear",     sub: "Aggressive wing",         icon: Wind,         kinds: ["wing", "diffuser", "skirts"] },
];

const Parts = () => (
  <WorkspaceShell>
    {(ctx) => <PartsContent buildId={ctx.buildId!} />}
  </WorkspaceShell>
);

function PartsContent({ buildId }: { buildId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useSearchParams();
  const queryV = search.get("v");

  const { data: variants = [], isLoading: variantsLoading } = useVariants(buildId);
  const { data: geometry } = useGeometry(buildId);

  // Choose variant
  const activeVariant =
    variants.find((v) => v.id === queryV) ??
    variants.find((v) => !v.is_baseline) ??
    variants[0];

  useEffect(() => {
    if (activeVariant && activeVariant.id !== queryV) {
      const next = new URLSearchParams(search);
      next.set("v", activeVariant.id);
      setSearch(next, { replace: true });
    }
  }, [activeVariant?.id, queryV, search, setSearch]);

  const { data: components = [], isLoading: compsLoading } = useComponents(activeVariant?.id);
  const upsert = useUpsertComponent();
  const del = useDeleteComponent();

  const baseline = variants.find((v) => v.is_baseline);
  const { data: baselineComponents = [] } = useComponents(baseline?.id);

  const baselineEst = useMemo(
    () => estimateAero(baselineComponents, geometry),
    [baselineComponents, geometry],
  );
  const currentEst = useMemo(
    () => estimateAero(components, geometry),
    [components, geometry],
  );
  const delta = aeroDelta(currentEst, baselineEst);

  const [activeKind, setActiveKind] = useState<string | null>(null);
  const activeComponent = components.find((c) => c.kind === activeKind);
  const activeKindDef = activeKind ? KIND_BY[activeKind] : null;

  // Pick first present kind by default
  useEffect(() => {
    if (!activeKind && components.length) setActiveKind(components[0].kind);
  }, [components.length, activeKind]);

  if (variantsLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <LoadingState label="Loading variants" />
      </div>
    );
  }

  if (!activeVariant) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <div className="glass rounded-xl p-8 text-center">
          <Wrench className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold">No variant to edit</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create a variant from the build overview first.</p>
          <Button className="mt-4" variant="hero" size="sm" asChild>
            <Link to={`/build?id=${buildId}`}>Go to overview</Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ─── Mutations ────────────────────────────────────────── */
  const toggleKind = async (kind: string, enabled: boolean) => {
    if (!user) return;
    const existing = components.find((c) => c.kind === kind);
    try {
      if (existing) {
        await upsert.mutateAsync({
          userId: user.id, variantId: activeVariant.id,
          id: existing.id, kind, params: existing.params, enabled,
        });
      } else {
        const def = KIND_BY[kind];
        await upsert.mutateAsync({
          userId: user.id, variantId: activeVariant.id,
          kind, params: def.defaultParams, enabled,
        });
      }
    } catch (e: any) {
      toast({ title: "Couldn't update", description: e.message, variant: "destructive" });
    }
  };

  const updateParam = async (component: AeroComponent, key: string, value: number) => {
    if (!user) return;
    const newParams = { ...(component.params as object), [key]: value };
    try {
      await upsert.mutateAsync({
        userId: user.id, variantId: activeVariant.id,
        id: component.id, kind: component.kind, params: newParams, enabled: component.enabled,
      });
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    }
  };

  const removePart = async (id: string) => {
    try {
      await del.mutateAsync(id);
      toast({ title: "Part removed" });
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
    }
  };

  const applyPreset = async (presetId: string) => {
    if (!user) return;
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    try {
      // Disable all current components, then enable preset kinds (creating any missing)
      for (const c of components) {
        const enabled = preset.kinds.includes(c.kind);
        if (c.enabled !== enabled) {
          await upsert.mutateAsync({
            userId: user.id, variantId: activeVariant.id,
            id: c.id, kind: c.kind, params: c.params, enabled,
          });
        }
      }
      for (const kind of preset.kinds) {
        if (!components.find((c) => c.kind === kind)) {
          const def = KIND_BY[kind];
          if (def) {
            await upsert.mutateAsync({
              userId: user.id, variantId: activeVariant.id,
              kind, params: def.defaultParams, enabled: true,
            });
          }
        }
      }
      toast({ title: `Applied "${preset.name}" preset` });
    } catch (e: any) {
      toast({ title: "Couldn't apply preset", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 md:px-6 py-6 space-y-6">
      {/* Variant picker + delta strip */}
      <div className="glass rounded-xl flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Editing</span>
          <select
            value={activeVariant.id}
            onChange={(e) => {
              const next = new URLSearchParams(search);
              next.set("v", e.target.value);
              setSearch(next, { replace: true });
              setActiveKind(null);
            }}
            className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground"
          >
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{v.is_baseline ? " · baseline" : ""}
              </option>
            ))}
          </select>
          <StatusChip tone="preview" size="sm">{components.filter(c => c.enabled).length} active parts</StatusChip>
        </div>

        <div className="flex items-center gap-4 text-mono text-[11px]">
          <DeltaPill label="ΔDF" value={delta.dfTotal} unit="kgf" goodPositive />
          <DeltaPill label="ΔDrag" value={delta.drag} unit="kgf" goodPositive={false} />
          <DeltaPill label="ΔL/D" value={delta.ld} unit="" goodPositive />
          <Button variant="hero" size="sm" asChild>
            <Link to={`/simulation?id=${buildId}&v=${activeVariant.id}`}>
              <PlayCircle className="mr-2 h-3.5 w-3.5" /> Run sim
            </Link>
          </Button>
        </div>
      </div>

      {/* Presets */}
      <div className="glass rounded-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold tracking-tight">Preset packages</h3>
          </div>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            One-click baseline
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
          {PRESETS.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className="group rounded-lg border border-border bg-surface-1 hover:border-primary/30 p-3 text-left transition-all"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    <div className="text-mono text-[10px] text-muted-foreground truncate">{p.sub}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT — categories */}
        <div className="lg:col-span-4">
          <div className="glass rounded-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold tracking-tight">Aero parts</h3>
              </div>
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {KINDS.length} kinds
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3 max-h-[700px]">
              {GROUP_ORDER.map((group) => {
                const items = KINDS.filter((k) => k.group === group);
                if (!items.length) return null;
                return (
                  <div key={group}>
                    <div className="px-2 py-1 text-mono text-[9px] uppercase tracking-widest text-muted-foreground/70">
                      {group}
                    </div>
                    <div className="space-y-1">
                      {items.map((k) => {
                        const Icon = k.icon;
                        const comp = components.find((c) => c.kind === k.kind);
                        const isActive = activeKind === k.kind;
                        const enabled = comp?.enabled ?? false;

                        return (
                          <div
                            key={k.kind}
                            onClick={() => setActiveKind(k.kind)}
                            className={cn(
                              "group cursor-pointer rounded-md border px-2.5 py-2 transition-all",
                              isActive
                                ? "border-primary/40 bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
                                : "border-transparent hover:border-border hover:bg-surface-2/60",
                            )}
                          >
                            <div className="flex items-center gap-2.5">
                              <Switch
                                checked={enabled}
                                onCheckedChange={(v) => toggleKind(k.kind, v)}
                                onClick={(e) => e.stopPropagation()}
                                className="data-[state=checked]:bg-primary scale-75 -ml-1"
                              />
                              <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                              <div className="min-w-0 flex-1">
                                <div className={cn("text-sm truncate", !enabled && "text-muted-foreground")}>
                                  {k.name}
                                </div>
                                <div className="text-mono text-[10px] text-muted-foreground tabular-nums">
                                  {comp ? (enabled ? "Active" : "Off") : "Not added"}
                                </div>
                              </div>
                              {comp && enabled && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); removePart(comp.id); }}
                                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border px-4 py-2.5 text-mono text-[10px] text-muted-foreground flex items-center justify-between">
              <span>{components.filter(c => c.enabled).length} of {KINDS.length} enabled</span>
              <span className="text-primary">⌀ {currentEst.df_total_kgf} kgf DF</span>
            </div>
          </div>
        </div>

        {/* RIGHT — editor */}
        <div className="lg:col-span-8">
          {activeKindDef ? (
            <ComponentEditor
              kindDef={activeKindDef}
              component={activeComponent}
              onParamChange={(key, v) => {
                if (!activeComponent) {
                  // Auto-add the part with overridden value
                  toggleKind(activeKindDef.kind, true);
                  return;
                }
                updateParam(activeComponent, key, v);
              }}
              onAdd={() => toggleKind(activeKindDef.kind, true)}
              isPending={upsert.isPending}
            />
          ) : (
            <div className="glass rounded-xl p-12 text-center">
              <Wrench className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold">Pick an aero part</h3>
              <p className="mt-1 text-mono text-[11px] text-muted-foreground">Select a part on the left to edit its parameters.</p>
            </div>
          )}
        </div>
      </div>

      {!activeVariant.results || activeVariant.status !== "completed" ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/5 p-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-sm">
            Showing surrogate (instant) predictions. Run the CFD solver for solver-backed deltas.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ComponentEditor({
  kindDef, component, onParamChange, onAdd, isPending,
}: {
  kindDef: KindDef;
  component: AeroComponent | undefined;
  onParamChange: (key: string, v: number) => void;
  onAdd: () => void;
  isPending: boolean;
}) {
  const Icon = kindDef.icon;
  const params = (component?.params ?? kindDef.defaultParams) as Record<string, number>;

  return (
    <div className="glass rounded-xl flex flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{kindDef.name}</h3>
            <div className="text-mono text-[10px] text-muted-foreground">{kindDef.group}</div>
          </div>
        </div>
        {!component && (
          <Button variant="hero" size="sm" onClick={onAdd} disabled={isPending}>
            <Plus className="mr-1.5 h-3 w-3" /> Add to variant
          </Button>
        )}
        {component && !component.enabled && (
          <StatusChip tone="warning" size="sm">Disabled</StatusChip>
        )}
        {component?.enabled && isPending && (
          <span className="text-mono text-[10px] text-muted-foreground">saving…</span>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {kindDef.params.map((p) => (
          <ParamSlider
            key={p.key}
            label={p.label}
            value={Number(params[p.key] ?? p.default)}
            min={p.min}
            max={p.max}
            unit={p.unit ? ` ${p.unit}` : ""}
            hint={p.hint}
            onChange={(v) => onParamChange(p.key, v)}
          />
        ))}
        {!component && (
          <p className="text-mono text-[10px] text-muted-foreground text-center">
            Adjusting any value will add this part to the variant.
          </p>
        )}
      </div>
    </div>
  );
}

function DeltaPill({
  label, value, unit, goodPositive,
}: { label: string; value: number; unit: string; goodPositive: boolean }) {
  const positive = value > 0;
  const isGood = positive === goodPositive;
  const tone =
    value === 0 ? "text-muted-foreground" :
    isGood ? "text-success" : "text-destructive";
  return (
    <div className="flex items-center gap-2">
      <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className={cn("text-mono tabular-nums", tone)}>
        {value > 0 ? "+" : ""}{value}{unit && <span className="text-muted-foreground ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

export default Parts;
