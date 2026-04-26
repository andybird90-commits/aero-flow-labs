/**
 * 3D Build Studio — Phase 3.
 *
 * Three-pane layout:
 *  • Left rail   — Part Library (drop a library item into the scene)
 *  • Center      — R3F viewport with car placeholder + placed parts
 *  • Right rail  — Properties of the selected part
 *  • Bottom strip — placed-parts timeline
 *
 * Persists every transform / flag change to placed_parts. Loads the user's
 * current project (or the project from ?project=).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Move3d,
  RotateCcw,
  Maximize2,
  Grid3x3,
  Save,
  Camera,
  FolderOpen,
  Boxes,
  Magnet,
  Layers,
  Undo2,
  Redo2,
  Sparkles,
  Ruler,
  Scissors,
  MousePointer2,
  Tag,
  Focus,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { frameReset } from "@/components/build-studio/ViewportTools";
import type { MeasureLine } from "@/components/build-studio/ViewportTools";
import type { ViewportTool } from "@/components/build-studio/BuildStudioViewport";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import { useCarTemplates, useMyLibrary, useHeroStlForProject, useSignedCarStlUrl, useSignedCarGlbUrl, useUpdateProject, type LibraryItem } from "@/lib/repo";
import {
  usePlacedParts,
  useAddPlacedPart,
  useUpdatePlacedPart,
  useDeletePlacedPart,
  useDuplicatePlacedPart,
  type PlacedPart,
  type Vec3,
} from "@/lib/build-studio/placed-parts";
import { useSnapZones } from "@/lib/build-studio/snap-zones";
import { useLibraryItemsByIds } from "@/lib/build-studio/part-mesh";
import { useBodySkins, useSignedBodySkinUrl, type BodySkin } from "@/lib/body-skins";
import { useShellAlignment, useUpsertShellAlignment, type LockedHardpointPair } from "@/lib/build-studio/shell-alignments";
import { useCarHardpoints } from "@/lib/build-studio/hardpoints";
import { ShellFitPanel } from "@/components/build-studio/ShellFitPanel";
import { BakeBodyKitButton } from "@/components/build-studio/BakeBodyKitButton";
import type * as THREE from "three";
import { DEFAULT_PAINT_FINISH, parsePaintFinish, type PaintFinish } from "@/lib/build-studio/paint-finish";

import { BuildStudioViewport, type CameraPreset, type TransformMode, type ShellTransform } from "@/components/build-studio/BuildStudioViewport";
import { PartLibraryRail } from "@/components/build-studio/PartLibraryRail";
import { PropertiesPanel } from "@/components/build-studio/PropertiesPanel";
import { PlacedPartsStrip } from "@/components/build-studio/PlacedPartsStrip";
import { PaintStudioPopover } from "@/components/build-studio/PaintStudioPopover";
import { useHistory, useHistoryShortcuts } from "@/lib/build-studio/history";
import { useCarMaterialMap } from "@/lib/build-studio/use-car-material-map";
import {
  useRenderQuality,
  QUALITY_LABEL,
  QUALITY_DESCRIPTION,
  type RenderQuality,
} from "@/lib/build-studio/render-quality";
import { AnnotationToolbar } from "@/components/build-studio/annotate/AnnotationToolbar";
import { ScreenAnnotationOverlay } from "@/components/build-studio/annotate/ScreenAnnotationOverlay";
import { AnnotationLayersPanel } from "@/components/build-studio/annotate/AnnotationLayersPanel";
import { BuildStudioStatusBar } from "@/components/build-studio/BuildStudioStatusBar";
import { useHydrateAnnotations } from "@/lib/build-studio/annotate/hooks";
import type { CameraPose } from "@/lib/build-studio/annotate/store";

export default function BuildStudio() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { projectId, project, isLoading: projectLoading, isEmpty } = useCurrentProject();
  const { data: templates = [] } = useCarTemplates();
  const { data: library, isLoading: libLoading } = useMyLibrary(user?.id);
  const { data: parts = [] } = usePlacedParts(projectId);
  const { data: heroStl } = useHeroStlForProject(projectId);
  const { data: heroStlUrl } = useSignedCarStlUrl(heroStl);
  const { tags: materialTags } = useCarMaterialMap(heroStl?.id);

  const addPart = useAddPlacedPart();
  const updatePart = useUpdatePlacedPart();
  const deletePart = useDeletePlacedPart();
  const duplicatePart = useDuplicatePlacedPart();

  // ─── Undo / redo history ───
  const history = useHistory();
  // Reset history whenever the active project changes — operations are project-scoped.
  useEffect(() => {
    history.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<TransformMode>("translate");
  const [showGrid, setShowGrid] = useState(false);
  const [showSnapZones, setShowSnapZones] = useState(true);
  const [preset, setPreset] = useState<CameraPreset>("free");
  const { quality, setQuality } = useRenderQuality();
  const [presentationMode, setPresentationMode] = useState(false);

  // Tier 2 interaction tools
  const [tool, setTool] = useState<ViewportTool>("select");
  const [clipAxis, setClipAxis] = useState<"x" | "y" | "z">("x");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [measureLines, setMeasureLines] = useState<MeasureLine[]>([]);
  const translateSnapM = snapEnabled ? 0.05 : 0;   // 5 cm
  const rotateSnapDeg = snapEnabled ? 15 : 0;

  // Annotation: live camera pose ref (populated inside R3F), triangle count.
  const livePoseRef = useRef<CameraPose | null>(null);
  const [triangleCount, setTriangleCount] = useState<number | null>(null);
  useHydrateAnnotations(projectId);

  // Paint Studio finish — local for live preview, debounced-saved to project.
  const updateProject = useUpdateProject();
  const [paintFinish, setPaintFinish] = useState<PaintFinish>(DEFAULT_PAINT_FINISH);
  // Hydrate from project when it loads / changes.
  useEffect(() => {
    if (project) setPaintFinish(parsePaintFinish((project as any).paint_finish));
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Debounced persist on change.
  useEffect(() => {
    if (!projectId || !project) return;
    const t = setTimeout(() => {
      updateProject.mutate({
        id: projectId,
        patch: { paint_finish: paintFinish } as any,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [paintFinish, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shell Fit Mode
  const [shellSkinId, setShellSkinId] = useState<string | null>(null);
  const [shellEditMode, setShellEditMode] = useState(false);
  const { data: bodySkins = [] } = useBodySkins();
  const activeSkin: BodySkin | null = useMemo(
    () => bodySkins.find((s) => s.id === shellSkinId) ?? null,
    [bodySkins, shellSkinId],
  );
  const skinAssetPath = activeSkin?.file_url_glb ?? activeSkin?.file_url_stl ?? null;
  const skinKind: "glb" | "stl" | null = activeSkin?.file_url_glb
    ? "glb"
    : activeSkin?.file_url_stl
      ? "stl"
      : null;
  const { data: bodySkinUrl } = useSignedBodySkinUrl(skinAssetPath);
  const { data: alignment } = useShellAlignment(projectId, shellSkinId);
  const upsertAlignment = useUpsertShellAlignment();
  const [shellRoot, setShellRoot] = useState<THREE.Object3D | null>(null);
  const carTemplateIdForHp = (project?.car as any)?.template_id ?? null;
  const { data: carHardpoints = [] } = useCarHardpoints(carTemplateIdForHp);
  const lockedPairs = ((alignment?.locked_hardpoints as unknown) as LockedHardpointPair[] | undefined) ?? [];
  const stretchEnabled = !(alignment?.scale_to_wheelbase ?? true);

  const shellTransform: ShellTransform | null = useMemo(() => {
    if (!alignment) return null;
    return {
      position: alignment.position as any,
      rotation: alignment.rotation as any,
      scale: alignment.scale as any,
    };
  }, [alignment]);

  // Resolve real meshes for placed parts
  const libraryItemIds = useMemo(
    () => parts.map((p) => p.library_item_id).filter(Boolean) as string[],
    [parts],
  );
  const { data: libraryItemsById = new Map() } = useLibraryItemsByIds(libraryItemIds);

  // Snap zones for the project's car template (if assigned)
  const carTemplateId = (project?.car as any)?.template_id ?? null;
  const { data: snapZones = [] } = useSnapZones(carTemplateId);


  const selected = useMemo(
    () => parts.find((p) => p.id === selectedId) ?? null,
    [parts, selectedId],
  );

  const template = useMemo(() => {
    if (!project?.car_id) return null;
    // car_templates aren't directly joined here; pick the first as a sane default
    return templates[0] ?? null;
  }, [project, templates]);

  /* ─── handlers ─── */
  const handleAdd = (item: LibraryItem | null) => {
    if (!user || !projectId) {
      toast.error("Open a project first");
      return;
    }
    addPart.mutate(
      {
        user_id: user.id,
        project_id: projectId,
        library_item_id: item?.id ?? null,
        part_name: item?.title ?? "Blank part",
        position: { x: 0, y: 0.5, z: 0 },
        metadata: item ? { source_kind: item.kind, asset_url: item.asset_url } : {},
      },
      {
        onSuccess: (p) => {
          setSelectedId(p.id);
          toast.success(`Added ${p.part_name}`);
          // History: undo = delete; redo = re-create with same payload.
          const partSnapshot = p;
          history.push({
            label: `Add ${p.part_name ?? "part"}`,
            undo: () =>
              new Promise<void>((resolve) =>
                deletePart.mutate(
                  { id: partSnapshot.id, project_id: projectId },
                  { onSettled: () => resolve() },
                ),
              ),
            redo: () =>
              new Promise<void>((resolve) =>
                addPart.mutate(
                  {
                    user_id: partSnapshot.user_id,
                    project_id: partSnapshot.project_id,
                    library_item_id: partSnapshot.library_item_id,
                    part_name: partSnapshot.part_name ?? "Part",
                    position: partSnapshot.position,
                    metadata: partSnapshot.metadata ?? {},
                  },
                  { onSettled: () => resolve() },
                ),
              ),
          });
        },
        onError: (e: any) => toast.error(e.message ?? "Add failed"),
      },
    );
  };

  const handlePatch = (
    patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale" | "locked" | "hidden" | "mirrored" | "part_name">>,
  ) => {
    if (!selected || !projectId) return;
    const before = {
      position: selected.position,
      rotation: selected.rotation,
      scale: selected.scale,
      locked: selected.locked,
      hidden: selected.hidden,
      mirrored: selected.mirrored,
      part_name: selected.part_name,
    };
    const beforePatch: typeof patch = {};
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      (beforePatch as any)[k] = (before as any)[k];
    }
    const targetId = selected.id;
    updatePart.mutate({ id: selected.id, project_id: projectId, patch });
    history.push({
      label: "Edit part",
      undo: () =>
        new Promise<void>((resolve) =>
          updatePart.mutate(
            { id: targetId, project_id: projectId, patch: beforePatch },
            { onSettled: () => resolve() },
          ),
        ),
      redo: () =>
        new Promise<void>((resolve) =>
          updatePart.mutate(
            { id: targetId, project_id: projectId, patch },
            { onSettled: () => resolve() },
          ),
        ),
    });
  };

  const handleCommit = (id: string, patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale">>) => {
    if (!projectId) return;
    const part = parts.find((p) => p.id === id);
    const beforePatch: typeof patch = {};
    if (part) {
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
        (beforePatch as any)[k] = (part as any)[k];
      }
    }
    updatePart.mutate({ id, project_id: projectId, patch });
    if (part) {
      history.push({
        label: "Transform part",
        undo: () =>
          new Promise<void>((resolve) =>
            updatePart.mutate(
              { id, project_id: projectId, patch: beforePatch },
              { onSettled: () => resolve() },
            ),
          ),
        redo: () =>
          new Promise<void>((resolve) =>
            updatePart.mutate(
              { id, project_id: projectId, patch },
              { onSettled: () => resolve() },
            ),
          ),
      });
    }
  };

  const handleDelete = () => {
    if (!selected || !projectId) return;
    const partSnapshot = selected;
    deletePart.mutate(
      { id: partSnapshot.id, project_id: projectId },
      {
        onSuccess: () => {
          setSelectedId(null);
          toast.success("Part deleted");
          history.push({
            label: `Delete ${partSnapshot.part_name ?? "part"}`,
            undo: () =>
              new Promise<void>((resolve) =>
                addPart.mutate(
                  {
                    user_id: partSnapshot.user_id,
                    project_id: partSnapshot.project_id,
                    library_item_id: partSnapshot.library_item_id,
                    part_name: partSnapshot.part_name ?? "Part",
                    position: partSnapshot.position,
                    metadata: partSnapshot.metadata ?? {},
                  },
                  { onSettled: () => resolve() },
                ),
              ),
            redo: () =>
              new Promise<void>((resolve) =>
                deletePart.mutate(
                  { id: partSnapshot.id, project_id: projectId },
                  { onSettled: () => resolve() },
                ),
              ),
          });
        },
      },
    );
  };

  /** Delete by id (used by bottom strip quick-delete). */
  const handleDeleteById = (id: string) => {
    if (!projectId) return;
    const partSnapshot = parts.find((p) => p.id === id);
    deletePart.mutate(
      { id, project_id: projectId },
      {
        onSuccess: () => {
          if (selectedId === id) setSelectedId(null);
          toast.success("Part deleted");
          if (partSnapshot) {
            history.push({
              label: `Delete ${partSnapshot.part_name ?? "part"}`,
              undo: () =>
                new Promise<void>((resolve) =>
                  addPart.mutate(
                    {
                      user_id: partSnapshot.user_id,
                      project_id: partSnapshot.project_id,
                      library_item_id: partSnapshot.library_item_id,
                      part_name: partSnapshot.part_name ?? "Part",
                      position: partSnapshot.position,
                      metadata: partSnapshot.metadata ?? {},
                    },
                    { onSettled: () => resolve() },
                  ),
                ),
              redo: () =>
                new Promise<void>((resolve) =>
                  deletePart.mutate(
                    { id: partSnapshot.id, project_id: projectId },
                    { onSettled: () => resolve() },
                  ),
                ),
            });
          }
        },
        onError: (e: any) => toast.error(e.message ?? "Delete failed"),
      },
    );
  };

  /** Keyboard shortcut: Delete / Backspace removes the selected part. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack while typing in inputs / textareas / contenteditable.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      if (e.key === "Escape" && presentationMode) {
        e.preventDefault();
        setPresentationMode(false);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !selected.locked) {
        e.preventDefault();
        handleDelete();
        return;
      }
      // Tier 2 tool shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "v" || e.key === "V") setTool("select");
      else if (e.key === "m" || e.key === "M") setTool("measure");
      else if (e.key === "c" || e.key === "C") setTool("clip");
      else if (e.key === "f" || e.key === "F") frameReset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, presentationMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDuplicate = () => {
    if (!selected) return;
    duplicatePart.mutate(selected, {
      onSuccess: (p) => {
        setSelectedId(p.id);
        toast.success("Duplicated");
        if (projectId) {
          history.push({
            label: "Duplicate part",
            undo: () =>
              new Promise<void>((resolve) =>
                deletePart.mutate(
                  { id: p.id, project_id: projectId },
                  { onSettled: () => resolve() },
                ),
              ),
            redo: () =>
              new Promise<void>((resolve) =>
                addPart.mutate(
                  {
                    user_id: p.user_id,
                    project_id: p.project_id,
                    library_item_id: p.library_item_id,
                    part_name: p.part_name ?? "Part",
                    position: p.position,
                    metadata: p.metadata ?? {},
                  },
                  { onSettled: () => resolve() },
                ),
              ),
          });
        }
      },
    });
  };

  const handleMirror = () => {
    if (!selected) return;
    handlePatch({
      position: { ...selected.position, z: -selected.position.z },
      mirrored: !selected.mirrored,
      scale: { ...selected.scale, z: -selected.scale.z },
    });
  };

  /** Snap selected part to a zone (or unsnap when zoneId is null). */
  const handleSnapToZone = (zoneId: string | null) => {
    if (!selected || !projectId) return;
    if (!zoneId) {
      updatePart.mutate({ id: selected.id, project_id: projectId, patch: { snap_zone_id: null } as any });
      return;
    }
    const zone = snapZones.find((z) => z.id === zoneId);
    if (!zone) return;
    updatePart.mutate({
      id: selected.id,
      project_id: projectId,
      patch: { position: { ...zone.position }, snap_zone_id: zone.id } as any,
    });
    toast.success(`Snapped to ${zone.label ?? zone.zone_type}`);
  };

  /** Duplicate selected part and snap the copy to the mirror zone. */
  const handleMirrorToZone = (zone: { id: string; position: Vec3 }) => {
    if (!selected || !user || !projectId) return;
    addPart.mutate(
      {
        user_id: user.id,
        project_id: projectId,
        library_item_id: selected.library_item_id,
        part_name: `${selected.part_name ?? "Part"} (mirror)`,
        position: { ...zone.position },
        metadata: { ...(selected.metadata ?? {}), mirrored_from: selected.id },
      },
      {
        onSuccess: (p) => {
          // Apply rotation/scale + mirror flag + zone link to the new part.
          updatePart.mutate({
            id: p.id,
            project_id: projectId,
            patch: {
              rotation: { ...selected.rotation },
              scale: { ...selected.scale, z: -selected.scale.z },
              mirrored: true,
              snap_zone_id: zone.id,
            } as any,
          });
          setSelectedId(p.id);
          toast.success("Mirrored to opposite zone");
        },
        onError: (e: any) => toast.error(e.message ?? "Mirror failed"),
      },
    );
  };

  const handleSaveDesign = () => {
    toast.success(`Design saved (${parts.length} parts)`);
  };

  /** Selected part's resolved library item — used by Live Fit to load the asset. */
  const selectedLibraryItem = selected?.library_item_id
    ? libraryItemsById.get(selected.library_item_id) ?? null
    : null;

  /** Invalidate placed-parts + library caches when a Live Fit bake completes
   *  so the viewport reloads the new mesh. */
  const handleLiveFitBaked = () => {
    if (!projectId) return;
    qc.invalidateQueries({ queryKey: ["placed_parts", projectId] });
    qc.invalidateQueries({ queryKey: ["library_items_by_ids"] });
    qc.invalidateQueries({ queryKey: ["my_library", user?.id] });
    toast.success("Live-fitted part baked into the build");
  };

  /** Wrappers that surface a subtle toast on success. */
  const doUndo = async () => {
    const entry = await history.undo();
    if (entry) toast.message(`Undid: ${entry.label}`);
  };
  const doRedo = async () => {
    const entry = await history.redo();
    if (entry) toast.message(`Redid: ${entry.label}`);
  };
  useHistoryShortcuts({ undo: doUndo, redo: doRedo, enabled: !!projectId });

  const handleShellCommit = (t: ShellTransform) => {
    if (!user || !projectId || !shellSkinId) return;
    upsertAlignment.mutate(
      {
        user_id: user.id,
        project_id: projectId,
        body_skin_id: shellSkinId,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
      },
      {
        onError: (e: any) => toast.error(e.message ?? "Could not save alignment"),
      },
    );
  };

  const handleStretchChange = (enabled: boolean) => {
    if (!user || !projectId || !shellSkinId) return;
    upsertAlignment.mutate({
      user_id: user.id,
      project_id: projectId,
      body_skin_id: shellSkinId,
      scale_to_wheelbase: !enabled,
    });
  };

  /* ─── render ─── */
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="studio flex h-screen w-full overflow-hidden studio-canvas">
        <AppSidebar />
        <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <header className="studio-bar flex h-14 shrink-0 items-center gap-3 px-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="h-5 w-px bg-border" />
            <Topbar />
          </header>

          {!projectId ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="glass max-w-md rounded-xl p-8 text-center">
                <Boxes className="mx-auto mb-3 h-10 w-10 text-primary" />
                <h2 className="text-lg font-semibold">Open a project to start building</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {projectLoading
                    ? "Loading…"
                    : isEmpty
                      ? "Create your first project to use the Build Studio."
                      : "Pick a project from your list."}
                </p>
                <Button asChild className="mt-4" variant="outline">
                  <Link to="/projects">
                    <FolderOpen className="mr-1.5 h-4 w-4" /> Go to projects
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Toolbar — hidden in Presentation Mode for a clean hero render. */}
              {!presentationMode && (
              <div className="studio-bar flex shrink-0 items-center gap-2.5 px-4 overflow-x-auto" style={{ height: "var(--studio-bar-h)" }}>
                <div className="flex flex-col leading-tight">
                  <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    Aero Design
                  </div>
                  <div className="text-sm font-semibold truncate max-w-[220px]" style={{ color: "hsl(var(--studio-accent-glow))" }}>
                    {project?.name}
                  </div>
                </div>
                <Separator orientation="vertical" className="h-7" />

                {/* Annotation tools — markup / surface / select */}
                <AnnotationToolbar />
                <Separator orientation="vertical" className="h-7" />

                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => v && setMode(v as TransformMode)}
                  className="gap-0"
                >
                  <ToggleGroupItem value="translate" size="sm" className="h-9 px-3" aria-label="Move">
                    <Move3d className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="rotate" size="sm" className="h-9 px-3" aria-label="Rotate">
                    <RotateCcw className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="scale" size="sm" className="h-9 px-3" aria-label="Scale">
                    <Maximize2 className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Separator orientation="vertical" className="h-7" />

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 px-2.5"
                    onClick={doUndo}
                    disabled={!history.canUndo}
                    aria-label="Undo (⌘Z)"
                    title="Undo (⌘Z / Ctrl+Z)"
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 px-2.5"
                    onClick={doRedo}
                    disabled={!history.canRedo}
                    aria-label="Redo (⇧⌘Z)"
                    title="Redo (⇧⌘Z / Ctrl+Y)"
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </div>

                <Separator orientation="vertical" className="h-7" />

                <Toggle
                  pressed={showGrid}
                  onPressedChange={setShowGrid}
                  size="sm"
                  className="h-9 px-3"
                  aria-label="Toggle grid"
                >
                  <Grid3x3 className="h-4 w-4" />
                </Toggle>

                <Toggle
                  pressed={showSnapZones}
                  onPressedChange={setShowSnapZones}
                  size="sm"
                  className="h-9 px-3"
                  aria-label="Toggle snap zones"
                  disabled={!carTemplateId}
                >
                  <Magnet className="h-4 w-4" />
                </Toggle>

                <Select value={preset} onValueChange={(v) => setPreset(v as CameraPreset)}>
                  <SelectTrigger className="h-9 w-[160px] text-xs">
                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free orbit</SelectItem>
                    <SelectItem value="three_quarter">3/4</SelectItem>
                    <SelectItem value="front">Front</SelectItem>
                    <SelectItem value="rear">Rear</SelectItem>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="top">Top</SelectItem>
                  </SelectContent>
                </Select>

                <Separator orientation="vertical" className="h-7" />

                <Select value={quality} onValueChange={(v) => setQuality(v as RenderQuality)}>
                  <SelectTrigger
                    className="h-9 w-[140px] text-xs"
                    title={QUALITY_DESCRIPTION[quality]}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate">{QUALITY_LABEL[quality]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {(["draft", "studio", "cinematic"] as RenderQuality[]).map((q) => (
                      <SelectItem key={q} value={q} className="py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium">{QUALITY_LABEL[q]}</span>
                          <span className="text-[10px] leading-tight text-muted-foreground">
                            {QUALITY_DESCRIPTION[q]}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Separator orientation="vertical" className="h-7" />

                {/* ─── Tier 2 interaction tools ─── */}
                <ToggleGroup
                  type="single"
                  value={tool}
                  onValueChange={(v) => v && setTool(v as ViewportTool)}
                  className="gap-0"
                >
                  <ToggleGroupItem value="select" size="sm" className="h-9 px-3" aria-label="Select / move parts" title="Select (V)">
                    <MousePointer2 className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="measure" size="sm" className="h-9 px-3" aria-label="Measure distance" title="Measure (M) — click two points">
                    <Ruler className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="clip" size="sm" className="h-9 px-3" aria-label="Section / clipping plane" title="Section plane (C)">
                    <Scissors className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>

                {tool === "clip" && (
                  <Select value={clipAxis} onValueChange={(v) => setClipAxis(v as "x" | "y" | "z")}>
                    <SelectTrigger className="h-9 w-[90px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="x">Slice X</SelectItem>
                      <SelectItem value="y">Slice Y</SelectItem>
                      <SelectItem value="z">Slice Z</SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {tool === "measure" && measureLines.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMeasureLines([])}
                    className="h-9 px-2.5 text-xs"
                    title="Clear measurements"
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    {measureLines.length}
                  </Button>
                )}

                <Toggle
                  pressed={snapEnabled}
                  onPressedChange={setSnapEnabled}
                  size="sm"
                  className="h-9 px-3"
                  aria-label="Snap to grid (5 cm / 15°)"
                  title="Snap: 5 cm translate · 15° rotate"
                >
                  <Magnet className="h-4 w-4" />
                </Toggle>

                <Toggle
                  pressed={showLabels}
                  onPressedChange={setShowLabels}
                  size="sm"
                  className="h-9 px-3"
                  aria-label="Toggle part labels"
                  title="Floating part labels"
                >
                  <Tag className="h-4 w-4" />
                </Toggle>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => frameReset()}
                  className="h-9 px-2.5"
                  aria-label="Frame all (F)"
                  title="Frame all — double-click a part to frame it"
                >
                  <Focus className="h-4 w-4" />
                </Button>

                <Separator orientation="vertical" className="h-7" />

                <PaintStudioPopover
                  finish={paintFinish}
                  onChange={setPaintFinish}
                  disabled={!projectId}
                />

                <Separator orientation="vertical" className="h-7" />

                {/* Shell Fit Mode */}
                <Select
                  value={shellSkinId ?? "__none__"}
                  onValueChange={(v) => {
                    setShellSkinId(v === "__none__" ? null : v);
                    if (v === "__none__") setShellEditMode(false);
                  }}
                >
                  <SelectTrigger className="h-9 w-[200px] text-xs">
                    <Layers className="mr-1.5 h-3.5 w-3.5 text-primary" />
                    <SelectValue placeholder="Shell Fit: none" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No shell overlay</SelectItem>
                    {bodySkins.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Toggle
                  pressed={shellEditMode}
                  onPressedChange={setShellEditMode}
                  size="sm"
                  className="h-9 px-3 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
                  aria-label="Edit shell alignment"
                  disabled={!shellSkinId}
                >
                  <Layers className="h-4 w-4" />
                </Toggle>

                <ShellFitPanel
                  shellRoot={shellRoot}
                  carHardpoints={carHardpoints}
                  lockedPairs={lockedPairs}
                  currentTransform={shellTransform}
                  stretchEnabled={stretchEnabled}
                  disabled={!shellSkinId}
                  onApplyTransform={handleShellCommit}
                  onStretchChange={handleStretchChange}
                />

                <BakeBodyKitButton
                  projectId={projectId}
                  userId={user?.id ?? null}
                  bodySkinId={shellSkinId}
                  donorCarTemplateId={carTemplateIdForHp}
                  shellAlignmentId={alignment?.id ?? null}
                  shellTransform={shellTransform}
                  stretchEnabled={stretchEnabled}
                />


                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={presentationMode ? "default" : "outline"}
                    onClick={() => setPresentationMode((v) => !v)}
                    className="h-9 px-3 text-xs"
                    title={presentationMode ? "Exit presentation (Esc)" : "Presentation mode — clean hero render"}
                  >
                    {presentationMode ? (
                      <><EyeOff className="mr-1.5 h-3.5 w-3.5" /> Exit</>
                    ) : (
                      <><Eye className="mr-1.5 h-3.5 w-3.5" /> Present</>
                    )}
                  </Button>
                  <Button asChild size="sm" variant="outline" className="h-9 px-3 text-xs" title="Open in Showroom (AR/VR & presentation)">
                    <Link to={`/showroom?project=${projectId}`}>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Showroom
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleSaveDesign} className="h-9 px-3 text-xs">
                    <Save className="mr-1.5 h-3.5 w-3.5" /> Save
                  </Button>
                </div>
              </div>
              )}

              {/* 3-column body — rails collapse in Presentation Mode. */}
              <div
                className="grid flex-1 min-h-0"
                style={{
                  gridTemplateColumns: presentationMode
                    ? "1fr"
                    : "var(--studio-rail-w) 1fr var(--studio-rail-w)",
                }}
              >
                {!presentationMode && (
                  <aside className="studio-rail min-h-0 overflow-hidden border-r">
                    <PartLibraryRail
                      items={library}
                      isLoading={libLoading}
                      onAdd={handleAdd}
                      onAddBlank={() => handleAdd(null)}
                    />
                  </aside>
                )}

                <div className="relative min-h-0">
                  <BuildStudioViewport
                    template={template}
                    heroStlUrl={heroStlUrl}
                    bodySkinUrl={bodySkinUrl ?? null}
                    bodySkinKind={skinKind}
                    shellTransform={shellTransform}
                    shellEditMode={shellEditMode}
                    onShellCommit={handleShellCommit}
                    onShellMeshReady={setShellRoot}
                    parts={parts}
                    libraryItemsById={libraryItemsById}
                    snapZones={snapZones}
                    showSnapZones={presentationMode ? false : showSnapZones}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    transformMode={mode}
                    showGrid={presentationMode ? false : showGrid}
                    preset={preset}
                    quality={presentationMode ? "cinematic" : quality}
                    paintFinish={paintFinish}
                    materialTags={materialTags}
                    tool={tool}
                    clipAxis={clipAxis}
                    translateSnapM={translateSnapM}
                    rotateSnapDeg={rotateSnapDeg}
                    showLabels={presentationMode ? false : showLabels}
                    measureLines={measureLines}
                    onMeasureLinesChange={setMeasureLines}
                    livePoseRef={livePoseRef}
                    onTriangleCount={setTriangleCount}
                    onCommit={handleCommit}
                  />
                  {/* Soft vignette so the canvas reads as a "studio plate" */}
                  <div className="studio-vignette absolute inset-0 z-10 pointer-events-none" />
                  {/* Screen-space drawing layer (only catches events when active) */}
                  <ScreenAnnotationOverlay livePoseRef={livePoseRef} />

                  {/* Floating exit pill — only in Presentation Mode. */}
                  {presentationMode && (
                    <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
                      <div className="rounded-full bg-background/40 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-foreground/70 backdrop-blur-md">
                        Presentation
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPresentationMode(false)}
                        className="h-8 rounded-full border-white/20 bg-background/40 px-3 text-xs backdrop-blur-md hover:bg-background/60"
                        title="Exit presentation (Esc)"
                      >
                        <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Exit
                      </Button>
                    </div>
                  )}
                </div>

                {!presentationMode && (
                  <aside className="studio-rail flex min-h-0 flex-col overflow-hidden border-l">
                    <div className="border-b border-border/60 p-3">
                      <AnnotationLayersPanel
                        projectId={projectId}
                        userId={user?.id ?? null}
                      />
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <PropertiesPanel
                        part={selected}
                        onPatch={handlePatch}
                        onDuplicate={handleDuplicate}
                        onDelete={handleDelete}
                        onMirror={handleMirror}
                        snapZones={snapZones}
                        onSnapToZone={handleSnapToZone}
                        onMirrorToZone={handleMirrorToZone}
                        selectedLibraryItem={selectedLibraryItem}
                        baseMeshUrl={heroStlUrl ?? null}
                        userId={user?.id ?? null}
                        onLiveFitBaked={handleLiveFitBaked}
                      />
                    </div>
                  </aside>
                )}
              </div>

              {/* Status bar — hidden in Presentation Mode. */}
              {!presentationMode && (
                <BuildStudioStatusBar
                  selected={selected}
                  partsCount={parts.length}
                  triangleCount={triangleCount}
                  snapEnabled={snapEnabled}
                />
              )}

              {/* Bottom strip — hidden in Presentation Mode. */}
              {!presentationMode && (
                <div className="h-16 shrink-0 border-t border-border bg-card/30">
                  <PlacedPartsStrip
                    parts={parts}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onDelete={handleDeleteById}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}
