import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useBrief, useUpsertBrief, useStylePresets, type DesignBrief } from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Save, Tag, Wrench, RefreshCw, Palette, Upload, X, Loader2, Flame, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const STYLE_TAGS = [
  "OEM+", "Subtle road kit", "Aggressive track build", "Time attack",
  "GT style", "Retro race", "Widebody", "Clean aero", "Extreme aero",
  "Street usable", "Fabrication-friendly",
];

const BUILD_TYPES = ["Daily/street", "Track day", "Time attack", "GT race", "Show car"];

const DISCIPLINES = [
  { value: "auto",        label: "Auto-detect" },
  { value: "time_attack", label: "Time attack" },
  { value: "drift",       label: "Drift" },
  { value: "stance",      label: "Stance" },
  { value: "gt",          label: "GT race" },
  { value: "rally",       label: "Rally" },
  { value: "show",        label: "Show car" },
  { value: "street",      label: "Street" },
];

const AGGRESSIONS = [
  { value: "auto",       label: "Auto" },
  { value: "subtle",     label: "Subtle" },
  { value: "moderate",   label: "Moderate" },
  { value: "aggressive", label: "Aggressive" },
  { value: "extreme",    label: "Extreme" },
];

const AERO_FEATURES = [
  "Big rear wing", "Wide body", "Front splitter", "Canards",
  "Diffuser", "Hood vents", "Roof scoop", "Side skirts", "Ducktail",
];

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
  const [referencePaths, setReferencePaths] = useState<string[]>([]);
  const [refUrls, setRefUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [discipline, setDiscipline] = useState<string>("auto");
  const [aggression, setAggression] = useState<string>("auto");
  const [mustInclude, setMustInclude] = useState<string[]>([]);
  const [mustAvoid, setMustAvoid] = useState<string[]>([]);

  const MAX_REFS = 5;
  const activePreset = presets.find((p) => p.id === stylePresetId) ?? null;

  useEffect(() => {
    if (brief) {
      setPrompt(brief.prompt ?? "");
      setStyleTags(brief.style_tags ?? []);
      setBuildType(brief.build_type ?? "");
      setConstraints(brief.constraints ?? []);
      setRights(brief.rights_confirmed ?? false);
      setStylePresetId((brief as any).style_preset_id ?? null);
      setReferencePaths(brief.reference_image_paths ?? []);
      setDiscipline(((brief as any).discipline as string) || "auto");
      setAggression(((brief as any).aggression as string) || "auto");
      setMustInclude(((brief as any).must_include as string[]) ?? []);
      setMustAvoid(((brief as any).must_avoid as string[]) ?? []);
    }
  }, [brief]);

  // Resolve signed URLs for previews whenever the path list changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = referencePaths.filter((p) => !refUrls[p]);
      if (missing.length === 0) return;
      const next: Record<string, string> = { ...refUrls };
      for (const path of missing) {
        const { data } = await supabase.storage
          .from("brief-references")
          .createSignedUrl(path, 60 * 60);
        if (data?.signedUrl) next[path] = data.signedUrl;
      }
      if (!cancelled) setRefUrls(next);
    })();
    return () => { cancelled = true; };
  }, [referencePaths]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !user) return;
    const remaining = MAX_REFS - referencePaths.length;
    if (remaining <= 0) {
      toast({ title: `Maximum ${MAX_REFS} reference images`, variant: "destructive" });
      return;
    }
    const incoming = Array.from(files).slice(0, remaining);
    setUploading(true);
    const newPaths: string[] = [];
    try {
      for (const file of incoming) {
        if (!file.type.startsWith("image/")) {
          toast({ title: `Skipped ${file.name}`, description: "Not an image file.", variant: "destructive" });
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast({ title: `Skipped ${file.name}`, description: "Larger than 10MB.", variant: "destructive" });
          continue;
        }
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("brief-references")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) {
          toast({ title: `Upload failed: ${file.name}`, description: error.message, variant: "destructive" });
          continue;
        }
        newPaths.push(path);
      }
      if (newPaths.length) {
        const updated = [...referencePaths, ...newPaths];
        setReferencePaths(updated);
        // Persist immediately so refresh keeps them.
        if (brief?.id) {
          await supabase.from("design_briefs")
            .update({ reference_image_paths: updated }).eq("id", brief.id);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const removeReference = async (path: string) => {
    const updated = referencePaths.filter((p) => p !== path);
    setReferencePaths(updated);
    await supabase.storage.from("brief-references").remove([path]);
    if (brief?.id) {
      await supabase.from("design_briefs")
        .update({ reference_image_paths: updated }).eq("id", brief.id);
    }
  };


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
        reference_image_paths: referencePaths,
        discipline: discipline === "auto" ? null : discipline,
        aggression: aggression === "auto" ? null : aggression,
        must_include: mustInclude,
        must_avoid: mustAvoid,
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

      <div className="glass rounded-xl p-5 space-y-3">
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
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Target className="h-3 w-3" /> Discipline
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DISCIPLINES.map((d) => {
                const on = discipline === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDiscipline(d.value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Flame className="h-3 w-3" /> Aggression
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AGGRESSIONS.map((a) => {
                const on = aggression === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAggression(a.value)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                    )}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
          <div>
            <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Must include</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AERO_FEATURES.map((f) => {
                const on = mustInclude.includes(f);
                const blocked = mustAvoid.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggle(mustInclude, f, setMustInclude)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      on
                        ? "border-success bg-success/10 text-success"
                        : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                      blocked && "opacity-30 cursor-not-allowed",
                    )}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Must avoid</label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AERO_FEATURES.map((f) => {
                const on = mustAvoid.includes(f);
                const blocked = mustInclude.includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    disabled={blocked}
                    onClick={() => toggle(mustAvoid, f, setMustAvoid)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      on
                        ? "border-destructive bg-destructive/10 text-destructive"
                        : "border-border bg-surface-1 text-muted-foreground hover:text-foreground hover:border-border/80",
                      blocked && "opacity-30 cursor-not-allowed",
                    )}
                  >
                    {f}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
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
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Reference images (optional)
          </label>
          <span className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            {referencePaths.length} / {MAX_REFS}
          </span>
        </div>

        {referencePaths.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {referencePaths.map((path) => (
              <div
                key={path}
                className="relative aspect-square rounded-md overflow-hidden border border-border bg-surface-1 group"
              >
                {refUrls[path] ? (
                  <img
                    src={refUrls[path]}
                    alt="Reference"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeReference(path)}
                  className="absolute top-1 right-1 rounded-full bg-background/80 backdrop-blur p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
                  aria-label="Remove reference"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {referencePaths.length < MAX_REFS && (
          <label
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-surface-1 px-4 py-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors",
              uploading && "opacity-60 cursor-wait",
            )}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-5 w-5 text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground">
              {uploading
                ? "Uploading…"
                : `Click to upload up to ${MAX_REFS - referencePaths.length} more image${MAX_REFS - referencePaths.length === 1 ? "" : "s"}`}
            </p>
            <p className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              PNG · JPG · WEBP · max 10MB each
            </p>
          </label>
        )}

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
