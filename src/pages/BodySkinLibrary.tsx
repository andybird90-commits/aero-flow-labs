import { useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Shapes, Upload, Trash2, FileBox, Image as ImageIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useCarTemplates } from "@/lib/repo";
import { useBodySkins, useUploadBodySkin, useDeleteBodySkin, type BodySkin } from "@/lib/body-skins";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

/**
 * Body Skin Library — admin-managed full bodyswap shells.
 *
 * Upload .stl/.glb meshes (with an optional preview thumbnail) and tag them
 * to a donor car_template. Used in the Build Studio Shell Fit Mode to drape
 * over the donor car for visual alignment.
 */
export default function BodySkinLibrary() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: skins = [], isLoading } = useBodySkins();
  const { data: templates = [] } = useCarTemplates();
  const upload = useUploadBodySkin();
  const del = useDeleteBodySkin();

  const [openNew, setOpenNew] = useState(false);
  const [deleteSkin, setDeleteSkin] = useState<BodySkin | null>(null);

  /* Form state */
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [donor, setDonor] = useState<string>(NONE);
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  const reset = () => {
    setName(""); setFile(null); setPreview(null);
    setDonor(NONE); setTags(""); setNotes("");
  };

  const handleUpload = async () => {
    if (!user || !file) {
      toast({ title: "Pick a file", description: "Select an .stl or .glb file first.", variant: "destructive" });
      return;
    }
    try {
      await upload.mutateAsync({
        userId: user.id,
        name: name.trim() || file.name.replace(/\.[^.]+$/, ""),
        file,
        previewFile: preview,
        donor_car_template_id: donor === NONE ? null : donor,
        style_tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes,
      });
      toast({ title: "Body skin uploaded" });
      setOpenNew(false);
      reset();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-6 py-8 max-w-6xl space-y-8">
        <PageHeader
          eyebrow="Library"
          title="Body Skin Library"
          description="Full bodyswap shells (GLB / STL) used in Shell Fit Mode to drape over a donor car."
          actions={
            <Dialog open={openNew} onOpenChange={(o) => { setOpenNew(o); if (!o) reset(); }}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="h-4 w-4 mr-1.5" /> Upload skin
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Upload body skin</DialogTitle>
                  <DialogDescription>
                    Upload a .glb or .stl mesh. A preview image is optional but recommended for the library grid.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. M3 widebody shell" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5"><FileBox className="h-3.5 w-3.5" /> Mesh file (.stl / .glb)</Label>
                    <Input type="file" accept=".stl,.glb,.gltf,model/stl,model/gltf-binary"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                    {file && (
                      <div className="text-mono text-[10px] text-muted-foreground">
                        {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5"><ImageIcon className="h-3.5 w-3.5" /> Preview image (optional)</Label>
                    <Input type="file" accept="image/*"
                      onChange={(e) => setPreview(e.target.files?.[0] ?? null)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Donor car template</Label>
                    <Select value={donor} onValueChange={setDonor}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— None —</SelectItem>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.make} {t.model}{t.trim ? ` ${t.trim}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Style tags (comma-separated)</Label>
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="widebody, gt-spec, time-attack" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                      placeholder="Optional: source, fit notes…" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpenNew(false)}>Cancel</Button>
                  <Button onClick={handleUpload} disabled={upload.isPending || !file}>
                    <Upload className="h-4 w-4 mr-1.5" />
                    {upload.isPending ? "Uploading…" : "Upload skin"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        />

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="glass h-56 rounded-xl animate-pulse" />)}
          </div>
        ) : skins.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-primary mb-4">
              <Shapes className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-semibold">No body skins yet</h2>
            <p className="mt-2 mx-auto max-w-md text-sm text-muted-foreground">
              Upload a GLB or STL skin, or generate one in Meshy Admin. Skins appear in the
              Build Studio Shell Fit Mode.
            </p>
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button variant="outline" onClick={() => setOpenNew(true)}>
                <Upload className="h-4 w-4 mr-1.5" /> Upload skin
              </Button>
              <Button asChild>
                <Link to="/meshy-admin">Open Meshy Admin</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {skins.map((s) => {
              const template = templates.find((t) => t.id === s.donor_car_template_id);
              const fileType = s.file_url_glb ? "GLB" : s.file_url_stl ? "STL" : "—";
              return (
                <div key={s.id} className="glass group rounded-xl overflow-hidden flex flex-col">
                  <div className="relative h-40 bg-gradient-to-br from-surface-2 to-surface-0 grid-bg-fine flex items-center justify-center">
                    {s.preview_url ? (
                      <img src={s.preview_url} alt={s.name} loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <Shapes className="h-10 w-10 text-primary/30" />
                    )}
                    <Badge className="absolute top-2 right-2" variant="secondary">{fileType}</Badge>
                  </div>
                  <div className="flex-1 p-4 space-y-2">
                    <div className="text-sm font-semibold tracking-tight truncate">{s.name}</div>
                    <div className="text-mono text-[10px] text-muted-foreground truncate">
                      {template ? `${template.make} ${template.model}` : "Untargeted"}
                    </div>
                    {s.style_tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.style_tags.slice(0, 4).map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-border p-3">
                    <Badge variant="outline" className="text-[10px]">{s.fit_status}</Badge>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteSkin(s)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteSkin} onOpenChange={(o) => !o && setDeleteSkin(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this body skin?</AlertDialogTitle>
            <AlertDialogDescription>
              The mesh file and metadata will be permanently removed. Projects using it in Shell Fit Mode will lose the overlay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteSkin) return;
                try {
                  await del.mutateAsync(deleteSkin);
                  toast({ title: "Body skin deleted" });
                } catch (e: any) {
                  toast({ title: "Couldn't delete", description: e.message, variant: "destructive" });
                }
                setDeleteSkin(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete skin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
