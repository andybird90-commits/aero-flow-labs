/**
 * AeroAnchorNudge — per-component manual offset (X / Y / Z in cm) for fine
 * adjustment when the auto-anchor is slightly off on an uploaded mesh.
 *
 * Saved into the component's `params` jsonb as `nudge_x`, `nudge_y`,
 * `nudge_z` (metres). Applied on top of the computed anchor in the 3D viewer.
 */
import { useAuth } from "@/hooks/useAuth";
import { useUpsertComponent, type AeroComponent } from "@/lib/repo";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Move3d, RefreshCw, ChevronsLeftRight, ArrowUpDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<string, string> = {
  splitter: "Splitter",
  wing: "Rear wing",
  diffuser: "Diffuser",
  skirts: "Side skirts",
  canards: "Canards",
  ducktail: "Ducktail",
};

interface Props {
  components: AeroComponent[];
  /** When false (no uploaded mesh), the panel renders an info hint instead. */
  meshLoaded: boolean;
}

export function AeroAnchorNudge({ components, meshLoaded }: Props) {
  const { user } = useAuth();
  const upsert = useUpsertComponent();
  const enabled = components.filter((c) => c.enabled);

  if (!meshLoaded) {
    return (
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Move3d className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Anchor nudge</h3>
        </div>
        <p className="text-mono text-[10px] text-muted-foreground leading-relaxed">
          Upload a custom mesh on the Geometry page to fine-tune where each aero
          part attaches to your specific car.
        </p>
      </div>
    );
  }

  if (enabled.length === 0) {
    return (
      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Move3d className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Anchor nudge</h3>
        </div>
        <p className="text-mono text-[10px] text-muted-foreground leading-relaxed">
          Enable an aero part on the Parts page to nudge its position on the car.
        </p>
      </div>
    );
  }

  const patch = (c: AeroComponent, axis: "x" | "y" | "z", value: number) => {
    if (!user) return;
    const key = `nudge_${axis}` as const;
    const nextParams = {
      ...((c.params as object) ?? {}),
      [key]: value,
    };
    upsert.mutate({
      userId: user.id,
      variantId: c.variant_id,
      id: c.id,
      kind: c.kind,
      params: nextParams,
      enabled: c.enabled,
    });
  };

  const reset = (c: AeroComponent) => {
    if (!user) return;
    const p = { ...((c.params as object) ?? {}) } as any;
    delete p.nudge_x;
    delete p.nudge_y;
    delete p.nudge_z;
    upsert.mutate({
      userId: user.id,
      variantId: c.variant_id,
      id: c.id,
      kind: c.kind,
      params: p,
      enabled: c.enabled,
    });
  };

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Move3d className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Anchor nudge</h3>
        </div>
        <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          ± 30 cm
        </span>
      </div>

      <div className="divide-y divide-border/60">
        {enabled.map((c) => (
          <NudgeRow
            key={c.id}
            component={c}
            onPatch={patch}
            onReset={() => reset(c)}
          />
        ))}
      </div>
    </div>
  );
}

function NudgeRow({
  component,
  onPatch,
  onReset,
}: {
  component: AeroComponent;
  onPatch: (c: AeroComponent, axis: "x" | "y" | "z", v: number) => void;
  onReset: () => void;
}) {
  const p = (component.params as any) ?? {};
  const x = typeof p.nudge_x === "number" ? p.nudge_x : 0;
  const y = typeof p.nudge_y === "number" ? p.nudge_y : 0;
  const z = typeof p.nudge_z === "number" ? p.nudge_z : 0;
  const dirty = x !== 0 || y !== 0 || z !== 0;

  const axes: { key: "x" | "y" | "z"; label: string; icon: any; value: number }[] = [
    { key: "x", label: "Fwd / back", icon: ChevronsLeftRight, value: x },
    { key: "y", label: "Up / down", icon: ArrowUpDown, value: y },
    { key: "z", label: "Left / right", icon: ChevronsUpDown, value: z },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          {KIND_LABELS[component.kind] ?? component.kind}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!dirty}
          className="h-6 text-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Reset
        </Button>
      </div>

      <div className="space-y-2">
        {axes.map(({ key, label, icon: Icon, value }) => (
          <div key={key} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 w-24 shrink-0">
              <Icon className="h-3 w-3 text-muted-foreground" />
              <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {label}
              </span>
            </div>
            <Slider
              value={[Math.round(value * 100)]}
              min={-30}
              max={30}
              step={1}
              onValueChange={(v) => onPatch(component, key, v[0] / 100)}
              className="flex-1"
            />
            <span
              className={cn(
                "text-mono text-[11px] tabular-nums w-12 text-right shrink-0",
                value !== 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {(value * 100).toFixed(0)} cm
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
