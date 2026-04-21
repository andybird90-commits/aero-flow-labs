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
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Beaker, Plus, Loader2, Wand2, Box, Download, Trash2, Upload, X, Image as ImageIcon,
} from "lucide-react";
import {
  useMyPrototypes, useCreatePrototype, useDeletePrototype, type Prototype,
} from "@/lib/repo";
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
            if (data) setActive(data as Prototype);
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
  const thumb = renders[0]?.url ?? sources[0] ?? null;

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
  const [title, setTitle] = useState("");
  const [carContext, setCarContext] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setCarContext("");
      setFiles([]);
      setSubmitting(false);
    }
  }, [open]);

  const onPick = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = [...files, ...Array.from(incoming)].slice(0, MAX_FILES);
    setFiles(next);
  };

  const submit = async () => {
    if (!userId) return;
    if (!files.length) { toast({ title: "Add at least one photo", variant: "destructive" }); return; }
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
        source_image_urls: uploadedUrls,
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New prototype</DialogTitle>
          <DialogDescription>
            Upload 1–5 photos of the part. Clear product-style shots work best — but on-car photos are fine too.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="proto-title">Name</Label>
            <Input id="proto-title" placeholder="e.g. Boxster 986 side skirt" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="proto-car">Car (optional)</Label>
            <Input id="proto-car" placeholder="e.g. Porsche Boxster 986" value={carContext} onChange={(e) => setCarContext(e.target.value)} />
            <p className="text-[11px] text-muted-foreground mt-1">Used purely as context to help the AI get proportions right.</p>
          </div>
          <div>
            <Label>Reference photos</Label>
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
          <Button variant="hero" onClick={submit} disabled={submitting || !files.length}>
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
  const [busy, setBusy] = useState<"render" | "mesh" | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const sources = useMemo(() => ((prototype?.source_image_urls as string[]) ?? []), [prototype]);
  const renders = useMemo(() => ((prototype?.render_urls as Array<{ angle: string; url: string }>) ?? []), [prototype]);
  const glbUrl = prototype?.glb_url ?? null;

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
      const { data, error } = await supabase.functions.invoke("render-prototype-views", {
        body: { prototype_id: prototype.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      // Force-refresh in case realtime is slow/down so the workspace shows the new renders.
      const { data: fresh } = await (supabase as any).from("prototypes").select("*").eq("id", prototype.id).maybeSingle();
      if (fresh) {
        // mutate the active row in the parent via a custom event-like callback would be cleaner,
        // but the simplest fix is to surface the new render_urls immediately by reloading the dialog.
        Object.assign(prototype, fresh);
      }
      toast({ title: "Renders ready" });
    } catch (e: any) {
      toast({ title: "Render failed", description: String(e.message ?? e), variant: "destructive" });
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

  return (
    <Dialog open={!!prototype} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beaker className="h-4 w-4 text-fuchsia-400" /> {prototype.title}
          </DialogTitle>
          <DialogDescription>
            {prototype.car_context ? `For ${prototype.car_context}.` : "No car context."} {sources.length} reference photo{sources.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid gap-2 grid-rows-3 md:grid-rows-1 md:grid-cols-3">
          {/* Pane 1 — Source photos */}
          <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden">
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

          {/* Pane 2 — AI renders */}
          <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden">
            <span className="absolute top-1 left-1 z-10 text-[9px] uppercase tracking-widest font-mono bg-surface-0/80 text-muted-foreground px-1.5 py-0.5 rounded">
              Rendered
            </span>
            {isRendering ? (
              <div className="absolute inset-0 grid place-items-center text-primary">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">Drawing…</span>
                </div>
              </div>
            ) : renders.length > 0 ? (
              <div className="absolute inset-0 grid grid-cols-1 gap-1 p-1 overflow-auto">
                {renders.map((r) => (
                  <div key={r.url} className="relative">
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
                  <span className="text-[9px] font-mono uppercase tracking-widest">Click "Render views"</span>
                </div>
              </div>
            )}
          </div>

          {/* Pane 3 — 3D mesh */}
          <div className="relative rounded-md border border-border bg-surface-0 overflow-hidden">
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

        {(prototype.render_error || prototype.mesh_error) && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs p-3 font-mono whitespace-pre-wrap">
            {prototype.mesh_error || prototype.render_error}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" /> Close</Button>
          <Button variant="outline" onClick={startRender} disabled={isRendering || isMeshing || sources.length === 0}>
            {isRendering ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Rendering…</> : <><Wand2 className="h-4 w-4 mr-1" /> {renders.length ? "Re-render views" : "Render views"}</>}
          </Button>
          <Button onClick={startMesh} disabled={isMeshing || isRendering || renders.length === 0}>
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