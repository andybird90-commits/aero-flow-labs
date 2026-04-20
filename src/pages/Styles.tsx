/**
 * /styles — manage reusable style presets (Pandem-style, RWB-style, your own).
 * A preset is a styling DNA that can be attached to any project's design brief
 * so the same look can be applied across different cars.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  useStylePresets, useCreateStylePreset, useUpdateStylePreset, useDeleteStylePreset,
  useCarTemplates, useCreateProjectWithStyle,
  type StylePreset,
} from "@/lib/repo";
import { supabase } from "@/integrations/supabase/client";
import { Palette, Plus, Save, Trash2, Globe, Lock, Tag, Wrench, Sparkles, Car as CarIcon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STYLE_TAGS = [
  "OEM+", "Subtle road kit", "Aggressive track build", "Time attack",
  "GT style", "Retro race", "Widebody", "Clean aero", "Extreme aero",
  "Street usable", "Fabrication-friendly",
];
const BUILD_TYPES = ["Daily/street", "Track day", "Time attack", "GT race", "Show car"];

export default function Styles() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: presets = [], isLoading } = useStylePresets(user?.id);
  const create = useCreateStylePreset();
  const del = useDeleteStylePreset();

  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useMemo(() => presets.find((p) => p.id === editingId) ?? null, [presets, editingId]);

  const mine = presets.filter((p) => p.user_id === user?.id);
  const community = presets.filter((p) => p.user_id !== user?.id && p.is_public);

  const newStyle = async () => {
    if (!user) return;
    try {
      const s = await create.mutateAsync({ userId: user.id, name: "Untitled style" });
      setEditingId(s.id);
    } catch (e: any) {
      toast({ title: "Couldn't create style", description: e.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Library</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Style presets</h1>
            <p className="mt-1.5 text-muted-foreground max-w-2xl">
              Reusable styling DNA — Pandem-inspired, Liberty-inspired, RWB-inspired, or your own. Apply the same look to any car from the design brief.
            </p>
          </div>
          <Button variant="hero" size="lg" onClick={newStyle} disabled={!user || create.isPending}>
            <Plus className="mr-2 h-4 w-4" /> New style
          </Button>
        </div>

        <Section title="Your styles" empty={mine.length === 0 && !isLoading ? "No styles yet — click New style to start." : null}>
          {mine.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              ownedByMe
              onEdit={() => setEditingId(p.id)}
              onDelete={async () => {
                if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
                try { await del.mutateAsync(p.id); toast({ title: "Style deleted" }); }
                catch (e: any) { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); }
              }}
            />
          ))}
        </Section>

        {community.length > 0 && (
          <Section title="Public styles">
            {community.map((p) => (
              <PresetCard key={p.id} preset={p} ownedByMe={false} onEdit={() => setEditingId(p.id)} />
            ))}
          </Section>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditingId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          <VisuallyHidden>
            <DialogTitle>Edit style preset</DialogTitle>
            <DialogDescription>Configure a reusable style.</DialogDescription>
          </VisuallyHidden>
          {editing && (
            <PresetEditor
              preset={editing}
              ownedByMe={editing.user_id === user?.id}
              onClose={() => setEditingId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string | null; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{title}</div>
      {empty ? (
        <div className="glass rounded-xl p-8 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
      )}
    </div>
  );
}

function PresetCard({
  preset, ownedByMe, onEdit, onDelete,
}: { preset: StylePreset; ownedByMe: boolean; onEdit: () => void; onDelete?: () => void }) {
  return (
    <div className="glass rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 grid place-items-center text-primary shrink-0">
          <Palette className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold tracking-tight">{preset.name}</div>
            {preset.is_public ? (
              <span title="Public" className="inline-flex items-center text-mono text-[10px] uppercase tracking-widest text-success">
                <Globe className="h-3 w-3 mr-1" /> Public
              </span>
            ) : (
              <span title="Private" className="inline-flex items-center text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <Lock className="h-3 w-3" />
              </span>
            )}
          </div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">
            {preset.style_tags?.length ?? 0} tags · {preset.constraints?.length ?? 0} constraints
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-3 min-h-[3rem]">
        {preset.prompt || <em className="text-muted-foreground/60">No description yet.</em>}
      </p>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <Button size="sm" variant="glass" className="flex-1" onClick={onEdit}>
          {ownedByMe ? "Edit" : "View"}
        </Button>
        {ownedByMe && onDelete && (
          <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function PresetEditor({
  preset, ownedByMe, onClose,
}: { preset: StylePreset; ownedByMe: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const upd = useUpdateStylePreset();

  const [name, setName] = useState(preset.name);
  const [prompt, setPrompt] = useState(preset.prompt ?? "");
  const [tags, setTags] = useState<string[]>(preset.style_tags ?? []);
  const [buildType, setBuildType] = useState<string>(preset.build_type ?? "");
  const [constraints, setConstraints] = useState<string[]>(preset.constraints ?? []);
  const [customConstraint, setCustomConstraint] = useState("");
  const [isPublic, setIsPublic] = useState(preset.is_public);

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  const save = async () => {
    try {
      const allConstraints = [...constraints];
      if (customConstraint.trim()) allConstraints.push(customConstraint.trim());
      await upd.mutateAsync({
        id: preset.id,
        patch: {
          name: name.trim() || "Untitled style",
          prompt,
          style_tags: tags,
          constraints: allConstraints,
          build_type: buildType || null,
          is_public: isPublic,
        },
      });
      toast({ title: "Style saved" });
      onClose();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    }
  };

  const disabled = !ownedByMe;

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Style preset</div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled}
          className="mt-1.5 text-lg font-semibold bg-surface-1 border-border"
          placeholder="e.g. Pandem-style widebody"
        />
      </div>

      <div className="space-y-2">
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Style description</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={disabled}
          rows={6}
          placeholder="Describe the styling DNA: bolt-on overfenders with exposed rivets, ducktail spoiler, big front lip with side canards…"
          className="bg-surface-1 border-border"
        />
      </div>

      <div>
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Tag className="h-3 w-3" /> Style tags
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STYLE_TAGS.map((t) => {
            const on = tags.includes(t);
            return (
              <button key={t} type="button" disabled={disabled} onClick={() => toggle(tags, t, setTags)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60",
                  on ? "border-primary bg-primary/10 text-primary"
                     : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
                )}>
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Wrench className="h-3 w-3" /> Default build type (optional)
        </label>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {BUILD_TYPES.map((t) => {
            const on = buildType === t;
            return (
              <button key={t} type="button" disabled={disabled} onClick={() => setBuildType(on ? "" : t)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-60",
                  on ? "border-primary bg-primary/10 text-primary"
                     : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
                )}>
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Constraints</label>
        <div className="flex flex-wrap gap-1.5">
          {constraints.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 px-2.5 py-0.5 text-xs">
              {c}
              {!disabled && (
                <button onClick={() => setConstraints(constraints.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">×</button>
              )}
            </span>
          ))}
        </div>
        {!disabled && (
          <div className="flex gap-2">
            <Input value={customConstraint} onChange={(e) => setCustomConstraint(e.target.value)}
              placeholder="Add a constraint…" className="bg-surface-1 border-border" />
            <Button variant="glass" size="sm" onClick={() => {
              if (customConstraint.trim()) {
                setConstraints([...constraints, customConstraint.trim()]);
                setCustomConstraint("");
              }
            }}>Add</Button>
          </div>
        )}
      </div>

      {!disabled && (
        <label className="flex items-center justify-between gap-3 glass rounded-md p-3 cursor-pointer">
          <div>
            <div className="text-sm font-semibold tracking-tight">Make public</div>
            <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Anyone signed in can apply this style to their projects.
            </div>
          </div>
          <Switch checked={isPublic} onCheckedChange={setIsPublic} />
        </label>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <Button variant="glass" onClick={onClose}>Close</Button>
        {!disabled && (
          <Button variant="hero" onClick={save} disabled={upd.isPending}>
            <Save className="mr-2 h-4 w-4" /> Save style
          </Button>
        )}
      </div>
    </div>
  );
}
