/**
 * Prototyper — Generate / Freeze / Place workflow.
 *
 * HARD RULE: only Generate mode calls a generative AI model. Freeze (SAM
 * segmentation) and Place (deterministic 2D composite) do not.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  useMyPrototypes, useCreatePrototype, useGarageCars, type GarageCar,
} from "@/lib/repo";
import {
  useFrozenParts, useFrozenPrototypeIds, useCreateFrozenPart, useDeleteFrozenPart,
  type FrozenPart,
} from "@/lib/prototyper/frozen-parts";
import {
  cloneInstance, makeInstance, mirrorInstance, snapOpposite,
  type PlacementInstance,
} from "@/lib/prototyper/transforms";
import {
  type MountZone, type PartCategory, type PartSide, type ViewAngle,
} from "@/lib/prototyper/mount-zones";
import { ModeSwitcher, type PrototyperMode } from "@/components/prototyper/ModeSwitcher";
import { PrototyperLeftPanel } from "@/components/prototyper/PrototyperLeftPanel";
import { PrototyperCanvas } from "@/components/prototyper/PrototyperCanvas";
import { PrototyperRightPanel } from "@/components/prototyper/PrototyperRightPanel";
import { Plus, Loader2 } from "lucide-react";

const VIEW_FIELD_MAP: Record<ViewAngle, keyof GarageCar> = {
  front: "ref_front_url",
  front34: "ref_front34_url",
  side: "ref_side_url",
  rear34: "ref_rear34_url",
  rear: "ref_rear_url",
};

interface SegmentResult {
  mask_url: string;
  silhouette_url: string;
  bbox: { x: number; y: number; w: number; h: number };
  anchor_points: Record<string, { x: number; y: number }>;
  draft_id: string;
}

export default function Prototyper() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useSearchParams();

  const [mode, setMode] = useState<PrototyperMode>("generate");
  const [view, setView] = useState<ViewAngle>("front34");
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prototype management
  const { data: allPrototypes = [] } = useMyPrototypes(user?.id);
  const { data: frozenPrototypeIds } = useFrozenPrototypeIds(user?.id);
  const visiblePrototypes = useMemo(() => {
    if (!frozenPrototypeIds) return [];
    return allPrototypes.filter((p) => frozenPrototypeIds.has(p.id));
  }, [allPrototypes, frozenPrototypeIds]);

  const protoIdFromUrl = search.get("prototype");
  const activePrototype = useMemo(
    () => allPrototypes.find((p) => p.id === protoIdFromUrl) ?? visiblePrototypes[0] ?? null,
    [allPrototypes, visiblePrototypes, protoIdFromUrl],
  );
  const prototypeId = activePrototype?.id;

  // Sync ?prototype= when the active one changes implicitly
  useEffect(() => {
    if (prototypeId && search.get("prototype") !== prototypeId) {
      const next = new URLSearchParams(search);
      next.set("prototype", prototypeId);
      setSearch(next, { replace: true });
    }
  }, [prototypeId, search, setSearch]);

  // Garage car for this prototype
  const { data: cars = [] } = useGarageCars(user?.id);
  const carsTyped = cars as GarageCar[];
  const [garageCarId, setGarageCarId] = useState<string | null>(null);
  useEffect(() => {
    setGarageCarId(activePrototype?.garage_car_id ?? null);
  }, [activePrototype?.id]);

  const garageCar = useMemo(
    () => carsTyped.find((c) => c.id === garageCarId) ?? null,
    [carsTyped, garageCarId],
  );
  const carImageByView = useMemo(() => {
    const m = {} as Record<ViewAngle, string | null>;
    (Object.keys(VIEW_FIELD_MAP) as ViewAngle[]).forEach((v) => {
      m[v] = garageCar ? ((garageCar as any)[VIEW_FIELD_MAP[v]] as string | null) : null;
    });
    return m;
  }, [garageCar]);

  // Set the active image to the car view by default; Generate replaces it.
  useEffect(() => {
    setActiveImage(carImageByView[view] ?? null);
  }, [carImageByView, view]);

  // Frozen parts for this prototype
  const { data: frozenParts = [] } = useFrozenParts(prototypeId);
  const partsById = useMemo(() => new Map(frozenParts.map((p) => [p.id, p])), [frozenParts]);
  const [selectedFrozenPartId, setSelectedFrozenPartId] = useState<string | null>(null);
  const selectedFrozenPart = selectedFrozenPartId ? partsById.get(selectedFrozenPartId) ?? null : null;

  const createFrozenPart = useCreateFrozenPart();
  const deleteFrozenPart = useDeleteFrozenPart();

  // ─── Generate state ─────────────────────────────────
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState("time_attack");
  const [targetZone, setTargetZone] = useState<MountZone>("door_quarter");
  const [aggression, setAggression] = useState(60);

  const handleGenerate = async () => {
    if (!prototypeId || !garageCarId) {
      toast({ title: "Pick a garage car first", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-prototyper-concept", {
        body: {
          prototype_id: prototypeId,
          garage_car_id: garageCarId,
          view_angle: view,
          prompt,
          style_preset: stylePreset,
          target_zone: targetZone,
          aggression,
        },
      });
      if (error) throw error;
      setActiveImage((data as any).image_url);
      toast({ title: "Concept ready", description: "Switch to Freeze Part to capture it." });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // ─── Freeze state ──────────────────────────────────
  const [proposed, setProposed] = useState<SegmentResult | null>(null);
  const [freezeDraft, setFreezeDraft] = useState({
    name: "Untitled part",
    category: "side_scoop" as PartCategory,
    mount_zone: "door_quarter" as MountZone,
    side: "left" as PartSide,
    symmetry_allowed: true,
    silhouette_locked: true,
  });

  const handleCanvasClick = async (norm: { x: number; y: number }) => {
    if (mode !== "freeze" || !activeImage || !prototypeId) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-frozen-part", {
        body: {
          source_image_url: activeImage,
          prototype_id: prototypeId,
          click_point: norm,
        },
      });
      if (error) throw error;
      setProposed(data as SegmentResult);
    } catch (err: any) {
      toast({ title: "Segmentation failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveFrozenPart = async () => {
    if (!proposed || !user || !prototypeId) return;
    setBusy(true);
    try {
      await createFrozenPart.mutateAsync({
        user_id: user.id,
        prototype_id: prototypeId,
        garage_car_id: garageCarId,
        name: freezeDraft.name,
        category: freezeDraft.category,
        mount_zone: freezeDraft.mount_zone,
        side: freezeDraft.side,
        symmetry_allowed: freezeDraft.symmetry_allowed,
        silhouette_locked: freezeDraft.silhouette_locked,
        source_image_url: activeImage,
        mask_url: proposed.mask_url,
        silhouette_url: proposed.silhouette_url,
        preview_url: proposed.silhouette_url,
        bbox: proposed.bbox,
        anchor_points: proposed.anchor_points,
        view_angle: view,
      });
      toast({ title: "Part frozen", description: "Available in the library on the left." });
      setProposed(null);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // ─── Place state ───────────────────────────────────
  const [placements, setPlacements] = useState<PlacementInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const selectedInstance = useMemo(
    () => placements.find((p) => p.instance_id === selectedInstanceId) ?? null,
    [placements, selectedInstanceId],
  );

  // Reset placements when prototype changes
  useEffect(() => { setPlacements([]); setSelectedInstanceId(null); }, [prototypeId]);

  const updateInstance = (id: string, patch: Partial<PlacementInstance["transform"]>) => {
    setPlacements((prev) => prev.map((p) =>
      p.instance_id === id ? { ...p, transform: { ...p.transform, ...patch } } : p,
    ));
  };

  const addInstanceFromSelected = () => {
    if (!selectedFrozenPart) return;
    const inst = makeInstance(
      selectedFrozenPart.id,
      (selectedFrozenPart.mount_zone as MountZone) ?? "front_bumper",
      (selectedFrozenPart.side as PartSide) ?? "center",
      view,
    );
    setPlacements((prev) => [...prev, inst]);
    setSelectedInstanceId(inst.instance_id);
  };

  const handleClone = () => {
    if (!selectedInstance) return;
    const next = cloneInstance(selectedInstance);
    setPlacements((prev) => [...prev, next]);
    setSelectedInstanceId(next.instance_id);
  };
  const handleMirror = () => {
    if (!selectedInstance) return;
    setPlacements((prev) => prev.map((p) =>
      p.instance_id === selectedInstance.instance_id ? mirrorInstance(p) : p,
    ));
  };
  const handleSnapOpposite = () => {
    if (!selectedInstance) return;
    const next = snapOpposite(selectedInstance, view);
    setPlacements((prev) => [...prev, next]);
    setSelectedInstanceId(next.instance_id);
  };
  const handleLockToggle = () => {
    if (!selectedInstance) return;
    setPlacements((prev) => prev.map((p) =>
      p.instance_id === selectedInstance.instance_id ? { ...p, locked: !p.locked } : p,
    ));
  };
  const handleDeleteInstance = () => {
    if (!selectedInstance) return;
    setPlacements((prev) => prev.filter((p) => p.instance_id !== selectedInstance.instance_id));
    setSelectedInstanceId(null);
  };

  const handleApproveOverlay = async () => {
    if (!prototypeId || !activeImage || placements.length === 0) {
      toast({ title: "Nothing to approve", description: "Add at least one placement." });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("place-frozen-part", {
        body: {
          target_image_url: activeImage,
          prototype_id: prototypeId,
          persist: true,
          placements: placements.map((p) => ({
            frozen_part_id: p.frozen_part_id,
            transform: p.transform,
          })),
        },
      });
      if (error) throw error;
      setActiveImage((data as any).composite_url);
      toast({ title: "Overlay approved", description: "Composite + manifest saved." });
    } catch (err: any) {
      toast({ title: "Approve failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // ─── New prototype dialog ──────────────────────────
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCarId, setNewCarId] = useState<string>("");
  const createProto = useCreatePrototype();

  const handleCreatePrototype = async () => {
    if (!user || !newTitle.trim() || !newCarId) {
      toast({ title: "Title and car are required", variant: "destructive" });
      return;
    }
    try {
      const proto = await createProto.mutateAsync({
        user_id: user.id,
        title: newTitle.trim(),
        car_context: null,
        notes: null,
        replicate_exact: false,
        garage_car_id: newCarId,
        source_image_urls: [],
        generation_mode: "text_design" as const,
        placement_hint: null,
      });
      const next = new URLSearchParams(search);
      next.set("prototype", proto.id);
      setSearch(next, { replace: true });
      setShowNew(false);
      setNewTitle("");
      setNewCarId("");
      // Eagerly satisfy the "hide-legacy" filter — though the new proto won't
      // appear in the list until at least one frozen part is saved. The page
      // still shows it because we read by URL too.
      toast({ title: "Prototype created", description: "Generate a concept to begin." });
    } catch (err: any) {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    }
  };

  // ─── Empty state ───────────────────────────────────
  if (!activePrototype) {
    return (
      <AppLayout>
        <PageHeader
          eyebrow="Workspace"
          title="Prototyper"
          description="Generate aero concepts, freeze them as reusable parts, and place them deterministically."
          actions={
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4 mr-2" /> New prototype
            </Button>
          }
        />
        <PausedBanner />
        <Card className="p-8 text-center">
          <div className="text-sm text-muted-foreground max-w-md mx-auto">
            No prototypes yet. Create one, pick a garage car view, generate a concept,
            then freeze the parts you like for precise reuse.
          </div>
        </Card>
        <NewPrototypeDialog
          open={showNew} onOpenChange={setShowNew}
          title={newTitle} onTitleChange={setNewTitle}
          carId={newCarId} onCarIdChange={setNewCarId}
          cars={carsTyped} onCreate={handleCreatePrototype}
          busy={createProto.isPending}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Workspace"
        title="Prototyper"
        description={activePrototype.title}
        actions={<ModeSwitcher mode={mode} onChange={setMode} placeEnabled={frozenParts.length > 0} />}
      />
      <PausedBanner />

      <div className="grid grid-cols-12 gap-4 h-[calc(100vh-220px)] min-h-[600px]">
        <div className="col-span-3 overflow-hidden">
          <PrototyperLeftPanel
            userId={user?.id}
            garageCarId={garageCarId}
            onGarageCarChange={setGarageCarId}
            view={view}
            onViewChange={setView}
            carImageByView={carImageByView}
            frozenParts={frozenParts}
            selectedFrozenPartId={selectedFrozenPartId}
            onSelectFrozenPart={setSelectedFrozenPartId}
            onDeleteFrozenPart={(id) => deleteFrozenPart.mutate(id)}
            onNewPrototype={() => setShowNew(true)}
            prototypeTitle={activePrototype.title}
          />
        </div>

        <div className="col-span-6 h-full">
          <PrototyperCanvas
            imageUrl={activeImage}
            mode={mode}
            loading={busy}
            proposedSilhouetteUrl={mode === "freeze" ? proposed?.silhouette_url ?? null : null}
            onCanvasClick={handleCanvasClick}
            placements={placements}
            partsById={partsById}
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={setSelectedInstanceId}
            onUpdateInstance={updateInstance}
          />
        </div>

        <div className="col-span-3 overflow-y-auto pr-1">
          <PrototyperRightPanel
            mode={mode}
            busy={busy}
            prompt={prompt}
            onPromptChange={setPrompt}
            stylePreset={stylePreset}
            onStylePresetChange={setStylePreset}
            targetZone={targetZone}
            onTargetZoneChange={setTargetZone}
            aggression={aggression}
            onAggressionChange={setAggression}
            onGenerate={handleGenerate}
            hasProposedMask={!!proposed}
            freezeDraft={freezeDraft}
            onFreezeDraftChange={(patch) => setFreezeDraft((d) => ({ ...d, ...patch }))}
            onResetMask={() => setProposed(null)}
            onSaveFrozenPart={handleSaveFrozenPart}
            selectedFrozenPart={selectedFrozenPart}
            selectedInstance={selectedInstance}
            onClone={handleClone}
            onMirror={handleMirror}
            onSnapOpposite={handleSnapOpposite}
            onLockToggle={handleLockToggle}
            onDeleteInstance={handleDeleteInstance}
            onUpdateInstanceTransform={(patch) => selectedInstance && updateInstance(selectedInstance.instance_id, patch)}
            onAddInstanceFromSelected={addInstanceFromSelected}
            onApproveOverlay={handleApproveOverlay}
          />
        </div>
      </div>

      <NewPrototypeDialog
        open={showNew} onOpenChange={setShowNew}
        title={newTitle} onTitleChange={setNewTitle}
        carId={newCarId} onCarIdChange={setNewCarId}
        cars={carsTyped} onCreate={handleCreatePrototype}
        busy={createProto.isPending}
      />
    </AppLayout>
  );
}

function NewPrototypeDialog(props: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  title: string;
  onTitleChange: (s: string) => void;
  carId: string;
  onCarIdChange: (s: string) => void;
  cars: GarageCar[];
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New prototype</DialogTitle>
          <DialogDescription>
            Pick a garage car. You'll generate concepts on its photos and freeze parts from them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              placeholder="e.g. Time-attack scoop study"
              value={props.title}
              onChange={(e) => props.onTitleChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Garage car</Label>
            <Select value={props.carId} onValueChange={props.onCarIdChange}>
              <SelectTrigger><SelectValue placeholder="Pick a car" /></SelectTrigger>
              <SelectContent>
                {props.cars.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Add a car in the Garage page first.
                  </div>
                )}
                {props.cars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.year ? `${c.year} ` : ""}{c.make} {c.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button onClick={props.onCreate} disabled={props.busy}>
            {props.busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
