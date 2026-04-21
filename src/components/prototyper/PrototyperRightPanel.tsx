/**
 * Right panel — mode-aware controls.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  MOUNT_ZONES, PART_CATEGORIES,
  type MountZone, type PartCategory, type PartSide,
} from "@/lib/prototyper/mount-zones";
import type { PrototyperMode } from "./ModeSwitcher";
import type { FrozenPart } from "@/lib/prototyper/frozen-parts";
import type { PlacementInstance } from "@/lib/prototyper/transforms";
import {
  Sparkles, Save, Copy, FlipHorizontal, ArrowLeftRight, Lock, Unlock, Trash2, Loader2,
} from "lucide-react";

interface FreezeDraft {
  name: string;
  category: PartCategory;
  mount_zone: MountZone;
  side: PartSide;
  symmetry_allowed: boolean;
  silhouette_locked: boolean;
}

interface Props {
  mode: PrototyperMode;
  busy?: boolean;

  // Generate
  prompt: string;
  onPromptChange: (s: string) => void;
  stylePreset: string;
  onStylePresetChange: (s: string) => void;
  targetZone: MountZone;
  onTargetZoneChange: (z: MountZone) => void;
  aggression: number;
  onAggressionChange: (n: number) => void;
  onGenerate: () => void;

  // Freeze
  hasProposedMask: boolean;
  freezeDraft: FreezeDraft;
  onFreezeDraftChange: (patch: Partial<FreezeDraft>) => void;
  onResetMask: () => void;
  onSaveFrozenPart: () => void;

  // Place
  selectedFrozenPart: FrozenPart | null;
  selectedInstance: PlacementInstance | null;
  onClone: () => void;
  onMirror: () => void;
  onSnapOpposite: () => void;
  onLockToggle: () => void;
  onDeleteInstance: () => void;
  onUpdateInstanceTransform: (patch: Partial<PlacementInstance["transform"]>) => void;
  onAddInstanceFromSelected: () => void;
  onApproveOverlay: () => void;
}

export function PrototyperRightPanel(props: Props) {
  const { mode, busy } = props;

  if (mode === "generate") {
    return (
      <div className="space-y-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Generate</div>
        <div className="space-y-1.5">
          <Label>Style preset</Label>
          <Select value={props.stylePreset} onValueChange={props.onStylePresetChange}>
            <SelectTrigger><SelectValue placeholder="Pick a preset" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="time_attack">Time Attack</SelectItem>
              <SelectItem value="gt_track">GT / Track</SelectItem>
              <SelectItem value="street">Street</SelectItem>
              <SelectItem value="widebody">Widebody</SelectItem>
              <SelectItem value="rally">Rally</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Target zone</Label>
          <Select value={props.targetZone} onValueChange={(v) => props.onTargetZoneChange(v as MountZone)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MOUNT_ZONES.map((z) => (
                <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Prompt</Label>
          <Textarea
            value={props.prompt}
            onChange={(e) => props.onPromptChange(e.target.value)}
            placeholder="e.g. aggressive side scoop with single intake, carbon"
            rows={3}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Aggression</Label>
            <span className="text-xs text-muted-foreground">{props.aggression}%</span>
          </div>
          <Slider
            value={[props.aggression]}
            onValueChange={([v]) => props.onAggressionChange(v)}
            min={0} max={100} step={5}
          />
        </div>
        <Button className="w-full" onClick={props.onGenerate} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Generate variations
        </Button>
      </div>
    );
  }

  if (mode === "freeze") {
    const d = props.freezeDraft;
    return (
      <div className="space-y-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Freeze part</div>
        {!props.hasProposedMask ? (
          <Card className="p-3 text-xs text-muted-foreground">
            Click on the part you want to freeze in the canvas.
          </Card>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Part name</Label>
              <Input
                value={d.name}
                onChange={(e) => props.onFreezeDraftChange({ name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={d.category} onValueChange={(v) => props.onFreezeDraftChange({ category: v as PartCategory })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PART_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Side</Label>
                <Select value={d.side} onValueChange={(v) => props.onFreezeDraftChange({ side: v as PartSide })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Mount zone</Label>
              <Select value={d.mount_zone} onValueChange={(v) => props.onFreezeDraftChange({ mount_zone: v as MountZone })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOUNT_ZONES.map((z) => (
                    <SelectItem key={z.id} value={z.id}>{z.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer">Symmetry allowed</Label>
              <Switch
                checked={d.symmetry_allowed}
                onCheckedChange={(v) => props.onFreezeDraftChange({ symmetry_allowed: v })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label className="cursor-pointer">Lock silhouette</Label>
              <Switch
                checked={d.silhouette_locked}
                onCheckedChange={(v) => props.onFreezeDraftChange({ silhouette_locked: v })}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={props.onResetMask}>Reset mask</Button>
              <Button className="flex-1" onClick={props.onSaveFrozenPart} disabled={busy}>
                <Save className="h-4 w-4 mr-2" /> Save part
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // Place mode
  const inst = props.selectedInstance;
  const part = props.selectedFrozenPart;
  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Place</div>
      {!part ? (
        <Card className="p-3 text-xs text-muted-foreground">
          Select a frozen part on the left to place it.
        </Card>
      ) : (
        <>
          <Card className="p-2 flex items-center gap-2">
            {part.silhouette_url && (
              <img src={part.silhouette_url} alt="" className="h-12 w-12 object-contain bg-surface-2 rounded" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{part.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{String(part.category)} · {String(part.mount_zone)}</div>
            </div>
          </Card>

          <Button className="w-full" onClick={props.onAddInstanceFromSelected}>
            <Copy className="h-4 w-4 mr-2" /> Add instance to canvas
          </Button>

          {inst && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" onClick={props.onClone}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Clone
                </Button>
                <Button size="sm" variant="outline" onClick={props.onMirror}>
                  <FlipHorizontal className="h-3.5 w-3.5 mr-1" /> Mirror
                </Button>
                <Button size="sm" variant="outline" onClick={props.onSnapOpposite}>
                  <ArrowLeftRight className="h-3.5 w-3.5 mr-1" /> Opposite
                </Button>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Scale</Label>
                  <span className="text-xs text-muted-foreground">{inst.transform.scale.toFixed(2)}×</span>
                </div>
                <Slider
                  value={[inst.transform.scale]}
                  onValueChange={([v]) => props.onUpdateInstanceTransform({ scale: v })}
                  min={0.2} max={2.5} step={0.05}
                  disabled={inst.locked}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Rotation</Label>
                  <span className="text-xs text-muted-foreground">{(inst.transform.rotation * 180 / Math.PI).toFixed(0)}°</span>
                </div>
                <Slider
                  value={[inst.transform.rotation]}
                  onValueChange={([v]) => props.onUpdateInstanceTransform({ rotation: v })}
                  min={-Math.PI / 4} max={Math.PI / 4} step={0.02}
                  disabled={inst.locked}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">X</Label>
                  <Slider
                    value={[inst.transform.x]}
                    onValueChange={([v]) => props.onUpdateInstanceTransform({ x: v })}
                    min={0} max={1} step={0.01}
                    disabled={inst.locked}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Y</Label>
                  <Slider
                    value={[inst.transform.y]}
                    onValueChange={([v]) => props.onUpdateInstanceTransform({ y: v })}
                    min={0} max={1} step={0.01}
                    disabled={inst.locked}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={props.onLockToggle}>
                  {inst.locked ? <Unlock className="h-3.5 w-3.5 mr-1" /> : <Lock className="h-3.5 w-3.5 mr-1" />}
                  {inst.locked ? "Unlock" : "Lock"}
                </Button>
                <Button size="sm" variant="outline" onClick={props.onDeleteInstance}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
              </div>
            </>
          )}

          <Button className="w-full" variant="hero" onClick={props.onApproveOverlay} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Approve overlay
          </Button>
        </>
      )}
    </div>
  );
}
