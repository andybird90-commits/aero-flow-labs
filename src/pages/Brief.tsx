import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useBrief, useUpsertBrief, type DesignBrief } from "@/lib/repo";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Save, Tag, Wrench, RefreshCw } from "lucide-react";
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
  const upsert = useUpsertBrief();

  const [prompt, setPrompt] = useState("");
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [buildType, setBuildType] = useState<string>("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [customConstraint, setCustomConstraint] = useState("");
  const [rights, setRights] = useState(false);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    if (brief) {
      setPrompt(brief.prompt ?? "");
      setStyleTags(brief.style_tags ?? []);
      setBuildType(brief.build_type ?? "");
      setConstraints(brief.constraints ?? []);
      setRights(brief.rights_confirmed ?? false);
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
      },
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
    if (!prompt.trim() || !user) return;
    setContinuing(true);
    try {
      const saved = await persist();
      const briefId = (saved as any)?.id ?? brief?.id;
      if (!briefId) throw new Error("Could not save brief");

      // Navigate immediately so the user sees concepts appear as they generate.
      navigate(`/concepts?project=${projectId}`);

      // Kick off generation in the background — the Concepts page polls/refetches.
      supabase.functions
        .invoke("generate-concepts", {
          body: {
            project_id: projectId,
            brief_id: briefId,
            snapshot_data_url: null,
            snapshots: {},
          },
        })
        .then(({ data, error }) => {
          if (error || (data as any)?.error) {
            toast({
              title: "Generation failed",
              description: String(error?.message ?? (data as any)?.error ?? "Unknown error"),
              variant: "destructive",
            });
          } else {
            toast({
              title: "Concepts generated",
              description: `${(data as any)?.count ?? "Several"} concept variations created.`,
            });
          }
        });

      toast({ title: "Generating concepts…", description: "This usually takes 20–40 seconds." });
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
        <label className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">Styling direction</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Sharp time-attack package inspired by late-90s GT cars. Big front splitter with side canards, wide arches but tasteful, clean side skirts, tall single-element rear wing on swan-neck mounts. Keep the factory headlights and shut lines."
          rows={6}
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
          disabled={!prompt.trim() || continuing || upsert.isPending}
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
