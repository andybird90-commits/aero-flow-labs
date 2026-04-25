/**
 * PaintStudioPopover — Tier 2 multi-material paint editor.
 *
 * Tabs let you paint the body, wheels, tyres, and glass independently. The
 * server-side classifier tags every triangle of the hero STL once and the
 * viewport applies each material to its own region — so painting the body
 * never recolours the rims, glass stays smoky and translucent, and tyres
 * stay rubber-black by default.
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Palette, RotateCcw } from "lucide-react";
import {
  DEFAULT_PAINT_FINISH,
  DEFAULT_GLASS_FINISH,
  DEFAULT_TYRE_FINISH,
  DEFAULT_WHEEL_FINISH,
  ENV_PRESET_OPTIONS,
  PAINT_PRESETS,
  WHEEL_PRESETS,
  type EnvPreset,
  type MaterialFinish,
  type PaintFinish,
} from "@/lib/build-studio/paint-finish";

interface Props {
  finish: PaintFinish;
  onChange: (next: PaintFinish) => void;
  disabled?: boolean;
}

export function PaintStudioPopover({ finish, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<PaintFinish>) => onChange({ ...finish, ...p });
  const wheels = finish.wheels ?? DEFAULT_WHEEL_FINISH;
  const tyres = finish.tyres ?? DEFAULT_TYRE_FINISH;
  const glass = finish.glass ?? DEFAULT_GLASS_FINISH;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={disabled}>
          <span className="h-3 w-3 rounded-full border border-border shadow-inner" style={{ backgroundColor: finish.color }} />
          <Palette className="h-3 w-3" />
          Paint
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" sideOffset={6} className="w-[340px] space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Paint Studio</div>
            <h3 className="text-sm font-semibold">Multi-material finish</h3>
          </div>
          <Button size="xs" variant="ghost" onClick={() => onChange({ ...DEFAULT_PAINT_FINISH })} className="text-muted-foreground">
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>

        <Tabs defaultValue="body" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-8">
            <TabsTrigger value="body" className="text-[11px]">Body</TabsTrigger>
            <TabsTrigger value="wheels" className="text-[11px]">Wheels</TabsTrigger>
            <TabsTrigger value="tyres" className="text-[11px]">Tyres</TabsTrigger>
            <TabsTrigger value="glass" className="text-[11px]">Glass</TabsTrigger>
          </TabsList>

          <TabsContent value="body" className="space-y-3 pt-3">
            <ColorRow color={finish.color} onChange={(c) => patch({ color: c })} />
            <div className="flex flex-wrap gap-1.5">
              {PAINT_PRESETS.map((p) => (
                <PresetChip key={p.name} name={p.name} color={p.finish.color ?? "#000"} onClick={() => onChange({ ...finish, ...p.finish })} />
              ))}
            </div>
            <Separator />
            <SliderRow label="Metalness" value={finish.metalness} onChange={(v) => patch({ metalness: v })} />
            <SliderRow label="Roughness" value={finish.roughness} onChange={(v) => patch({ roughness: v })} />
            <SliderRow label="Clearcoat" value={finish.clearcoat} onChange={(v) => patch({ clearcoat: v })} />
            <SliderRow label="Clearcoat roughness" value={finish.clearcoat_roughness} onChange={(v) => patch({ clearcoat_roughness: v })} />
          </TabsContent>

          <TabsContent value="wheels" className="space-y-3 pt-3">
            <ColorRow color={wheels.color} onChange={(c) => patch({ wheels: { ...wheels, color: c } })} />
            <div className="flex flex-wrap gap-1.5">
              {WHEEL_PRESETS.map((p) => (
                <PresetChip key={p.name} name={p.name} color={p.finish.color} onClick={() => patch({ wheels: { ...p.finish } })} />
              ))}
            </div>
            <Separator />
            <SliderRow label="Metalness" value={wheels.metalness} onChange={(v) => patch({ wheels: { ...wheels, metalness: v } })} />
            <SliderRow label="Roughness" value={wheels.roughness} onChange={(v) => patch({ wheels: { ...wheels, roughness: v } })} />
            <SliderRow label="Clearcoat" value={wheels.clearcoat} onChange={(v) => patch({ wheels: { ...wheels, clearcoat: v } })} />
          </TabsContent>

          <TabsContent value="tyres" className="space-y-3 pt-3">
            <p className="text-[11px] text-muted-foreground">Tyres default to matte rubber black. Tweak the finish if you want a tyre-shine look.</p>
            <ColorRow color={tyres.color} onChange={(c) => patch({ tyres: { ...tyres, color: c } })} />
            <Separator />
            <SliderRow label="Roughness" value={tyres.roughness} onChange={(v) => patch({ tyres: { ...tyres, roughness: v } })} />
            <SliderRow label="Clearcoat (shine)" value={tyres.clearcoat} onChange={(v) => patch({ tyres: { ...tyres, clearcoat: v } })} />
          </TabsContent>

          <TabsContent value="glass" className="space-y-3 pt-3">
            <p className="text-[11px] text-muted-foreground">Glass uses physical transmission so reflections + tint read correctly.</p>
            <ColorRow color={glass.color} onChange={(c) => patch({ glass: { ...glass, color: c } })} />
            <Separator />
            <SliderRow label="Tint opacity" value={glass.opacity ?? 0.55} onChange={(v) => patch({ glass: { ...glass, opacity: v } })} />
            <SliderRow label="Roughness" value={glass.roughness} onChange={(v) => patch({ glass: { ...glass, roughness: v } })} />
          </TabsContent>
        </Tabs>

        <Separator />

        <div className="space-y-2">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Environment</div>
          <Select value={finish.env_preset} onValueChange={(v) => patch({ env_preset: v as EnvPreset })}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENV_PRESET_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SliderRow label="Reflection intensity" value={finish.env_intensity} min={0} max={3} step={0.05} onChange={(v) => patch({ env_intensity: v })} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColorRow({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={color} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent" />
      <input type="text" value={color} onChange={(e) => onChange(e.target.value)} className="text-mono h-9 flex-1 rounded border border-border bg-background px-2 text-xs uppercase" spellCheck={false} />
    </div>
  );
}

function PresetChip({ name, color, onClick }: { name: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground" title={name}>
      <span className="h-2.5 w-2.5 rounded-full border border-border/60" style={{ backgroundColor: color }} />
      {name}
    </button>
  );
}

function SliderRow({ label, value, onChange, min = 0, max = 1, step = 0.01 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-mono text-xs tabular-nums text-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
