/**
 * My Library — global, personal catalogue of every shareable asset the user
 * has produced across all projects: concept renders, aero kits, single parts.
 *
 * Auto-populated by DB triggers on concepts / concept_parts. The user can:
 *   • toggle visibility (private / public)
 *   • publish to the marketplace with a price (free or paid)
 *   • unpublish, delete, download
 */
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useMyLibrary, useUpdateLibraryItem, useDeleteLibraryItem,
  usePublishListing, useUnpublishListing,
  type LibraryItem, type MarketplaceListing, type LibraryItemKind,
} from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  Box, Download, Trash2, Image as ImageIcon, Layers, Wrench,
  Globe, Lock, Tag, Store, ImageOff, Beaker, Wand2, Sparkles,
  Upload, Loader2, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MeshStructureChip } from "@/components/build-studio/MeshStructureChip";
import { SculptStudioDialog } from "@/components/build-studio/SculptStudioDialog";
import { SpecPartDialog } from "@/components/build-studio/SpecPartDialog";
import { PartMeshViewer } from "@/components/PartMeshViewer";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const KIND_META: Record<LibraryItemKind, { label: string; icon: any; tone: string }> = {
  concept_image:       { label: "Concept image", icon: ImageIcon, tone: "text-cyan-400"    },
  aero_kit_mesh:       { label: "Aero kit",      icon: Layers,    tone: "text-amber-400"   },
  concept_part_mesh:   { label: "Single part",   icon: Wrench,    tone: "text-emerald-400" },
  prototype_part_mesh: { label: "Prototype",     icon: Beaker,    tone: "text-fuchsia-400" },
  geometry_part_mesh:  { label: "Fitted part",   icon: Wand2,     tone: "text-violet-400"  },
  cad_part_mesh:       { label: "CAD part",      icon: Wrench,    tone: "text-sky-400"     },
  uploaded_part_mesh:  { label: "Uploaded part", icon: Package,   tone: "text-orange-400"  },
};

const FILTERS: Array<{ id: LibraryItemKind | "all"; label: string }> = [
  { id: "all",                 label: "All" },
  { id: "concept_image",       label: "Images" },
  { id: "aero_kit_mesh",       label: "Aero kits" },
  { id: "concept_part_mesh",   label: "Parts" },
  { id: "prototype_part_mesh", label: "Prototypes" },
  { id: "geometry_part_mesh",  label: "Fitted parts" },
  { id: "cad_part_mesh",       label: "CAD parts" },
  { id: "uploaded_part_mesh",  label: "Uploads" },
];

const ACCEPTED_UPLOAD_EXT = ".stl,.glb,.gltf";

function inferMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".stl")) return "model/stl";
  return "application/octet-stream";
}

export default function LibraryPage() {
  const { user } = useAuth();
  const { data: items = [], isLoading } = useMyLibrary(user?.id);
  const update = useUpdateLibraryItem();
  const del = useDeleteLibraryItem();
  const publish = usePublishListing();
  const unpublish = useUnpublishListing();
  const { toast } = useToast();

  const [filter, setFilter] = useState<LibraryItemKind | "all">("all");
  const [publishing, setPublishing] = useState<LibraryItem | null>(null);
  const [sculpting, setSculpting] = useState<LibraryItem | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !user) return;
    const list = Array.from(files);
    const valid = list.filter((f) => /\.(stl|glb|gltf)$/i.test(f.name));
    const skipped = list.length - valid.length;
    if (valid.length === 0) {
      toast({
        title: "No supported files",
        description: "Upload .stl, .glb, or .gltf files.",
        variant: "destructive",
      });
      return;
    }
    setUploading({ done: 0, total: valid.length });
    let ok = 0;
    let failed = 0;
    for (const file of valid) {
      try {
        const ts = Date.now();
        const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
        // Folder must start with the user's id — that's how the bucket RLS keys.
        const path = `${user.id}/parts/${ts}-${safe}`;
        const mime = inferMime(file.name);
        const { error: upErr } = await supabase.storage
          .from("library-uploads")
          .upload(path, file, { contentType: mime, upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("library-uploads").getPublicUrl(path);
        const publicUrl = pub?.publicUrl;
        if (!publicUrl) throw new Error("Could not resolve public URL");

        const titleBase = file.name.replace(/\.(stl|glb|gltf)$/i, "");
        const { error: insErr } = await (supabase as any).from("library_items").insert({
          user_id: user.id,
          kind: "uploaded_part_mesh",
          title: titleBase || "Uploaded part",
          asset_url: publicUrl,
          asset_mime: mime,
          visibility: "private",
          metadata: {
            source: "user_upload",
            original_filename: file.name,
            size_bytes: file.size,
          },
        });
        if (insErr) throw insErr;
        ok++;
      } catch (e: any) {
        console.error("Upload failed for", file.name, e);
        failed++;
      } finally {
        setUploading((prev) => prev ? { done: prev.done + 1, total: prev.total } : prev);
      }
    }
    setUploading(null);
    qc.invalidateQueries({ queryKey: ["library_items"] });
    if (ok > 0) {
      toast({
        title: `Uploaded ${ok} part${ok === 1 ? "" : "s"}`,
        description: failed
          ? `${failed} failed${skipped ? `, ${skipped} skipped (unsupported)` : ""}.`
          : skipped
          ? `${skipped} skipped (unsupported file types).`
          : "Available in your library.",
      });
    } else {
      toast({
        title: "Upload failed",
        description: "None of the files could be uploaded.",
        variant: "destructive",
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const filtered = useMemo(
    () => filter === "all" ? items : items.filter(i => i.kind === filter),
    [items, filter],
  );

  const stats = useMemo(() => ({
    total: items.length,
    images: items.filter(i => i.kind === "concept_image").length,
    kits: items.filter(i => i.kind === "aero_kit_mesh").length,
    parts: items.filter(i => i.kind === "concept_part_mesh").length,
    listed: items.filter(i => i.marketplace_listings?.some(l => l.status === "active")).length,
  }), [items]);

  const togglePrivacy = async (item: LibraryItem & { marketplace_listings: MarketplaceListing[] }) => {
    const willBePublic = item.visibility === "private";
    if (willBePublic) {
      // Going public is treated as "list on marketplace" so they can set a price.
      setPublishing(item);
      return;
    }
    // Unpublishing
    const active = item.marketplace_listings?.find(l => l.status === "active");
    try {
      if (active) {
        await unpublish.mutateAsync({ listing_id: active.id, library_item_id: item.id });
      } else {
        await update.mutateAsync({ id: item.id, visibility: "private" });
      }
      toast({ title: "Made private" });
    } catch (e: any) {
      toast({ title: "Could not update", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  const onDelete = async (item: LibraryItem) => {
    if (!confirm(`Delete "${item.title}" from your library? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(item.id);
      toast({ title: "Deleted from library" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: String(e.message ?? e), variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="My Library"
          title="Your saved assets"
          description="Every concept image, aero kit, and 3D part you've generated — across all projects. Make any of them public to list on the Marketplace."
          actions={
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD_EXT}
                multiple
                className="hidden"
                onChange={(e) => handleUploadFiles(e.target.files)}
              />
              <Button
                variant="hero"
                size="sm"
                onClick={() => setSpecOpen(true)}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Spec part
              </Button>
              <Button
                variant="hero"
                size="sm"
                disabled={!!uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Uploading {uploading.done}/{uploading.total}…
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload parts
                  </>
                )}
              </Button>
              <Button variant="glass" size="sm" asChild>
                <Link to="/marketplace"><Store className="mr-1.5 h-3.5 w-3.5" /> Browse Marketplace</Link>
              </Button>
            </div>
          }
        />
      </div>

      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Stat label="Total" value={stats.total} />
            <Stat label="Images" value={stats.images} />
            <Stat label="Aero kits" value={stats.kits} />
            <Stat label="Parts" value={stats.parts} />
            <Stat label="Listed" value={stats.listed} accent />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  filter === f.id
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="text-center text-muted-foreground py-12">Loading library…</div>
        )}

        {!isLoading && filtered.length === 0 && <EmptyLibrary />}

        {filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(item => (
              <ItemCard
                key={item.id}
                item={item}
                onTogglePrivacy={() => togglePrivacy(item)}
                onPublish={() => setPublishing(item)}
                onDelete={() => onDelete(item)}
                onSculpt={() => setSculpting(item)}
              />
            ))}
          </div>
        )}
      </div>

      <PublishDialog
        item={publishing}
        onClose={() => setPublishing(null)}
        onSubmit={async (price_cents, title, description) => {
          if (!publishing || !user) return;
          try {
            await publish.mutateAsync({
              library_item_id: publishing.id,
              user_id: user.id,
              price_cents,
              title: title || null,
              description: description || null,
            });
            toast({ title: "Listed on Marketplace" });
            setPublishing(null);
          } catch (e: any) {
            toast({ title: "Could not list", description: String(e.message ?? e), variant: "destructive" });
          }
        }}
      />
      <SculptStudioDialog
        item={sculpting}
        open={!!sculpting}
        onOpenChange={(o) => { if (!o) setSculpting(null); }}
      />
    </AppLayout>
  );
}

/* ─── components ────────────────────────────────────────────── */

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-md border px-3 py-2 min-w-[64px]",
      accent ? "border-primary/40 bg-primary/5" : "border-border bg-surface-0/40",
    )}>
      <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function ItemCard({
  item, onTogglePrivacy, onPublish, onDelete, onSculpt,
}: {
  item: LibraryItem & { marketplace_listings: MarketplaceListing[] };
  onTogglePrivacy: () => void;
  onPublish: () => void;
  onDelete: () => void;
  onSculpt: () => void;
}) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const listing = item.marketplace_listings?.find(l => l.status === "active");
  const isPublic = item.visibility === "public";
  const url = (item.asset_url ?? "").toLowerCase().split("?")[0];
  const mime = (item.asset_mime ?? "").toLowerCase();
  const isMesh =
    mime.includes("gltf") || mime.includes("glb") || mime.includes("stl") ||
    url.endsWith(".glb") || url.endsWith(".gltf") || url.endsWith(".stl");

  const download = async () => {
    if (!item.asset_url) return;
    try {
      const { fetchAsDownloadableMesh } = await import("@/lib/glb-to-stl");
      const isImage = item.asset_mime?.startsWith("image/");
      let blob: Blob;
      let ext: string;
      if (isImage) {
        const r = await fetch(item.asset_url);
        blob = await r.blob();
        ext = item.asset_mime === "image/png" ? "png" : "jpg";
      } else {
        // Mesh asset: convert GLB → STL on the fly so CAD tools open it.
        const out = await fetchAsDownloadableMesh(item.asset_url, item.asset_mime);
        blob = out.blob;
        ext = out.ext;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("download failed:", e);
    }
  };

  return (
    <div className="group glass rounded-xl overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-black">
        {item.kind === "uploaded_part_mesh" && item.asset_url && isMesh ? (
          // Live STL/GLB preview for uploaded parts: white mesh on black bg.
          <PartMeshViewer
            url={item.asset_url}
            className="absolute inset-0 h-full w-full"
            background={0x000000}
            meshColor={0xffffff}
          />
        ) : item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.title} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge variant="outline" className={cn("bg-background/70 backdrop-blur", meta.tone)}>
            <Icon className="mr-1 h-3 w-3" />
            {meta.label}
          </Badge>
        </div>
        <div className="absolute top-2 right-2 flex gap-1">
          {listing ? (
            <Badge className="bg-primary/90 text-primary-foreground">
              <Tag className="mr-1 h-3 w-3" />
              {listing.price_cents === 0 ? "Free" : formatPrice(listing.price_cents, listing.currency)}
            </Badge>
          ) : isPublic ? (
            <Badge variant="outline" className="bg-background/70 backdrop-blur"><Globe className="mr-1 h-3 w-3" />Public</Badge>
          ) : (
            <Badge variant="outline" className="bg-background/70 backdrop-blur"><Lock className="mr-1 h-3 w-3" />Private</Badge>
          )}
        </div>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" title={item.title}>{item.title}</div>
          <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {new Date(item.created_at).toLocaleDateString()}
          </div>
          <div className="mt-1.5">
            <MeshStructureChip item={item} variant="pill" />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-surface-0/40 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            {isPublic ? <Globe className="h-3.5 w-3.5 text-primary" /> : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            <span>{isPublic ? "Public" : "Private"}</span>
          </div>
          <Switch
            checked={isPublic}
            onCheckedChange={onTogglePrivacy}
            aria-label="Toggle public visibility"
          />
        </div>

        <div className="mt-auto flex gap-1.5">
          <Button
            variant={listing ? "glass" : "hero"}
            size="sm"
            className="flex-1"
            onClick={onPublish}
          >
            <Store className="mr-1 h-3.5 w-3.5" />
            {listing ? "Edit listing" : "Sell"}
          </Button>
          {isMesh && (
            <Button variant="glass" size="sm" onClick={onSculpt} title="Sculpt this mesh">
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="glass" size="sm" onClick={download} disabled={!item.asset_url} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="sm"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PublishDialog({
  item, onClose, onSubmit,
}: {
  item: LibraryItem | null;
  onClose: () => void;
  onSubmit: (price_cents: number, title: string, description: string) => Promise<void>;
}) {
  const [priceInput, setPriceInput] = useState("0");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset form when item changes
  useMemo(() => {
    if (item) {
      setPriceInput("0");
      setTitle(item.title);
      setDesc(item.description ?? "");
    }
  }, [item?.id]);

  if (!item) return null;

  const cents = Math.max(0, Math.round(parseFloat(priceInput || "0") * 100));

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>List on Marketplace</DialogTitle>
          <DialogDescription>
            Make this asset public and set a price. Use $0 to give it away for free.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="lst-title">Title</Label>
            <Input id="lst-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="lst-desc">Description (optional)</Label>
            <Textarea id="lst-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
          </div>
          <div>
            <Label htmlFor="lst-price">Price (USD)</Label>
            <div className="relative">
              <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground text-sm">$</span>
              <Input
                id="lst-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="pl-6"
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Buyers will see {cents === 0 ? "Free" : formatPrice(cents, "usd")}.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="hero"
            disabled={submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit(cents, title, desc);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Listing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyLibrary() {
  return (
    <div className="glass rounded-xl p-12 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground mb-3">
        <Box className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">Nothing in your library yet</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Generate concepts or extract parts in any project — they'll appear here automatically.
      </p>
      <div className="mt-5">
        <Button variant="hero" size="sm" asChild>
          <Link to="/projects">Open a project</Link>
        </Button>
      </div>
    </div>
  );
}

export function formatPrice(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
