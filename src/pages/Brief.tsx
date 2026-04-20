import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useBrief, useUpsertBrief, useStylePresets, useCarTemplates, useCreateProjectWithStyle, type DesignBrief } from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Save, Tag, Wrench, RefreshCw, Palette, Sparkles, Car as CarIcon, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const STYLE_TAGS = [
  "OEM+", "Subtle road kit", "Aggressive track build", "Time attack",
  "GT style", "Retro race", "Widebody", "Clean aero", "Extreme aero",
  "Street usable", "Fabrication-friendly",
];

const BUILD_TYPES = ["Daily/street", "Track day", "Time attack", "GT race", "Show car"];

const CONSTRAINTS = [
  "Keep factory headlights",
  "Keep factory shut lines",
  "No bonnet vents",
  "Wide arch max extension",
  "Subtle rear wing only",
  "Splitter must be printable in sections",
  "Do not change mirrors",
  "Keep side profile elegant",
  "Preserve original identity of the car",
];

export default function Brief() {
  return <WorkspaceShell>{({ project, projectId }) => <BriefInner projectId={projectId!} />}</WorkspaceShell>;
}

function BriefInner({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: brief } = useBrief(projectId);
  const { data: presets = [] } = useStylePresets(user?.id);
  const upsert = useUpsertBrief();

  const [prompt, setPrompt] = useState("");
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [buildType, setBuildType] = useState<string>("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [customConstraint, setCustomConstraint] = useState("");
  const [rights, setRights] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [stylePresetId, setStylePresetId] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);

  const { data: templates = [] } = useCarTemplates();
  const supportedTemplates = templates.filter((t: any) => t.supported);
  const createWithStyle = useCreateProjectWithStyle();

  const activePreset = presets.find((p) => p.id === stylePresetId) ?? null;

  useEffect(() => {
    if (brief) {
      setPrompt(brief.prompt ?? "");
      setStyleTags(brief.style_tags ?? []);
      setBuildType(brief.build_type ?? "");
      setConstraints(brief.constraints ?? []);
      setRights(brief.rights_confirmed ?? false);
      setStylePresetId((brief as any).style_preset_id ?? null);
    }
  }, [brief]);


  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  const persist = async () => {
    if (!user) return null;
    const allConstraints = [...constraints];
    if (customConstraint.trim()) allConstraints.push(customConstraint.trim());
    const saved = await upsert.mutateAsync({
      userId: user.id,
      projectId,
      id: brief?.id,
      patch: {
        prompt,
        style_tags: styleTags,
        build_type: buildType || null,
        constraints: allConstraints,
        rights_confirmed: rights,
        style_preset_id: stylePresetId,
      } as any,
    });
    setCustomConstraint("");
    return saved;
  };

  const save = async () => {
    try {
      await persist();
      toast({ title: "Brief saved" });
    } catch (e: any) {
      toast({ title: "Couldn't save brief", description: e.message, variant: "destructive" });
    }
  };

  const continueToConcepts = async () => {
    if ((!prompt.trim() && !stylePresetId) || !user) return;
    setContinuing(true);
    try {
      const saved = await persist();
      const briefId = (saved as any)?.id ?? brief?.id;
      if (!briefId) throw new Error("Could not save brief");

      // Hand off to the Concepts page with an auto-generate flag. The Concepts
      // page owns the invocation so its "Generating…" spinner accurately
      // reflects the in-flight request (instead of us firing it here behind
      // the scenes and the page button looking idle).
      navigate(`/concepts?project=${projectId}`, { state: { autoGenerate: true } });
    } catch (e: any) {
      toast({ title: "Couldn't continue", description: e.message, variant: "destructive" });
    } finally {
      setContinuing(false);
    }
  };

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const generateForSelected = async () => {
    if (!user || !stylePresetId || selectedTemplateIds.length === 0) return;
    const picks = supportedTemplates.filter((t: any) => selectedTemplateIds.includes(t.id));
    if (picks.length === 0) return;

    setBulkRunning(true);
    const created: { project_id: string; brief_id: string; project_name: string }[] = [];
    try {
      for (const tmpl of picks) {
        const res = await createWithStyle.mutateAsync({
          userId: user.id,
          template: tmpl as any,
          stylePresetId,
          addendumPrompt: prompt.trim(),
          styleTags,
          constraints: [...constraints, ...(customConstraint.trim() ? [customConstraint.trim()] : [])],
          buildType: buildType || null,
          rightsConfirmed: rights,
        });
        created.push(res);
      }

      for (const c of created) {
        supabase.functions.invoke("generate-concepts", {
          body: {
            project_id: c.project_id,
            brief_id: c.brief_id,
            snapshot_data_url: null,
            snapshots: {},
          },
        }).then(({ error, data }) => {
          if (error || (data as any)?.error) {
            toast({
              title: `Generation failed for ${c.project_name}`,
              description: String(error?.message ?? (data as any)?.error ?? "Unknown error"),
              variant: "destructive",
            });
          }
        });
      }

      toast({
        title: `Generating ${created.length} project${created.length === 1 ? "" : "s"}…`,
        description: "Concepts will appear in each project as they finish.",
      });
      setSelectedTemplateIds([]);
      navigate("/projects");
    } catch (e: any) {
      toast({ title: "Couldn't queue generations", description: e.message, variant: "destructive" });
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Step 1 · Design Brief</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Brief the AI like an automotive designer</h1>
        <p className="mt-1.5 text-muted-foreground">
          The clearer the brief, the stronger the concepts. Describe the look you want, the build context and any hard constraints.
        </p>
      </div>

      <div className="glass rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Palette className="h-3 w-3" /> Style preset (optional)
          </label>
          <Link to="/styles" className="text-mono text-[10px] uppercase tracking-widest text-primary hover:underline">
            Manage styles →
          </Link>
        </div>
        <select
          value={stylePresetId ?? ""}
          onChange={(e) => setStylePresetId(e.target.value || null)}
          className="w-full bg-surface-1 border border-border rounded-md px-3 py-2 text-sm"
        >
          <option value="">— None —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.user_id !== user?.id ? " (public)" : ""}
            </option>
          ))}
        </select>
        {activePreset && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-1.5">
            <div className="text-xs text-foreground line-clamp-3">{activePreset.prompt || <em className="text-muted-foreground">No preset description.</em>}</div>
            {(activePreset.style_tags?.length || activePreset.constraints?.length) ? (
              <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {activePreset.style_tags?.length ?? 0} tags · {activePreset.constraints?.length ?? 0} constraints will be merged in
              </div>
            ) : null}
          </div>
        )}
      </div>


        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Styling direction {activePreset ? "(optional addendum)" : ""}
          </label>
          {activePreset && (
            <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              Preset covers the styling — leave blank or add car-specific notes
            </span>
          )}
        </div>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            activePreset
              ? "Optional — anything car-specific to add on top of the preset (e.g. keep the factory headlights, no bonnet vents)."
              : "e.g. Sharp time-attack package inspired by late-90s GT cars. Big front splitter with side canards, wide arches but tasteful, clean side skirts, tall single-element rear wing on swan-neck mounts. Keep the factory headlights and shut lines."
          }
          rows={activePreset ? 4 : 6}
          className="bg-surface-1 border-border"
        />
      </div>

      <div className="glass rounded-xl p-5 space-y-4">
        <div>
          <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Tag className="h-3 w-3" /> Style tags
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STYLE_TAGS.map((t) => {
              const on = styleTags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggle(styleTags, t, setStyleTags)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Wrench className="h-3 w-3" /> Build type
          </label>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
            {BUILD_TYPES.map((t) => {
              const on = buildType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBuildType(on ? "" : t)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-5 space-y-3">
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Hard constraints</label>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {CONSTRAINTS.map((c) => {
            const on = constraints.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(constraints, c, setConstraints)}
                className={cn(
                  "text-left rounded-md border px-3 py-2 text-xs transition-colors",
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
        <Input
          value={customConstraint}
          onChange={(e) => setCustomConstraint(e.target.value)}
          placeholder="Add a custom constraint…"
          className="bg-surface-1 border-border"
        />
      </div>

      <div className="glass rounded-xl p-5 space-y-3">
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Reference images (optional)</label>
        <div className="rounded-md border-2 border-dashed border-border bg-surface-1 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">Reference image upload coming next — describe in the prompt for now.</p>
        </div>
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <Checkbox checked={rights} onCheckedChange={(v) => setRights(!!v)} className="mt-0.5" />
          <span className="text-muted-foreground">
            I confirm I have the right to use any reference images I provide.
          </span>
        </label>
      </div>

      <div className="flex justify-between gap-3">
        <Button variant="glass" size="lg" onClick={save} disabled={upsert.isPending}>
          <Save className="mr-2 h-4 w-4" /> Save brief
        </Button>
        <Button
          variant="hero"
          size="lg"
          onClick={continueToConcepts}
          disabled={(!prompt.trim() && !stylePresetId) || continuing || upsert.isPending}
        >
          {continuing ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Starting generation…
            </>
          ) : (
            <>
              Continue to concepts <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
