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
import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import { useCarTemplates, useMyLibrary, useHeroStlForProject, useSignedCarStlUrl, type LibraryItem } from "@/lib/repo";
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
import { useShellAlignment, useUpsertShellAlignment } from "@/lib/build-studio/shell-alignments";

import { BuildStudioViewport, type CameraPreset, type TransformMode, type ShellTransform } from "@/components/build-studio/BuildStudioViewport";
import { PartLibraryRail } from "@/components/build-studio/PartLibraryRail";
import { PropertiesPanel } from "@/components/build-studio/PropertiesPanel";
import { PlacedPartsStrip } from "@/components/build-studio/PlacedPartsStrip";

export default function BuildStudio() {
  const { user } = useAuth();
  const { projectId, project, isLoading: projectLoading, isEmpty } = useCurrentProject();
  const { data: templates = [] } = useCarTemplates();
  const { data: library, isLoading: libLoading } = useMyLibrary(user?.id);
  const { data: parts = [] } = usePlacedParts(projectId);
  const { data: heroStl } = useHeroStlForProject(projectId);
  const { data: heroStlUrl } = useSignedCarStlUrl(heroStl);

  const addPart = useAddPlacedPart();
  const updatePart = useUpdatePlacedPart();
  const deletePart = useDeletePlacedPart();
  const duplicatePart = useDuplicatePlacedPart();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<TransformMode>("translate");
  const [showGrid, setShowGrid] = useState(true);
  const [showSnapZones, setShowSnapZones] = useState(true);
  const [preset, setPreset] = useState<CameraPreset>("free");

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
        },
        onError: (e: any) => toast.error(e.message ?? "Add failed"),
      },
    );
  };

  const handlePatch = (
    patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale" | "locked" | "hidden" | "mirrored" | "part_name">>,
  ) => {
    if (!selected || !projectId) return;
    updatePart.mutate({ id: selected.id, project_id: projectId, patch });
  };

  const handleCommit = (id: string, patch: Partial<Pick<PlacedPart, "position" | "rotation" | "scale">>) => {
    if (!projectId) return;
    updatePart.mutate({ id, project_id: projectId, patch });
  };

  const handleDelete = () => {
    if (!selected || !projectId) return;
    deletePart.mutate(
      { id: selected.id, project_id: projectId },
      {
        onSuccess: () => {
          setSelectedId(null);
          toast.success("Part deleted");
        },
      },
    );
  };

  const handleDuplicate = () => {
    if (!selected) return;
    duplicatePart.mutate(selected, {
      onSuccess: (p) => {
        setSelectedId(p.id);
        toast.success("Duplicated");
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

  /* ─── render ─── */
  return (
    <SidebarProvider defaultOpen={false}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
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
            <div className="flex flex-1 flex-col">
              {/* Toolbar */}
              <div className="flex h-12 items-center gap-2 border-b border-border bg-card/30 px-3">
                <div className="text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Build
                </div>
                <div className="text-sm font-medium truncate max-w-[200px]">{project?.name}</div>
                <Separator orientation="vertical" className="h-5" />

                <ToggleGroup
                  type="single"
                  value={mode}
                  onValueChange={(v) => v && setMode(v as TransformMode)}
                  className="gap-0"
                >
                  <ToggleGroupItem value="translate" size="sm" className="h-7 px-2">
                    <Move3d className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="rotate" size="sm" className="h-7 px-2">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="scale" size="sm" className="h-7 px-2">
                    <Maximize2 className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Separator orientation="vertical" className="h-5" />

                <Toggle
                  pressed={showGrid}
                  onPressedChange={setShowGrid}
                  size="sm"
                  className="h-7 px-2"
                  aria-label="Toggle grid"
                >
                  <Grid3x3 className="h-3.5 w-3.5" />
                </Toggle>

                <Toggle
                  pressed={showSnapZones}
                  onPressedChange={setShowSnapZones}
                  size="sm"
                  className="h-7 px-2"
                  aria-label="Toggle snap zones"
                  disabled={!carTemplateId}
                >
                  <Magnet className="h-3.5 w-3.5" />
                </Toggle>

                <Select value={preset} onValueChange={(v) => setPreset(v as CameraPreset)}>
                  <SelectTrigger className="h-7 w-[140px] text-xs">
                    <Camera className="mr-1 h-3 w-3" />
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

                <Separator orientation="vertical" className="h-5" />

                {/* Shell Fit Mode */}
                <Select
                  value={shellSkinId ?? "__none__"}
                  onValueChange={(v) => {
                    setShellSkinId(v === "__none__" ? null : v);
                    if (v === "__none__") setShellEditMode(false);
                  }}
                >
                  <SelectTrigger className="h-7 w-[180px] text-xs">
                    <Layers className="mr-1 h-3 w-3 text-primary" />
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
                  className="h-7 px-2 data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
                  aria-label="Edit shell alignment"
                  disabled={!shellSkinId}
                >
                  <Layers className="h-3.5 w-3.5" />
                </Toggle>

                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleSaveDesign} className="h-7 text-xs">
                    <Save className="mr-1 h-3 w-3" /> Save
                  </Button>
                </div>
              </div>

              {/* 3-column body */}
              <div className="grid flex-1 min-h-0 grid-cols-[260px_1fr_280px]">
                <aside className="border-r border-border bg-card/20">
                  <PartLibraryRail
                    items={library}
                    isLoading={libLoading}
                    onAdd={handleAdd}
                    onAddBlank={() => handleAdd(null)}
                  />
                </aside>

                <div className="relative min-h-0">
                  <BuildStudioViewport
                    template={template}
                    heroStlUrl={heroStlUrl}
                    bodySkinUrl={bodySkinUrl ?? null}
                    bodySkinKind={skinKind}
                    shellTransform={shellTransform}
                    shellEditMode={shellEditMode}
                    onShellCommit={handleShellCommit}
                    parts={parts}
                    libraryItemsById={libraryItemsById}
                    snapZones={snapZones}
                    showSnapZones={showSnapZones}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    transformMode={mode}
                    showGrid={showGrid}
                    preset={preset}
                    onCommit={handleCommit}
                  />
                </div>

                <aside className="border-l border-border bg-card/20">
                  <PropertiesPanel
                    part={selected}
                    onPatch={handlePatch}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDelete}
                    onMirror={handleMirror}
                    snapZones={snapZones}
                    onSnapToZone={handleSnapToZone}
                    onMirrorToZone={handleMirrorToZone}
                  />
                </aside>
              </div>

              {/* Bottom strip */}
              <div className="h-16 shrink-0 border-t border-border bg-card/30">
                <PlacedPartsStrip
                  parts={parts}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}
