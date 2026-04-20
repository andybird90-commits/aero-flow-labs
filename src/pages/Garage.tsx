/**
 * Garage page — user's collection of OEM reference cars.
 *
 * Each car has 4 AI-generated canonical views (front 3/4, side, rear 3/4,
 * rear) that get used as identity references whenever a project linked to
 * the car generates concepts. This locks the AI to "this is a 2015 BMW M3
 * F80 in Yas Marina blue" instead of drifting to a generic coupe.
 */
import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/StatusChip";
import { useAuth } from "@/hooks/useAuth";
import {
  useGarageCars,
  useCreateGarageCar,
  useDeleteGarageCar,
  useGenerateGarageCarViews,
  type GarageCar,
} from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import {
  Car as CarIcon,
  Plus,
  Trash2,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function Garage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: cars = [], isLoading } = useGarageCars(user?.id);
  const create = useCreateGarageCar();
  const del = useDeleteGarageCar();
  const generate = useGenerateGarageCarViews();

  const [openAdd, setOpenAdd] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [form, setForm] = useState({ make: "", model: "", year: "", trim: "", color: "", notes: "" });

  const handleCreate = async () => {
    if (!user) return;
    if (!form.make.trim() || !form.model.trim()) {
      toast({ title: "Make and model required", variant: "destructive" });
      return;
    }
    try {
      const car = await create.mutateAsync({
        userId: user.id,
        make: form.make,
        model: form.model,
        year: form.year ? Number(form.year) : null,
        trim: form.trim,
        color: form.color,
        notes: form.notes,
      });
      setOpenAdd(false);
      setForm({ make: "", model: "", year: "", trim: "", color: "", notes: "" });
      // Kick off generation right away
      await generate.mutateAsync(car.id);
      toast({
        title: "Car added",
        description: "Generating 6 reference views… this takes ~45s.",
      });
    } catch (e: any) {
      toast({ title: "Couldn't add car", description: e.message, variant: "destructive" });
    }
  };

  const handleRegenerate = async (id: string) => {
    try {
      await generate.mutateAsync(id);
      toast({ title: "Regenerating views", description: "Hang tight — ~45s." });
    } catch (e: any) {
      toast({ title: "Regenerate failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
              Studio
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Garage</h1>
            <p className="mt-1.5 text-muted-foreground">
              Your OEM reference cars. The AI uses these 6 views as the identity
              anchor whenever a linked project generates concepts.
            </p>
          </div>
          <Button variant="hero" size="lg" onClick={() => setOpenAdd(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add car
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="glass h-72 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : cars.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
              <CarIcon className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Your garage is empty</h2>
            <p className="mt-2 text-muted-foreground">
              Add an OEM car so the AI can reference it on every concept render.
            </p>
            <Button variant="hero" size="lg" className="mt-6" onClick={() => setOpenAdd(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add your first car
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {cars.map((c) => (
              <CarCard
                key={c.id}
                car={c}
                onRegenerate={() => handleRegenerate(c.id)}
                onDelete={() => setConfirmDel(c.id)}
                regenerating={generate.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add car dialog */}
      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a car to your garage</DialogTitle>
            <DialogDescription>
              The AI will generate 6 canonical views from your description.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="make">Make *</Label>
              <Input id="make" value={form.make} placeholder="BMW"
                onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model *</Label>
              <Input id="model" value={form.model} placeholder="M3"
                onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="year">Year</Label>
              <Input id="year" type="number" value={form.year} placeholder="2015"
                onChange={(e) => setForm({ ...form, year: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trim">Trim / chassis</Label>
              <Input id="trim" value={form.trim} placeholder="F80 Competition"
                onChange={(e) => setForm({ ...form, trim: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="color">Paint colour</Label>
              <Input id="color" value={form.color} placeholder="Yas Marina Blue"
                onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="notes">Notes (wheels, stance, era…)</Label>
              <Textarea id="notes" value={form.notes} rows={3}
                placeholder="OEM 19in 666M wheels, factory ride height, no modifications"
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenAdd(false)}>Cancel</Button>
            <Button variant="hero" onClick={handleCreate}
              disabled={create.isPending || generate.isPending}>
              <Sparkles className="mr-2 h-4 w-4" /> Add & generate views
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this car?</AlertDialogTitle>
            <AlertDialogDescription>
              Projects currently linked to it will lose their identity reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDel) return;
                try {
                  await del.mutateAsync(confirmDel);
                  toast({ title: "Car removed" });
                } catch (e: any) {
                  toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
                }
                setConfirmDel(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function CarCard({
  car, onRegenerate, onDelete, regenerating,
}: {
  car: GarageCar;
  onRegenerate: () => void;
  onDelete: () => void;
  regenerating: boolean;
}) {
  const title = [car.year, car.make, car.model].filter(Boolean).join(" ");
  const sub = [car.trim, car.color].filter(Boolean).join(" · ");
  const status = car.generation_status;
  const tone =
    status === "ready" ? "success" :
    status === "failed" ? "failed" :
    status === "generating" ? "simulating" : "neutral";

  const views = [
    { url: car.ref_front_url,          label: "Front" },
    { url: car.ref_front34_url,        label: "Front 3/4" },
    { url: car.ref_side_url,           label: "Side" },
    { url: car.ref_side_opposite_url,  label: "Side (opp)" },
    { url: car.ref_rear34_url,         label: "Rear 3/4" },
    { url: car.ref_rear_url,           label: "Rear" },
  ];

  return (
    <div className="glass rounded-xl overflow-hidden flex flex-col">
      <div className="p-4 flex items-start justify-between gap-3 border-b border-border">
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight truncate">{title || "Untitled car"}</div>
          {sub && <div className="text-mono text-[11px] text-muted-foreground truncate mt-0.5">{sub}</div>}
        </div>
        <StatusChip tone={tone as any} size="sm">{status}</StatusChip>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border">
        {views.map((v) => (
          <div key={v.label} className="aspect-video bg-surface-2 relative">
            {v.url ? (
              <img src={v.url} alt={v.label} loading="lazy"
                className="absolute inset-0 h-full w-full object-cover" />
            ) : status === "generating" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="text-mono text-[10px] uppercase tracking-widest mt-1.5">{v.label}</span>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <span className="text-mono text-[10px] uppercase tracking-widest">{v.label}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {status === "failed" && car.generation_error && (
        <div className="px-4 py-2 border-t border-border bg-destructive/10 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span className="break-words">{car.generation_error}</span>
        </div>
      )}

      <div className="flex items-center justify-between p-3 border-t border-border">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
          onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="glass" size="sm" onClick={onRegenerate}
          disabled={regenerating || status === "generating"}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${status === "generating" ? "animate-spin" : ""}`} />
          {status === "ready" ? "Regenerate views" : status === "generating" ? "Generating…" : "Generate views"}
        </Button>
      </div>
    </div>
  );
}
