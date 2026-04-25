import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hammer, ShieldAlert, RefreshCw, Trash2, Download, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import {
  useBlenderJobs,
  useDispatchBlenderJob,
  usePollBlenderJob,
  useDeleteBlenderJob,
  defaultParamsFor,
  BLENDER_OP_META,
  BLENDER_OPS,
  type BlenderJob,
  type BlenderJobType,
} from "@/lib/blender-jobs";
import { BLENDER_OP_SCHEMA, coerceValues, validate } from "@/lib/blender-jobs-schema";
import { TypedFieldGroup } from "@/components/blender-jobs/TypedFieldGroup";

const STATUS_TONES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/15 text-primary",
  complete: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

/**
 * Blender Jobs — admin queue for the external Blender worker. Lets admins
 * pick one of the 14 supported operations, fill in its parameters + input
 * mesh URLs via typed forms (no JSON required), dispatch the job, and watch
 * it through to completed outputs (re-hosted into `blender-outputs`).
 */
export default function BlenderJobs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);
  const { data: jobs = [], isLoading } = useBlenderJobs();
  const dispatch = useDispatchBlenderJob();
  const poll = usePollBlenderJob();
  const del = useDeleteBlenderJob();

  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<BlenderJobType>("trim_part_to_car");
  const [paramValues, setParamValues] = useState<Record<string, unknown>>(() =>
    defaultParamsFor("trim_part_to_car"),
  );
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [projectId, setProjectId] = useState("");

  const schema = BLENDER_OP_SCHEMA[op];

  // Reset values whenever operation changes.
  useEffect(() => {
    setParamValues(defaultParamsFor(op));
    setInputValues({});
  }, [op]);

  const grouped = useMemo(() => {
    const map = new Map<string, BlenderJobType[]>();
    for (const t of BLENDER_OPS) {
      const g = BLENDER_OP_META[t].group;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    return Array.from(map.entries());
  }, []);

  if (roleLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  async function submit() {
    const inputProblems = validate(schema.inputs, inputValues);
    const paramProblems = validate(schema.params, paramValues);
    const problems = [...inputProblems, ...paramProblems];
    if (problems.length > 0) {
      toast({ title: "Missing required fields", description: problems.join(" • "), variant: "destructive" });
      return;
    }

    const parameters = coerceValues(schema.params, paramValues);
    const input_mesh_urls = coerceValues(schema.inputs, inputValues) as Record<string, string>;

    try {
      const res = await dispatch.mutateAsync({
        operation_type: op,
        parameters,
        input_mesh_urls,
        project_id: projectId.trim() || null,
      });
      toast({ title: "Job dispatched", description: `${BLENDER_OP_META[op].label} → ${res.status}` });
      setOpen(false);
    } catch (e) {
      toast({ title: "Dispatch failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function refreshOne(j: BlenderJob) {
    try {
      const r = await poll.mutateAsync(j.id);
      toast({ title: `Polled ${BLENDER_OP_META[j.operation_type].label}`, description: `Status: ${r.status}` });
    } catch (e) {
      toast({ title: "Poll failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-8">
        <PageHeader
          eyebrow="Admin"
          title="Blender Jobs"
          description="Queue and monitor the 14 Blender backend operations: trim, conform, thicken, panelise, repair, export."
          actions={
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Hammer className="h-4 w-4 mr-1.5" /> New job
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Dispatch Blender job</DialogTitle>
                  <DialogDescription>
                    Picks one of the 14 supported operations, packages the
                    parameters + input mesh URLs, and POSTs to the Blender
                    worker. Outputs are re-hosted into <code className="text-xs">blender-outputs</code>.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Operation</Label>
                    <Select value={op} onValueChange={(v) => setOp(v as BlenderJobType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-[400px]">
                        {grouped.map(([group, ops]) => (
                          <div key={group} className="py-1">
                            <div className="px-2 py-1 text-xs uppercase text-muted-foreground tracking-wide">{group}</div>
                            {ops.map((t) => (
                              <SelectItem key={t} value={t}>{BLENDER_OP_META[t].label}</SelectItem>
                            ))}
                          </div>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{BLENDER_OP_META[op].description}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Project ID (optional)</Label>
                    <Input
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="uuid for output scoping"
                    />
                  </div>

                  <Tabs defaultValue="form" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="form">Form</TabsTrigger>
                      <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                    </TabsList>

                    <TabsContent value="form" className="space-y-5 mt-4">
                      <section className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inputs</h4>
                        {schema.inputs.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No inputs required.</p>
                        ) : (
                          <TypedFieldGroup
                            fields={schema.inputs}
                            values={inputValues}
                            onChange={setInputValues}
                          />
                        )}
                      </section>
                      <section className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parameters</h4>
                        <TypedFieldGroup
                          fields={schema.params}
                          values={paramValues}
                          onChange={setParamValues}
                        />
                      </section>
                    </TabsContent>

                    <TabsContent value="raw" className="space-y-3 mt-4">
                      <p className="text-xs text-muted-foreground">
                        Read-only preview of what will be POSTed to the worker.
                      </p>
                      <pre className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] font-mono overflow-x-auto">
{JSON.stringify({
  operation_type: op,
  input_mesh_urls: coerceValues(schema.inputs, inputValues),
  parameters: coerceValues(schema.params, paramValues),
  project_id: projectId.trim() || null,
}, null, 2)}
                      </pre>
                    </TabsContent>
                  </Tabs>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={submit} disabled={dispatch.isPending}>
                    {dispatch.isPending ? "Dispatching…" : "Dispatch"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading queue…</div>
        ) : jobs.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">No Blender jobs yet</h2>
            <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
              Dispatch your first job to test the worker contract. The worker
              source lives in <code className="text-xs">blender-worker/</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((j) => {
              const meta = BLENDER_OP_META[j.operation_type];
              const outputs = (j.output_file_urls ?? {}) as Record<string, string>;
              const outEntries = Object.entries(outputs).filter(([, v]) => !!v);
              return (
                <div key={j.id} className="glass rounded-xl p-4 flex gap-4">
                  {j.preview_file_url ? (
                    <img src={j.preview_file_url} alt="" className="h-24 w-24 rounded object-cover bg-muted" />
                  ) : (
                    <div className="h-24 w-24 rounded bg-muted/40 flex items-center justify-center text-muted-foreground">
                      <Hammer className="h-6 w-6" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold truncate">{meta.label}</h3>
                      <Badge className={STATUS_TONES[j.status] ?? "bg-muted"}>{j.status}</Badge>
                      <Badge variant="outline" className="text-xs">{meta.group}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                    {j.error_log && (
                      <p className="text-xs text-destructive mt-1.5 line-clamp-2">{j.error_log}</p>
                    )}
                    {outEntries.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {outEntries.map(([k, url]) => (
                          <a
                            key={k}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-secondary/60 px-2 py-1 text-xs hover:bg-secondary"
                          >
                            <Download className="h-3 w-3" /> {k}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {(j.status === "queued" || j.status === "running") && (
                      <Button size="sm" variant="outline" onClick={() => refreshOne(j)} disabled={poll.isPending}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${poll.isPending ? "animate-spin" : ""}`} /> Poll
                      </Button>
                    )}
                    {j.worker_task_id && (
                      <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]" title={j.worker_task_id}>
                        <ExternalLink className="h-3 w-3 inline mr-1" />
                        {j.worker_task_id.slice(0, 12)}…
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => del.mutate(j.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
