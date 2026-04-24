import { useState } from "react";
import { Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Wand2, ShieldAlert, Plus, Trash2, FolderInput, Shapes, Library } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin, useCarTemplates } from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  useMeshyGenerations,
  useRecordMeshyGeneration,
  useDeleteMeshyGeneration,
  usePromoteToLibrary,
  usePromoteToBodySkin,
  type MeshyGeneration,
  type MeshyGenerationType,
} from "@/lib/meshy-admin";
import { formatDistanceToNow } from "date-fns";

const NONE = "__none__";

const TYPE_LABELS: Record<MeshyGenerationType, string> = {
  body_skin: "Body skin (full shell)",
  part: "Part (single component)",
};

const STATUS_TONES: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/15 text-primary",
  complete: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

/**
 * Meshy Admin — record manual Meshy generations and promote them into the
 * Part Library or Body Skin Library. Behind the scenes the meshing edge
 * functions (Hunyuan3D / Meshy) are already live; this UI logs the run and
 * wires the resulting URLs into our content tables.
 */
export default function MeshyAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin(user?.id);
  const { data: templates = [] } = useCarTemplates();
  const { data: gens = [], isLoading } = useMeshyGenerations();
  const record = useRecordMeshyGeneration();
  const del = useDeleteMeshyGeneration();
  const promoteLib = usePromoteToLibrary();
  const promoteSkin = usePromoteToBodySkin();

  const [open, setOpen] = useState(false);

  /* New generation form */
  const [genType, setGenType] = useState<MeshyGenerationType>("part");
  const [prompt, setPrompt] = useState("");
  const [glbUrl, setGlbUrl] = useState("");
  const [stlUrl, setStlUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [donor, setDonor] = useState<string>(NONE);

  /* Promote dialog */
  const [promoting, setPromoting] = useState<MeshyGeneration | null>(null);
  const [promoteName, setPromoteName] = useState("");

  const reset = () => {
    setGenType("part"); setPrompt(""); setGlbUrl(""); setStlUrl("");
    setPreviewUrl(""); setDonor(NONE);
  };

  const handleRecord = async () => {
    if (!user) return;
    if (!prompt.trim()) {
      toast({ title: "Add a prompt", variant: "destructive" });
      return;
    }
    if (!glbUrl && !stlUrl) {
      toast({ title: "Add an output URL", description: "Provide at least a GLB or STL URL.", variant: "destructive" });
      return;
    }
    try {
      await record.mutateAsync({
        userId: user.id,
        generation_type: genType,
        prompt,
        output_glb_url: glbUrl || null,
        output_stl_url: stlUrl || null,
        preview_url: previewUrl || null,
        donor_car_template_id: donor === NONE ? null : donor,
        status: "complete",
      });
      toast({ title: "Generation recorded" });
      setOpen(false);
      reset();
    } catch (e: any) {
      toast({ title: "Couldn't record", description: e.message, variant: "destructive" });
    }
  };

  const handlePromote = async () => {
    if (!promoting) return;
    const name = promoteName.trim() || promoting.prompt.slice(0, 60) || "Untitled";
    try {
      if (promoting.generation_type === "body_skin") {
        await promoteSkin.mutateAsync({ generation: promoting, name });
        toast({ title: "Saved to Body Skin Library" });
      } else {
        await promoteLib.mutateAsync({ generation: promoting, title: name });
        toast({ title: "Saved to Part Library" });
      }
      setPromoting(null);
      setPromoteName("");
    } catch (e: any) {
      toast({ title: "Couldn't promote", description: e.message, variant: "destructive" });
    }
  };

  if (roleLoading) {
    return (
      <AppLayout>
        <div className="container mx-auto p-8 text-sm text-muted-foreground">Checking access…</div>
      </AppLayout>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-8">
        <PageHeader
          eyebrow="Admin"
          title="Meshy Admin"
          description="Record Meshy / Hunyuan3D generations and promote them into the Part or Body Skin libraries."
          actions={
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-1.5" /> Record generation</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Record Meshy generation</DialogTitle>
                  <DialogDescription>
                    Log a completed mesh from Meshy / Hunyuan3D so you can promote it into the libraries.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Type</Label>
                    <Select value={genType} onValueChange={(v) => setGenType(v as MeshyGenerationType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="part">{TYPE_LABELS.part}</SelectItem>
                        <SelectItem value="body_skin">{TYPE_LABELS.body_skin}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Prompt</Label>
                    <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
                      placeholder="e.g. Aggressive carbon front splitter…" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>GLB URL</Label>
                      <Input value={glbUrl} onChange={(e) => setGlbUrl(e.target.value)} placeholder="https://…/mesh.glb" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>STL URL</Label>
                      <Input value={stlUrl} onChange={(e) => setStlUrl(e.target.value)} placeholder="https://…/mesh.stl" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Preview image URL</Label>
                    <Input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} placeholder="https://…/preview.png" />
                  </div>
                  {genType === "body_skin" && (
                    <div className="space-y-1.5">
                      <Label>Donor car template</Label>
                      <Select value={donor} onValueChange={setDonor}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— None —</SelectItem>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.make} {t.model}{t.trim ? ` ${t.trim}` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={handleRecord} disabled={record.isPending}>
                    <Wand2 className="h-4 w-4 mr-1.5" />
                    {record.isPending ? "Recording…" : "Record"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        {isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="glass h-20 rounded-xl animate-pulse" />)}</div>
        ) : gens.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">No generations recorded yet</h2>
            <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
              After running a Meshy / Hunyuan3D job, paste the output URL here to promote it into the Part or Body Skin library.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {gens.map((g) => (
              <div key={g.id} className="glass rounded-xl p-4 flex items-start gap-4">
                <div className="h-20 w-20 rounded-md overflow-hidden bg-surface-2 flex items-center justify-center shrink-0">
                  {g.preview_url ? (
                    <img src={g.preview_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <Wand2 className="h-6 w-6 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[g.generation_type]}</Badge>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_TONES[g.status] ?? STATUS_TONES.queued}`}>
                      {g.status}
                    </span>
                    {g.saved_library_item_id && (
                      <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                        <Library className="h-3 w-3 mr-1" /> in Library
                      </Badge>
                    )}
                    {g.saved_body_skin_id && (
                      <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                        <Shapes className="h-3 w-3 mr-1" /> in Skins
                      </Badge>
                    )}
                    <span className="text-mono text-[10px] text-muted-foreground ml-auto">
                      {formatDistanceToNow(new Date(g.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="text-sm line-clamp-2">{g.prompt || <span className="text-muted-foreground italic">No prompt</span>}</div>
                  <div className="flex flex-wrap gap-1 text-mono text-[10px] text-muted-foreground">
                    {g.output_glb_url && <span className="px-1.5 py-0.5 rounded bg-surface-2">GLB</span>}
                    {g.output_stl_url && <span className="px-1.5 py-0.5 rounded bg-surface-2">STL</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" variant="outline"
                    disabled={(!g.output_glb_url && !g.output_stl_url) ||
                      (g.generation_type === "body_skin" ? !!g.saved_body_skin_id : !!g.saved_library_item_id)}
                    onClick={() => { setPromoting(g); setPromoteName(""); }}>
                    <FolderInput className="h-3.5 w-3.5 mr-1" />
                    Save to {g.generation_type === "body_skin" ? "Skins" : "Library"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                    onClick={() => del.mutate(g.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promote dialog */}
      <Dialog open={!!promoting} onOpenChange={(o) => !o && setPromoting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Promote to {promoting?.generation_type === "body_skin" ? "Body Skin Library" : "Part Library"}
            </DialogTitle>
            <DialogDescription>
              Saves this mesh as a reusable asset. You can rename it after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={promoteName} onChange={(e) => setPromoteName(e.target.value)}
              placeholder={promoting?.prompt.slice(0, 60) || "Untitled"} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromoting(null)}>Cancel</Button>
            <Button onClick={handlePromote} disabled={promoteLib.isPending || promoteSkin.isPending}>
              <FolderInput className="h-4 w-4 mr-1.5" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
