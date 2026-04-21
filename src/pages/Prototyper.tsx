/**
 * Prototyper — standalone tool that turns physical part photos into a 3D mesh.
 *
 * Flow:
 *   1. List existing prototypes + "New prototype" CTA
 *   2. New prototype dialog: upload 1-5 reference photos, optional car context,
 *      title.
 *   3. After create → side-by-side preview pane:
 *      [ Source photos ]  [ AI render ]  [ 3D mesh ]
 *      Buttons: Render views → Make 3D model → Download STL
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Beaker, Plus, Loader2, Wand2, Box, Download, Trash2, Upload, X, Image as ImageIcon, Car, Sparkles, RefreshCw, AlertCircle,
} from "lucide-react";
import {
  useMyPrototypes, useCreatePrototype, useDeletePrototype, useGarageCars, type Prototype, type PrototypeGenerationMode,
} from "@/lib/repo";

const PLACEMENT_OPTIONS = [
  { value: "front_bumper", label: "Front bumper / splitter" },
  { value: "bonnet", label: "Bonnet / hood" },
  { value: "side", label: "Side intake / side skirt" },
  { value: "rear_bumper", label: "Rear bumper / diffuser" },
  { value: "bootlid", label: "Bootlid / rear wing" },
  { value: "other", label: "Other" },
] as const;

const MODE_OPTIONS: Array<{ value: PrototypeGenerationMode; label: string; help: string }> = [
  { value: "exact_photo", label: "Exact replica from photos", help: "Copy the part in your photos as faithfully as possible. Requires uploaded photos." },
  { value: "text_design", label: "Design from description", help: "Let the AI invent the part from your description. No photos needed." },
  { value: "inspired_photo", label: "Inspired by photos", help: "Use your photos as inspiration; AI produces a refined version." },
];
import { fetchAsDownloadableMesh } from "@/lib/glb-to-stl";

const MAX_FILES = 5;

export default function PrototyperPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: prototypes = [], isLoading, refetch } = useMyPrototypes(user?.id);
  const createMut = useCreatePrototype();
  const deleteMut = useDeletePrototype();

  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<Prototype | null>(null);

  // Realtime: re-fetch when any prototype row changes (status updates from edge fns).
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`prototypes-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "prototypes", filter: `user_id=eq.${user.id}` }, () => {
        refetch();
        if (active) {
          // pick the latest version of the active prototype
          supabase.from("prototypes").select("*").eq("id", active.id).maybeSingle().then(({ data }) => {
            if (data) setActive(data as unknown as Prototype);
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, refetch, active?.id]);

  return (
    <AppLayout>
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Prototyper"
          title="Photo → 3D part"
          description="Upload reference photos of a real part. We re-draw it as a clean clay model, then turn it into a printable 3D mesh."
          actions={
            <Button variant="hero" size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New prototype
            </Button>
          }
        />
      </div>

      <div className="p-6 space-y-6">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading prototypes…</div>
        ) : prototypes.length === 0 ? (
          <EmptyState onNew={() => setCreating(true)} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {prototypes.map((p) => (
              <PrototypeCard
                key={p.id}
                prototype={p}
                onOpen={() => setActive(p)}
                onDelete={async () => {
                  if (!confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
                  try {
                    await deleteMut.mutateAsync(p.id);
                    toast({ title: "Prototype deleted" });
                    if (active?.id === p.id) setActive(null);
                  } catch (e: any) {
                    toast({ title: "Delete failed", description: String(e.message ?? e), variant: "destructive" });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      <CreatePrototypeDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false);
          setActive(p);
        }}
        userId={user?.id}
        createMut={createMut}
      />

      <PrototypeWorkspace
        prototype={active}
        onClose={() => setActive(null)}
      />
    </AppLayout>
  );
}

/* ───────────────────────────────────────────── */
/* List card                                     */
/* ───────────────────────────────────────────── */

function PrototypeCard({ prototype, onOpen, onDelete }: { prototype: Prototype; onOpen: () => void; onDelete: () => void }) {
  const sources = (prototype.source_image_urls as string[]) ?? [];
  const renders = (prototype.render_urls as Array<{ angle: string; url: string }>) ?? [];
  const fitUrl = (prototype as any).fit_preview_url as string | null;
  // Prefer the on-car carbon shot — it's the most useful "what does this look like" preview.
  const thumb = fitUrl ?? renders[0]?.url ?? sources[0] ?? null;

  return (
    <div className="group glass rounded-xl overflow-hidden flex flex-col">
      <button onClick={onOpen} className="relative aspect-square bg-surface-0 text-left">
        {thumb ? (
          <img src={thumb} alt={prototype.title} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Beaker className="h-6 w-6" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge variant="outline" className="bg-background/70 backdrop-blur text-fuchsia-400">
            <Beaker className="mr-1 h-3 w-3" /> Prototype
          </Badge>
        </div>
        <div className="absolute top-2 right-2">
          <StageBadge prototype={prototype} />
        </div>
      </button>
      <div className="p-3 flex-1 flex flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" title={prototype.title}>{prototype.title}</div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {new Date(prototype.created_at).toLocaleDateString()} · {sources.length} photo{sources.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="mt-auto flex gap-1.5">
          <Button variant="hero" size="sm" className="flex-1" onClick={onOpen}>
            Open
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-muted-foreground hover:text-destructive" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StageBadge({ prototype }: { prototype: Prototype }) {
  if (prototype.glb_url) return <Badge className="bg-emerald-500/90 text-emerald-950">Mesh ready</Badge>;
  if (prototype.mesh_status === "meshing") return <Badge className="bg-primary/90 text-primary-foreground">Meshing…</Badge>;
  if (prototype.render_status === "rendering") return <Badge className="bg-primary/90 text-primary-foreground">Rendering…</Badge>;
  if ((prototype.render_urls as any[])?.length) return <Badge variant="outline" className="bg-background/70 backdrop-blur">Render ready</Badge>;
  if (prototype.render_status === "failed" || prototype.mesh_status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline" className="bg-background/70 backdrop-blur">Draft</Badge>;
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="glass rounded-xl p-12 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-fuchsia-500/15 text-fuchsia-400 mb-3">
        <Beaker className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">No prototypes yet</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Upload up to 5 photos of a physical aero part and we'll redraw it cleanly, then turn it into a 3D mesh.
      </p>
      <div className="mt-5">
        <Button variant="hero" size="sm" onClick={onNew}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> New prototype
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────── */
/* Create dialog                                 */
/* ───────────────────────────────────────────── */

function CreatePrototypeDialog({
  open, onClose, onCreated, userId, createMut,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Prototype) => void;
  userId: string | undefined;
  createMut: ReturnType<typeof useCreatePrototype>;
}) {
  const { toast } = useToast();
  const { data: garageCars = [] } = useGarageCars(userId);
  const [title, setTitle] = useState("");
  const [carContext, setCarContext] = useState("");
  const [garageCarId, setGarageCarId] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [replicateExact, setReplicateExact] = useState(false);
  const [mode, setMode] = useState<PrototypeGenerationMode>("exact_photo");
  const [placement, setPlacement] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setCarContext("");
      setGarageCarId("none");
      setNotes("");
      setReplicateExact(false);
      setMode("exact_photo");
      setPlacement("");
      setFiles([]);
      setSubmitting(false);
    }
  }, [open]);

  // When user picks a Garage car, auto-fill the free-text car context for the AI.
  useEffect(() => {
    if (garageCarId === "none") return;
    const car = garageCars.find((c) => c.id === garageCarId);
    if (!car) return;
    const label = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");
    if (label) setCarContext(label);
  }, [garageCarId, garageCars]);

  const onPick = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...files, ...Array.from(incoming)].slice(0, MAX_FILES);
    setFiles(next);
  };

  const submit = async () => {
    if (!userId) return;
    if (!files.length && !notes.trim() && !title.trim()) {
      toast({ title: "Add a name, a description, or at least one photo", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Upload photos to prototype-uploads bucket
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage.from("prototype-uploads").upload(path, file, {
          contentType: file.type || `image/${ext}`,
          upsert: false,
        });
        if (error) throw error;
        const url = supabase.storage.from("prototype-uploads").getPublicUrl(path).data.publicUrl;
        uploadedUrls.push(url);
      }
      const created = await createMut.mutateAsync({
        user_id: userId,
        title: title.trim() || "Untitled prototype",
        car_context: carContext.trim() || null,
        notes: notes.trim() || null,
        replicate_exact: replicateExact || mode === "exact_photo",
        garage_car_id: garageCarId === "none" ? null : garageCarId,
        source_image_urls: uploadedUrls,
        generation_mode: mode,
        placement_hint: placement || null,
      });
      toast({ title: "Prototype created" });
      onCreated(created);
    } catch (e: any) {
      toast({ title: "Could not create prototype", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New prototype</DialogTitle>
          <DialogDescription>
            Describe the part you want, or upload 1–5 reference photos — either works. Photos are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="proto-mode">Workflow</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as PrototypeGenerationMode)}>
              <SelectTrigger id="proto-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">{MODE_OPTIONS.find((o) => o.value === mode)?.help}</p>
          </div>

          <div>
            <Label htmlFor="proto-placement">Where on the car?</Label>
            <Select value={placement || "unset"} onValueChange={(v) => setPlacement(v === "unset" ? "" : v)}>
              <SelectTrigger id="proto-placement"><SelectValue placeholder="Pick a zone…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">— Let the AI guess —</SelectItem>
                {PLACEMENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.label}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Telling the AI where the part belongs dramatically improves on-car results.</p>
          </div>

          <div>
            <Label htmlFor="proto-title">Name</Label>
            <Input id="proto-title" placeholder="e.g. Boxster 986 side skirt" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </div>

          <div>
            <Label htmlFor="proto-garage">Car from your Garage</Label>
            <Select value={garageCarId} onValueChange={setGarageCarId}>
              <SelectTrigger id="proto-garage">
                <SelectValue placeholder="Pick a car…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {garageCars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <Car className="h-3 w-3" />
                      {[c.year, c.make, c.model, c.trim].filter(Boolean).join(" ")}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Pick a car to see the part fitted on it as the main preview.
            </p>
          </div>

          <div>
            <Label htmlFor="proto-car">Or describe the car (optional)</Label>
            <Input id="proto-car" placeholder="e.g. Porsche Boxster 986" value={carContext} onChange={(e) => setCarContext(e.target.value)} maxLength={200} />
            <p className="text-[11px] text-muted-foreground mt-1">Used purely as context to help the AI get proportions right.</p>
          </div>

          <div>
            <Label htmlFor="proto-notes">Describe the part / notes for the AI</Label>
            <Textarea
              id="proto-notes"
              placeholder='e.g. "vented carbon side scoop with a single horizontal slat, GT3-style", or "remove the badge from photo 2"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Required if you don't upload reference photos. Otherwise, use this to guide the AI (what to ignore, omit, or treat differently).
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border bg-surface-0/40 p-3 cursor-pointer">
            <Checkbox
              id="proto-replicate"
              checked={replicateExact}
              onCheckedChange={(v) => setReplicateExact(v === true)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium">Replicate exactly</div>
              <p className="text-[11px] text-muted-foreground">
                Tick this if you want a faithful replica of the part in the photos. Leave unticked for a cleaner, idealised version.
              </p>
            </div>
          </label>

          <div>
            <Label>Reference photos (optional)</Label>
            <div className="mt-1 rounded-lg border border-dashed border-border bg-surface-0/40 p-3">
              <label className="flex items-center justify-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                <Upload className="h-3.5 w-3.5" />
                Click to add photos ({files.length}/{MAX_FILES})
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => onPick(e.target.files)}
                  disabled={files.length >= MAX_FILES}
                />
              </label>
              {files.length > 0 && (
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {files.map((f, i) => (
                    <div key={i} className="relative aspect-square overflow-hidden rounded border border-border bg-surface-0">
                      <img src={URL.createObjectURL(f)} alt={f.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setFiles((cur) => cur.filter((_, idx) => idx !== i))}
                        className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="hero" onClick={submit} disabled={submitting || (!files.length && !notes.trim())}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating…</> : <>Create prototype</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────────────────────── */
/* Workspace dialog                              */
/* ───────────────────────────────────────────── */

function PrototypeWorkspace({ prototype, onClose }: { prototype: Prototype | null; onClose: () => void }) {
  const { toast } = useToast();
  const [meshProgress, setMeshProgress] = useState(0);
  const [busy, setBusy] = useState<"render" | "mesh" | "fit" | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const mountRef = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => ((prototype?.source_image_urls as string[]) ?? []), [prototype]);
  const renders = useMemo(() => ((prototype?.render_urls as Array<{ angle: string; url: string }>) ?? []), [prototype]);
  const glbUrl = prototype?.glb_url ?? null;
  const fitUrl = (prototype as any)?.fit_preview_url ?? null;
  const fitStatus = (prototype as any)?.fit_preview_status ?? "idle";
  const garageCarId = (prototype as any)?.garage_car_id ?? null;
  const genMode: PrototypeGenerationMode = (prototype as any)?.generation_mode ?? "exact_photo";
  const isolatedRefs = useMemo(
    () => (((prototype as any)?.isolated_ref_urls as string[]) ?? []),
    [prototype],
  );
  const referenceStatus: string = (prototype as any)?.reference_status ?? "idle";
  const referenceError: string | null = (prototype as any)?.reference_error ?? null;
  const placement: string | null = (prototype as any)?.placement_hint ?? null;
  const showIsolatedPanel = genMode === "exact_photo" && sources.length > 0;

  // Three.js viewer
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !glbUrl) return;
    const w = mount.clientWidth, h = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
    camera.position.set(0, 0.4, 1.4);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(2, 3, 2);
    scene.add(dir);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    let cancelled = false;
    new GLTFLoader().load(
      glbUrl,
      (gltf) => {
        if (cancelled) return;
        const obj = gltf.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3()).length() || 1;
        const center = box.getCenter(new THREE.Vector3());
        obj.position.sub(center);
        const scale = 1.2 / size;
        obj.scale.setScalar(scale);
        scene.add(obj);
      },
      undefined,
      (err) => console.error("GLB load failed", err),
    );
    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    const onResize = () => {
      const ww = mount.clientWidth, hh = mount.clientHeight;
      camera.aspect = ww / hh; camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      mount.innerHTML = "";
    };
  }, [glbUrl]);

  if (!prototype) return null;

  const startRender = async () => {
    setBusy("render");
    try {
      // For exact_photo with photos, isolate the part first so the downstream
      // renders work from a clean reference instead of a busy raw photo.
      if (genMode === "exact_photo" && sources.length > 0 && isolatedRefs.length === 0) {
        const iso = await supabase.functions.invoke("isolate-prototype-part", {
          body: { prototype_id: prototype.id },
        });
        if (iso.error) throw iso.error;
        if ((iso.data as any)?.error) throw new Error((iso.data as any).error);
      }

      const { data, error } = await supabase.functions.invoke("render-prototype-views", {
        body: { prototype_id: prototype.id, revision_note: revisionNote.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      // Function now runs in the background (returns 202). Poll until done.
      const deadline = Date.now() + 5 * 60 * 1000;
      let finalRow: any = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const { data: fresh } = await (supabase as any)
          .from("prototypes").select("*").eq("id", prototype.id).maybeSingle();
        if (fresh) {
          Object.assign(prototype, fresh);
          if (fresh.render_status === "ready") { finalRow = fresh; break; }
          if (fresh.render_status === "failed") {
            throw new Error(fresh.render_error ?? "render failed");
          }
        }
      }
      if (!finalRow) throw new Error("Render timed out");
      setRevisionNote("");
      toast({ title: "Renders ready" });
    } catch (e: any) {
      toast({ title: "Render failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const reisolate = async () => {
    setBusy("render");
    try {
      const iso = await supabase.functions.invoke("isolate-prototype-part", {
        body: { prototype_id: prototype.id },
      });
      if (iso.error) throw iso.error;
      if ((iso.data as any)?.error) throw new Error((iso.data as any).error);
      const { data: fresh } = await (supabase as any)
        .from("prototypes").select("*").eq("id", prototype.id).maybeSingle();
      if (fresh) Object.assign(prototype, fresh);
      toast({ title: "Reference re-isolated" });
    } catch (e: any) {
      toast({ title: "Isolation failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const startMesh = async () => {
    setBusy("mesh");
    setMeshProgress(0);
    try {
      const startRes = await supabase.functions.invoke("meshify-prototype", {
        body: { action: "start", prototype_id: prototype.id },
      });
      if (startRes.error) throw startRes.error;
      if ((startRes.data as any)?.error) throw new Error((startRes.data as any).error);

      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const pollRes = await supabase.functions.invoke("meshify-prototype", {
          body: { action: "status", prototype_id: prototype.id },
        });
        if (pollRes.error) throw pollRes.error;
        const pd = pollRes.data as any;
        if (pd?.error) throw new Error(pd.error);
        if (typeof pd?.progress === "number") setMeshProgress(pd.progress);
        if (pd?.status === "SUCCEEDED") {
          toast({ title: "Mesh ready", description: "Saved to your library." });
          setBusy(null);
          return;
        }
        if (pd?.status === "FAILED") throw new Error(pd.error || "Mesh failed");
      }
      throw new Error("Mesh timed out");
    } catch (e: any) {
      toast({ title: "Meshing failed", description: String(e.message ?? e), variant: "destructive" });
      setBusy(null);
    }
  };

  const startFit = async () => {
    setBusy("fit");
    try {
      const { data, error } = await supabase.functions.invoke("render-prototype-on-car", {
        body: { prototype_id: prototype.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const { data: fresh } = await (supabase as any).from("prototypes").select("*").eq("id", prototype.id).maybeSingle();
      if (fresh) Object.assign(prototype, fresh);
      toast({ title: "Fit preview ready" });
    } catch (e: any) {
      toast({ title: "Fit preview failed", description: String(e.message ?? e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const downloadStl = async () => {
    if (!glbUrl) return;
    try {
      const out = await fetchAsDownloadableMesh(glbUrl, "model/gltf-binary");
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${prototype.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${out.ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      toast({ title: "Download failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const isRendering = busy === "render" || prototype.render_status === "rendering";
  const isMeshing = busy === "mesh" || prototype.mesh_status === "meshing";
  const isFitting = busy === "fit" || fitStatus === "rendering";
  const hasRenderInput = sources.length > 0 || !!prototype.notes?.trim() || !!prototype.title?.trim();

  return (
    <Dialog open={!!prototype} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1600px,95vw)] w-[95vw] h-[92vh] max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beaker className="h-4 w-4 text-fuchsia-400" /> {prototype.title}
          </DialogTitle>
          <DialogDescription>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest">
                {MODE_OPTIONS.find((m) => m.value === genMode)?.label ?? genMode}
              </Badge>
              {placement && (
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-widest">
                  {placement}
                </Badge>
              )}
              <span className="text-muted-foreground">
                {prototype.car_context ? `For ${prototype.car_context}.` : "No car context."} {sources.length} reference photo{sources.length === 1 ? "" : "s"}.
              </span>
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable body so the hero never gets squashed by the secondary grid below. */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
        {/* HERO PANEL — On-car carbon composite (or clay hero fallback if no car). */}
        <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden" style={{ aspectRatio: "16 / 9" }}>
          <span className="absolute top-1.5 left-1.5 z-10 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
            {garageCarId ? "On car (carbon)" : "Hero render"}
          </span>
          {garageCarId ? (
            isFitting || (isRendering && !fitUrl) ? (
              <div className="absolute inset-0 grid place-items-center text-primary">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Fitting on car…</span>
                </div>
              </div>
            ) : fitUrl ? (
              <img src={fitUrl} alt="Part fitted on car" className="absolute inset-0 w-full h-full object-contain" />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                <div className="flex flex-col items-center gap-1">
                  <Car className="h-7 w-7 opacity-40" />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Click "Render preview"</span>
                </div>
              </div>
            )
          ) : isRendering && !renders.length ? (
            <div className="absolute inset-0 grid place-items-center text-primary">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[10px] font-mono uppercase tracking-widest">Drawing…</span>
              </div>
            </div>
          ) : renders[0]?.url ? (
            <img src={renders[0].url} alt="Hero clay render" className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2 text-center px-6">
                <Wand2 className="h-7 w-7 opacity-40" />
                <span className="text-[10px] font-mono uppercase tracking-widest">Click "Render preview"</span>
                <span className="text-[11px] text-muted-foreground/80 max-w-xs">
                  Tip: link a Garage car (from the prototype settings) to see this part fitted on the car in carbon as the main preview.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* SECONDARY GRID — sources / clay views / 3D */}
        <div
          className={`grid gap-2 grid-cols-1 ${showIsolatedPanel ? "md:grid-cols-4" : "md:grid-cols-3"}`}
          style={{ minHeight: "260px" }}
        >
          {/* Pane 1 — Source photos */}
          <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden" style={{ aspectRatio: "4 / 3" }}>
            <span className="absolute top-1 left-1 z-10 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
              Source
            </span>
            <div className="absolute inset-0 grid grid-cols-2 gap-1 p-1 overflow-auto">
              {sources.map((u, i) => (
                <img key={u + i} src={u} alt="" className="rounded object-cover w-full h-full" />
              ))}
              {sources.length === 0 && (
                <div className="col-span-2 grid place-items-center text-muted-foreground">
                  <ImageIcon className="h-6 w-6 opacity-40" />
                </div>
              )}
            </div>
          </div>

          {/* Pane 1.5 — Isolated reference (only for exact_photo mode with photos). */}
          {showIsolatedPanel && (
            <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden group" style={{ aspectRatio: "4 / 3" }}>
              <span className="absolute top-1 left-1 z-10 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
                Isolated reference
              </span>
              {referenceStatus === "processing" || (busy === "render" && !isolatedRefs.length) ? (
                <div className="absolute inset-0 grid place-items-center text-primary">
                  <div className="flex flex-col items-center gap-2">
                    <Sparkles className="h-5 w-5 animate-pulse" />
                    <span className="text-[9px] font-mono uppercase tracking-widest">Isolating…</span>
                  </div>
                </div>
              ) : isolatedRefs[0] ? (
                <>
                  <img src={isolatedRefs[0]} alt="Isolated part reference" className="absolute inset-0 w-full h-full object-contain" />
                  <button
                    type="button"
                    onClick={reisolate}
                    disabled={busy !== null}
                    title="Re-isolate from source photos"
                    className="absolute top-1 right-1 inline-flex items-center gap-1 rounded-md bg-background/70 backdrop-blur px-1.5 py-1 text-[10px] text-foreground/90 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-background/90 disabled:opacity-40"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </>
              ) : referenceStatus === "failed" ? (
                <div className="absolute inset-0 grid place-items-center text-destructive p-3 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <AlertCircle className="h-5 w-5" />
                    <span className="text-[10px]">{referenceError ?? "Isolation failed"}</span>
                    <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px]" onClick={reisolate} disabled={busy !== null}>
                      Retry
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground p-3 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <Sparkles className="h-5 w-5 opacity-40" />
                    <span className="text-[9px] font-mono uppercase tracking-widest">Auto-isolates on render</span>
                    <Button size="sm" variant="outline" className="mt-1 h-6 text-[10px]" onClick={reisolate} disabled={busy !== null}>
                      Isolate now
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pane 2 — Clay views (hero + back) */}
          <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden" style={{ aspectRatio: "4 / 3" }}>
            <span className="absolute top-1 left-1 z-10 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
              Clay views
            </span>
            {isRendering ? (
              <div className="absolute inset-0 grid place-items-center text-primary">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">Drawing…</span>
                </div>
              </div>
            ) : renders.length > 0 ? (
              <div className="absolute inset-0 grid grid-cols-2 gap-1 p-1">
                {renders.map((r) => (
                  <div key={r.url} className="relative bg-surface-0 rounded overflow-hidden">
                    <img src={r.url} alt={r.angle} className="w-full h-full object-contain" />
                    <span className="absolute bottom-1 left-1 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1 py-0.5 rounded">
                      {r.angle}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                <div className="flex flex-col items-center gap-1">
                  <Wand2 className="h-6 w-6 opacity-40" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">No clay views yet</span>
                </div>
              </div>
            )}
          </div>

          {/* Pane 3 — 3D mesh */}
          <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden" style={{ aspectRatio: "4 / 3" }}>
            <span className="absolute top-1 left-1 z-10 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
              3D mesh
            </span>
            {glbUrl ? (
              <div ref={mountRef} className="absolute inset-0" />
            ) : isMeshing ? (
              <div className="absolute inset-0 grid place-items-center text-primary">
                <div className="flex flex-col items-center gap-2">
                  <Box className="h-6 w-6 animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Meshing… {meshProgress}%</span>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                <div className="flex flex-col items-center gap-1">
                  <Box className="h-6 w-6 opacity-40" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">
                    {renders.length ? "Click \"Make 3D model\"" : "Render first"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>{/* /scrollable body */}

        {(prototype.render_error || prototype.mesh_error) && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs p-3 font-mono whitespace-pre-wrap">
            {prototype.mesh_error || prototype.render_error}
          </div>
        )}

        {renders.length > 0 && (
          <div className="rounded-md border border-border bg-surface-0/40 p-2 space-y-1">
            <Label htmlFor="proto-revision" className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
              Revision note for next render
            </Label>
            <Textarea
              id="proto-revision"
              placeholder='e.g. "make the back more hollow", "remove the GT4 text", "sharpen the front edge", "make the opening bigger"'
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              rows={2}
              maxLength={1000}
              disabled={isRendering || isMeshing}
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" /> Close</Button>
          <Button
            variant="outline"
            onClick={startRender}
            disabled={isRendering || isMeshing || isFitting || !hasRenderInput}
          >
            {isRendering ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {genMode === "exact_photo" && sources.length > 0 && !isolatedRefs.length ? "Isolating + rendering…" : "Rendering…"}</>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-1" />
                {renders.length || fitUrl
                  ? (revisionNote.trim() ? "Re-render with note" : "Re-render preview")
                  : genMode === "exact_photo"
                    ? "Render exact fit"
                    : genMode === "text_design"
                      ? "Generate concept"
                      : "Render inspired version"}
              </>
            )}
          </Button>
          {garageCarId && (fitUrl || renders.length > 0) && (
            <Button
              variant="outline"
              onClick={startFit}
              disabled={isRendering || isMeshing || isFitting}
              title="Re-roll just the on-car carbon composite (keeps clay views)"
            >
              {isFitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Fitting…</> : <><Car className="h-4 w-4 mr-1" /> Re-fit on car</>}
            </Button>
          )}
          <Button onClick={startMesh} disabled={isMeshing || isRendering || isFitting || renders.length === 0}>
            {isMeshing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Meshing…</> : <><Box className="h-4 w-4 mr-1" /> {glbUrl ? "Re-mesh" : "Make 3D model"}</>}
          </Button>
          {glbUrl && (
            <Button variant="hero" onClick={downloadStl}>
              <Download className="h-4 w-4 mr-1" /> Download STL
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}