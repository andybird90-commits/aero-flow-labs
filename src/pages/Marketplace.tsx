/**
 * Marketplace — public browse for assets users have listed for sale (or free).
 * Anyone can view (RLS allows public SELECT on active listings + public library
 * items). Buying is stubbed for now: the action shows a "coming soon" toast for
 * paid items, and lets free items be downloaded directly.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  useMarketplaceListings,
  type LibraryItemKind, type MarketplaceListingWithItem,
} from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Store, Download, ImageOff, Image as ImageIcon, Layers, Wrench,
  Search, ShoppingCart, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice } from "./Library";

const KIND_META: Record<LibraryItemKind, { label: string; icon: any; tone: string }> = {
  concept_image:     { label: "Image",     icon: ImageIcon, tone: "text-cyan-400"   },
  aero_kit_mesh:     { label: "Aero kit",  icon: Layers,    tone: "text-amber-400"  },
  concept_part_mesh: { label: "Part",      icon: Wrench,    tone: "text-emerald-400"},
};

const FILTERS: Array<{ id: LibraryItemKind | "all"; label: string }> = [
  { id: "all",               label: "All" },
  { id: "concept_image",     label: "Images" },
  { id: "aero_kit_mesh",     label: "Aero kits" },
  { id: "concept_part_mesh", label: "Single parts" },
];

export default function MarketplacePage() {
  const [filter, setFilter] = useState<LibraryItemKind | "all">("all");
  const [search, setSearch] = useState("");
  const { data: listings = [], isLoading } = useMarketplaceListings({ kind: filter });
  const { user } = useAuth();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(l => {
      const t = (l.title ?? l.library_items?.title ?? "").toLowerCase();
      const d = (l.description ?? l.library_items?.description ?? "").toLowerCase();
      return t.includes(q) || d.includes(q);
    });
  }, [listings, search]);

  const handleAction = async (l: MarketplaceListingWithItem) => {
    const isFree = l.price_cents === 0;
    const item = l.library_items;
    if (!item?.asset_url) {
      toast({ title: "Asset unavailable", variant: "destructive" });
      return;
    }
    if (isFree) {
      const ext =
        item.asset_mime === "image/png" ? "png" :
        item.asset_mime === "model/stl" ? "stl" :
        item.asset_mime === "model/gltf-binary" ? "glb" : "bin";
      try {
        const r = await fetch(item.asset_url);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${item.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e: any) {
        toast({ title: "Download failed", description: String(e.message ?? e), variant: "destructive" });
      }
    } else {
      toast({
        title: "Checkout coming soon",
        description: "Paid checkout will be wired up once payments are enabled.",
      });
    }
  };

  return (
    <AppLayout>
      <div className="px-6 pt-6">
        <PageHeader
          eyebrow="Marketplace"
          title="Browse community-listed assets"
          description="Concept images, full aero kits, and individual 3D parts shared by builders. Free downloads are instant; paid checkout is coming soon."
          actions={
            user && (
              <Button variant="glass" size="sm" asChild>
                <Link to="/library"><Store className="mr-1.5 h-3.5 w-3.5" /> My Library</Link>
              </Button>
            )
          }
        />
      </div>

      <div className="p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search listings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
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
          <div className="text-center text-muted-foreground py-12">Loading marketplace…</div>
        )}

        {!isLoading && filtered.length === 0 && <EmptyMarketplace />}

        {filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map(l => (
              <ListingCard key={l.id} listing={l} onAction={() => handleAction(l)} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ListingCard({
  listing, onAction,
}: {
  listing: MarketplaceListingWithItem;
  onAction: () => void;
}) {
  const item = listing.library_items;
  const meta = item ? KIND_META[item.kind] : null;
  const Icon = meta?.icon;
  const isFree = listing.price_cents === 0;
  const title = listing.title ?? item?.title ?? "Untitled";
  const description = listing.description ?? item?.description ?? "";

  return (
    <div className="group glass rounded-xl overflow-hidden flex flex-col">
      <div className="relative aspect-square bg-surface-0">
        {item?.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={title} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        {meta && Icon && (
          <div className="absolute top-2 left-2">
            <Badge variant="outline" className={cn("bg-background/70 backdrop-blur", meta.tone)}>
              <Icon className="mr-1 h-3 w-3" />
              {meta.label}
            </Badge>
          </div>
        )}
        <div className="absolute top-2 right-2">
          <Badge className={cn(
            isFree ? "bg-emerald-500/90 text-white" : "bg-primary text-primary-foreground",
          )}>
            <Tag className="mr-1 h-3 w-3" />
            {isFree ? "Free" : formatPrice(listing.price_cents, listing.currency)}
          </Badge>
        </div>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" title={title}>{title}</div>
          {description && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{description}</div>
          )}
        </div>
        <div className="mt-auto">
          <Button variant={isFree ? "hero" : "glass"} size="sm" className="w-full" onClick={onAction}>
            {isFree ? (
              <><Download className="mr-1.5 h-3.5 w-3.5" /> Download</>
            ) : (
              <><ShoppingCart className="mr-1.5 h-3.5 w-3.5" /> Buy</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyMarketplace() {
  return (
    <div className="glass rounded-xl p-12 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground mb-3">
        <Store className="h-5 w-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">No listings yet</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Be the first to share an aero kit, a single part, or a concept render with the community.
      </p>
      <div className="mt-5">
        <Button variant="hero" size="sm" asChild>
          <Link to="/library">Open My Library</Link>
        </Button>
      </div>
    </div>
  );
}
