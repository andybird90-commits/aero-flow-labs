import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
  useGarageCars,
} from "@/lib/repo";
import { useToast } from "@/hooks/use-toast";
import { Plus, Hexagon, Sparkles, Trash2, ArrowRight, Clock, Car as CarIcon, Boxes } from "lucide-react";
import { CarTemplatePickerDialog } from "@/components/CarTemplatePickerDialog";
import type { Car } from "@/lib/repo";
import { formatDistanceToNow } from "date-fns";
import { StatusChip } from "@/components/StatusChip";
import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const NONE_VALUE = "__none__";

export default function Projects() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: projects = [], isLoading } = useProjects(user?.id);
  const { data: garageCars = [] } = useGarageCars(user?.id);
  const create = useCreateProject();
  const del = useDeleteProject();
  const update = useUpdateProject();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [templateCar, setTemplateCar] = useState<Car | null>(null);

  const [openNew, setOpenNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGarageCarId, setNewGarageCarId] = useState<string>(NONE_VALUE);

  const openNewDialog = () => {
    setNewName("");
    setNewGarageCarId(NONE_VALUE);
    setOpenNew(true);
  };

  const handleCreate = async () => {
    if (!user) return;
    const name = newName.trim() || "Untitled project";
    try {
      const p = await create.mutateAsync({
        userId: user.id,
        name,
        garageCarId: newGarageCarId === NONE_VALUE ? null : newGarageCarId,
      });
      setOpenNew(false);
      toast({ title: "Project created", description: "Write your design brief to get started." });
      navigate(`/brief?project=${p.id}`);
    } catch (e: any) {
      toast({ title: "Couldn't create project", description: e.message, variant: "destructive" });
    }
  };

  const handleAttachGarageCar = async (projectId: string, value: string) => {
    const garage_car_id = value === NONE_VALUE ? null : value;
    try {
      await update.mutateAsync({ id: projectId, patch: { garage_car_id } as any });
      toast({
        title: garage_car_id ? "Garage car attached" : "Garage car detached",
        description: garage_car_id
          ? "Concept renders will use these reference views."
          : "No reference car will be used.",
      });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Studio</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1.5 text-muted-foreground">Each project starts with a design brief — the AI generates concepts from there.</p>
          </div>
          <Button variant="hero" size="lg" onClick={openNewDialog}>
            <Plus className="mr-2 h-4 w-4" /> New project
          </Button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass h-44 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">No projects yet</h2>
            <p className="mt-2 text-muted-foreground">Create your first body kit project — it takes a minute.</p>
            <Button variant="hero" size="lg" className="mt-6" onClick={openNewDialog}>
              <Plus className="mr-2 h-4 w-4" /> New project
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const attachedId = (p as any).garage_car_id ?? null;
              const attached = garageCars.find((g) => g.id === attachedId);
              return (
                <div key={p.id} className="glass group rounded-xl overflow-hidden flex flex-col transition-colors hover:border-primary/30">
                  <div className="relative h-36 bg-gradient-to-br from-surface-2 to-surface-0 grid-bg-fine flex items-center justify-center">
                    {attached?.ref_front34_url ? (
                      <img src={attached.ref_front34_url} alt="" loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <Hexagon className="h-10 w-10 text-primary/30" />
                    )}
                    <div className="absolute top-2 right-2">
                      <StatusChip tone={p.status === "exported" ? "success" : "preview"} size="sm">
                        {p.status}
                      </StatusChip>
                    </div>
                  </div>
                  <div className="flex-1 p-4">
                    <div className="text-sm font-semibold tracking-tight truncate">{p.name}</div>
                    <div className="text-mono text-[10px] text-muted-foreground truncate mt-0.5">
                      {p.car?.name ?? "No vehicle"}
                    </div>

                    <div className="mt-3">
                      <label className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground/80 flex items-center gap-1.5 mb-1">
                        <CarIcon className="h-3 w-3" /> Garage reference
                      </label>
                      <Select
                        value={attachedId ?? NONE_VALUE}
                        onValueChange={(v) => handleAttachGarageCar(p.id, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>None</SelectItem>
                          {garageCars.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {[g.year, g.make, g.model, g.trim].filter(Boolean).join(" ")}
                              {g.generation_status !== "ready" ? `  · ${g.generation_status}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="mt-3">
                      <label className="text-mono text-[9px] uppercase tracking-widest text-muted-foreground/80 flex items-center gap-1.5 mb-1">
                        <Boxes className="h-3 w-3" /> Donor template
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-between text-xs"
                        onClick={() => setTemplateCar((p.car as Car) ?? null)}
                      >
                        <span className="truncate">
                          {(p.car as any)?.template
                            ? `${(p.car as any).template.make} ${(p.car as any).template.model}`
                            : "Not set"}
                        </span>
                        <ArrowRight className="h-3 w-3 opacity-60" />
                      </Button>
                    </div>

                    <div className="mt-3 flex items-center gap-1 text-mono text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {p.updated_at ? formatDistanceToNow(new Date(p.updated_at), { addSuffix: true }) : "—"}
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-border p-3">
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmId(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="hero" size="sm" asChild>
                      <Link to={`/brief?project=${p.id}`}>
                        Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New project dialog */}
      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give it a name and pick a garage car to use as the OEM identity reference.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">Project name</Label>
              <Input
                id="proj-name"
                autoFocus
                placeholder="e.g. M3 GT-spec aero"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !create.isPending) handleCreate();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <CarIcon className="h-3.5 w-3.5" /> Garage car (optional)
              </Label>
              <Select value={newGarageCarId} onValueChange={setNewGarageCarId}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— None —</SelectItem>
                  {garageCars.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {[g.year, g.make, g.model, g.trim].filter(Boolean).join(" ")}
                      {g.generation_status !== "ready" ? `  · ${g.generation_status}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {garageCars.length === 0 && (
                <p className="text-mono text-[10px] text-muted-foreground">
                  No garage cars yet —{" "}
                  <Link to="/garage" className="text-primary hover:underline">
                    add one
                  </Link>{" "}
                  to lock concept identity.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>Cancel</Button>
            <Button variant="hero" onClick={handleCreate} disabled={create.isPending}>
              <Sparkles className="mr-2 h-4 w-4" /> Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              The design brief, concepts and fitted parts will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmId) return;
                try {
                  await del.mutateAsync(confirmId);
                  toast({ title: "Project deleted" });
                } catch (e: any) {
                  toast({ title: "Couldn't delete", description: e.message, variant: "destructive" });
                }
                setConfirmId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CarTemplatePickerDialog
        open={!!templateCar}
        onOpenChange={(o) => !o && setTemplateCar(null)}
        car={templateCar}
      />
    </AppLayout>
  );
}
