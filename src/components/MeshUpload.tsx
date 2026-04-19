/**
 * MeshUpload — uploads STL / OBJ to the `geometries` storage bucket
 * and patches the geometry row with the new path + source = "upload".
 *
 * Honest framing: the uploaded mesh is used as a *visual reference* in the
 * 3D viewer. The aero estimator still uses the parametric template — we
 * label this clearly with an "Inferred geometry · visual reference only" badge.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/StatusChip";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUpdateGeometry, type Geometry } from "@/lib/repo";
import { Upload, FileBox, Trash2, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const ACCEPTED = [".stl", ".obj"];

interface Props {
  geometry: Geometry;
}

export function MeshUpload({ geometry }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const update = useUpdateGeometry();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState(false);

  const handleFile = async (file: File) => {
    if (!user) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      toast({
        title: "Unsupported file",
        description: "Upload an STL or OBJ mesh.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        title: "File too large",
        description: `Maximum 50 MB. This file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
        variant: "destructive",
      });
      return;
    }

    setBusy(true);
    setProgress(15);

    try {
      const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
      const path = `${user.id}/${geometry.build_id}/${Date.now()}_${safe}`;

      // If there's an existing upload, remove it first (best-effort).
      if (geometry.stl_path) {
        await supabase.storage.from("geometries").remove([geometry.stl_path]).catch(() => {});
      }

      setProgress(40);
      const { error: upErr } = await supabase.storage
        .from("geometries")
        .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (upErr) throw upErr;

      setProgress(80);
      await update.mutateAsync({
        id: geometry.id,
        patch: {
          stl_path: path,
          source: "upload",
          metadata: {
            ...((geometry.metadata as object) ?? {}),
            mesh_filename: file.name,
            mesh_bytes: file.size,
            mesh_uploaded_at: new Date().toISOString(),
          },
        },
      });
      setProgress(100);
      toast({
        title: "Mesh uploaded",
        description: `${file.name} is now linked to this build.`,
      });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 600);
    }
  };

  const handleRemove = async () => {
    if (!geometry.stl_path) return;
    setBusy(true);
    try {
      await supabase.storage.from("geometries").remove([geometry.stl_path]).catch(() => {});
      await update.mutateAsync({
        id: geometry.id,
        patch: { stl_path: null, source: "template" },
      });
      toast({ title: "Mesh removed", description: "Reverted to template baseline." });
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const filename =
    (geometry.metadata as any)?.mesh_filename ??
    geometry.stl_path?.split("/").pop() ??
    null;

  return (
    <div className="glass rounded-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileBox className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold tracking-tight">Custom mesh</h3>
        </div>
        {geometry.stl_path ? (
          <StatusChip tone="success" size="sm">Uploaded</StatusChip>
        ) : (
          <StatusChip tone="muted" size="sm">Template baseline</StatusChip>
        )}
      </div>

      <div className="p-4 space-y-3">
        {geometry.stl_path ? (
          <div className="rounded-md border border-border bg-surface-1 p-3 flex items-start gap-3">
            <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{filename}</div>
              <div className="text-mono text-[10px] text-muted-foreground mt-0.5">
                Inferred geometry · visual reference only. Aero estimates still use the chassis template.
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              disabled={busy}
              className="text-destructive hover:text-destructive shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            disabled={busy}
            className={cn(
              "group w-full rounded-md border-2 border-dashed p-6 text-center transition-colors",
              drag
                ? "border-primary/60 bg-primary/[0.06]"
                : "border-border bg-surface-1 hover:border-primary/30",
              busy && "opacity-60 cursor-wait",
            )}
          >
            <Upload className="mx-auto h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
            <div className="mt-2 text-sm font-medium">
              {busy ? `Uploading… ${progress}%` : "Drop STL or OBJ"}
            </div>
            <div className="text-mono text-[10px] text-muted-foreground mt-1">
              Up to 50 MB · used as visual reference in the 3D viewer
            </div>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".stl,.obj"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />

        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-surface-0 p-3">
          <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-mono text-[10px] text-muted-foreground leading-relaxed">
            Uploads are private to your account. The mesh is shown for design context only —
            aero numbers remain comparative geometry-aware estimates derived from the chassis template.
          </p>
        </div>
      </div>
    </div>
  );
}
