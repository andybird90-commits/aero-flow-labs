/**
 * PaintStudioPopover — UI for editing the donor car's paint finish.
 *
 * Lives in the Build Studio toolbar. Users can pick a colour, fine-tune the
 * material (metalness / roughness / clearcoat) and swap the HDRI environment
 * preset to change reflections. Changes apply live and are debounced-saved
 * to projects.paint_finish so the look survives reloads.
 */
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Palette, RotateCcw } from "lucide-react";
import {
  DEFAULT_PAINT_FINISH,
  ENV_PRESET_OPTIONS,
  PAINT_PRESETS,
  type EnvPreset,
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={disabled}
        >
          <span
            className="h-3 w-3 rounded-full border border-border shadow-inner"
            style={{ backgroundColor: finish.color }}
          />
          <Palette className="h-3 w-3" />
          Paint
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[320px] space-y-4 p-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Paint Studio
            </div>
            <h3 className="text-sm font-semibold">Donor body finish</h3>
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onChange({ ...DEFAULT_PAINT_FINISH })}
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>

        {/* Colour + presets */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={finish.color}
              onChange={(e) => patch({ color: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
              aria-label="Paint colour"
            />
            <input
              type="text"
              value={finish.color}
              onChange={(e) => patch({ color: e.target.value })}
              className="text-mono h-9 flex-1 rounded border border-border bg-background px-2 text-xs uppercase"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PAINT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => onChange({ ...finish, ...p.finish })}
                className="group flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                title={p.name}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full border border-border/60"
                  style={{ backgroundColor: p.finish.color ?? "#000" }}
                />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Material sliders */}
        <div className="space-y-3">
          <SliderRow
            label="Metalness"
            value={finish.metalness}
            onChange={(v) => patch({ metalness: v })}
          />
          <SliderRow
            label="Roughness"
            value={finish.roughness}
            onChange={(v) => patch({ roughness: v })}
          />
          <SliderRow
            label="Clearcoat"
            value={finish.clearcoat}
            onChange={(v) => patch({ clearcoat: v })}
          />
          <SliderRow
            label="Clearcoat roughness"
            value={finish.clearcoat_roughness}
            onChange={(v) => patch({ clearcoat_roughness: v })}
          />
        </div>

        <Separator />

        {/* Environment */}
        <div className="space-y-2">
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Environment
          </div>
          <Select
            value={finish.env_preset}
            onValueChange={(v) => patch({ env_preset: v as EnvPreset })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENV_PRESET_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SliderRow
            label="Reflection intensity"
            value={finish.env_intensity}
            min={0}
            max={3}
            step={0.05}
            onChange={(v) => patch({ env_intensity: v })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-mono text-xs tabular-nums text-foreground">
          {value.toFixed(2)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
