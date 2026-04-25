/**
 * Showroom — fullscreen presentation/AR/VR view of a project's build.
 *
 * Route: /showroom?project=<id>
 *
 * Reuses BuildStudio's data hooks (project, paint finish, hero STL, material
 * tags, placed parts, body skin) so the showroom always shows exactly what
 * the user built. Adds:
 *
 *   • Environment HDRI picker (studio / sunset / city / forest …)
 *   • Camera bookmarks (save current view, jump back later)
 *   • Camera presets (front / 3/4 / side / rear / top)
 *   • Presentation Mode (auto-orbit + cinematic bars + UI hidden)
 *   • Screenshot (PNG) + turntable (WebM) export
 *   • VR + AR session buttons (WebXR via @react-three/xr)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ARButton, VRButton } from "@react-three/xr";
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  Camera,
  Film,
  Glasses,
  Image as ImageIcon,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCw,
  Smartphone,
  Sparkles,
  Trash2,
  Box,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useAuth } from "@/hooks/useAuth";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import {
  useCarTemplates,
  useHeroStlForProject,
  useMyLibrary,
  useSignedCarStlUrl,
} from "@/lib/repo";
import {
  usePlacedParts,
} from "@/lib/build-studio/placed-parts";
import { useLibraryItemsByIds } from "@/lib/build-studio/part-mesh";
import { useBodySkins, useSignedBodySkinUrl } from "@/lib/body-skins";
import { useShellAlignment } from "@/lib/build-studio/shell-alignments";
import { useCarMaterialMap } from "@/lib/build-studio/use-car-material-map";
import {
  DEFAULT_PAINT_FINISH,
  ENV_PRESET_OPTIONS,
  parsePaintFinish,
  type EnvPreset,
} from "@/lib/build-studio/paint-finish";

import {
  ShowroomScene,
  type ShowroomSceneHandle,
} from "@/components/showroom/ShowroomScene";
import { useCameraBookmarks, type CameraBookmark } from "@/lib/showroom/bookmarks";
import { captureCanvasPng, recordTurntable } from "@/lib/showroom/capture";
import { exportSceneToUSDZ, isIOSDevice } from "@/lib/showroom/usdz-export";
import { exportSceneToGLB } from "@/lib/showroom/glb-export";
import { captureHiRes } from "@/lib/showroom/hires-screenshot";
import { canvasToThumbBlob, saveProjectThumbnail } from "@/lib/showroom/thumbnails";
import {
  buildShareUrl,
  useProjectShareState,
  useToggleShare,
} from "@/lib/showroom/share";
import { ARHud } from "@/components/showroom/ARHud";
import { arStore } from "@/lib/showroom/ar-anchor";

type CameraPreset = "front" | "rear" | "left" | "right" | "top" | "three_quarter";

const PRESET_LABELS: Record<CameraPreset, string> = {
  front: "Front",
  rear: "Rear",
  left: "Left",
  right: "Right",
  top: "Top",
  three_quarter: "3/4",
};

export default function Showroom() {
  const { user } = useAuth();
  const { projectId, project } = useCurrentProject();
  const { data: templates = [] } = useCarTemplates();
  const { data: parts = [] } = usePlacedParts(projectId);
  const { data: heroStl } = useHeroStlForProject(projectId);
  const { data: heroStlUrl } = useSignedCarStlUrl(heroStl);
  const { tags: materialTags } = useCarMaterialMap(heroStl?.id);
  useMyLibrary(user?.id); // warm cache so PartMesh resolves textures

  const libraryItemIds = useMemo(
    () => parts.map((p) => p.library_item_id).filter(Boolean) as string[],
    [parts],
  );
  const { data: libraryItemsById = new Map() } = useLibraryItemsByIds(libraryItemIds);

  // Body skin overlay (read-only here)
  const { data: bodySkins = [] } = useBodySkins();
  const skinId =
    parts.find((p) => p.metadata && (p.metadata as any).body_skin_id)?.metadata
      ? ((parts.find((p) => (p.metadata as any).body_skin_id)!.metadata as any).body_skin_id as string)
      : null;
  const activeSkin = bodySkins.find((s) => s.id === skinId) ?? null;
  const skinAssetPath = activeSkin?.file_url_glb ?? activeSkin?.file_url_stl ?? null;
  const skinKind: "glb" | "stl" | null = activeSkin?.file_url_glb
    ? "glb"
    : activeSkin?.file_url_stl
      ? "stl"
      : null;
  const { data: bodySkinUrl } = useSignedBodySkinUrl(skinAssetPath);
  const { data: alignment } = useShellAlignment(projectId, skinId);
  const shellTransform = alignment
    ? {
        position: alignment.position as any,
        rotation: alignment.rotation as any,
        scale: alignment.scale as any,
      }
    : null;

  const template = useMemo(() => templates[0] ?? null, [templates]);

  // Paint finish (live from project)
  const paintFinish = useMemo(
    () => (project ? parsePaintFinish((project as any).paint_finish) : DEFAULT_PAINT_FINISH),
    [project],
  );
  const [envOverride, setEnvOverride] = useState<EnvPreset | null>(null);
  const envPreset: EnvPreset = envOverride ?? paintFinish.env_preset;

  // Showroom state
  const sceneRef = useRef<ShowroomSceneHandle | null>(null);
  const arOverlayRef = useRef<HTMLDivElement | null>(null);
  const [autoOrbitRpm, setAutoOrbitRpm] = useState(0);
  const [presentationMode, setPresentationMode] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [exportingUsdz, setExportingUsdz] = useState(false);

  const { bookmarks, add, remove } = useCameraBookmarks(projectId);
  const { data: shareState } = useProjectShareState(projectId);
  const toggleShare = useToggleShare(projectId);

  /** Approx car length (m) used by AR rig + HUD readout. */
  const carLengthMeters = useMemo(
    () => ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45,
    [template?.wheelbase_mm],
  );

  // ESC exits Presentation Mode + fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPresentationMode(false);
      } else if (e.key === " " && presentationMode) {
        e.preventDefault();
        setAutoOrbitRpm((rpm) => (rpm > 0 ? 0 : 4));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentationMode]);

  // Note: we toggle `arActive` from the AR button click handler below.
  // The XRSession's `environmentBlendMode` would be the proper signal, but
  // navigator.xr doesn't expose it before session start, so a click toggle is
  // the most reliable fallback.

  /* ─── handlers ─── */

  const applyPreset = (p: CameraPreset) => {
    if (!sceneRef.current) return;
    const wb = (template?.wheelbase_mm ?? 2575) / 1000;
    const length = wb + 1.45;
    const dist = length * 1.8;
    const target: [number, number, number] = [0, 0.6, 0];
    const positions: Record<CameraPreset, [number, number, number]> = {
      front: [dist, 1.2, 0],
      rear: [-dist, 1.2, 0],
      left: [0, 1.2, -dist],
      right: [0, 1.2, dist],
      top: [0.001, dist, 0],
      three_quarter: [dist * 0.75, dist * 0.55, dist * 0.75],
    };
    sceneRef.current.setCameraState({ position: positions[p], target, fov: 38 });
  };

  const handleSaveBookmark = () => {
    const state = sceneRef.current?.getCameraState();
    if (!state) return;
    const name = window.prompt("Name this view", `View ${bookmarks.length + 1}`);
    if (!name) return;
    add({ name, position: state.position, target: state.target, fov: state.fov });
    toast.success(`Saved "${name}"`);
  };

  const handleApplyBookmark = (b: CameraBookmark) => {
    sceneRef.current?.setCameraState({
      position: b.position,
      target: b.target,
      fov: b.fov ?? 38,
    });
  };

  const handleScreenshot = async () => {
    const canvas = sceneRef.current?.getCanvas();
    if (!canvas) {
      toast.error("Scene not ready");
      return;
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await captureCanvasPng(canvas, `showroom-${stamp}.png`);
      toast.success("Screenshot saved");
    } catch (e) {
      toast.error("Screenshot failed", { description: String(e) });
    }
  };

  const handleTurntable = async (format: "webm" | "mp4" = "webm") => {
    const canvas = sceneRef.current?.getCanvas();
    const scene = sceneRef.current;
    if (!canvas || !scene) return;
    setRecording(true);
    setRecordProgress(0);
    try {
      const startState = scene.getCameraState();
      let lastAngle = 0;
      await recordTurntable(canvas, {
        durationSec: 8,
        fps: 60,
        format,
        onProgress: setRecordProgress,
        onTick: (angle) => {
          const delta = angle - lastAngle;
          lastAngle = angle;
          scene.orbitBy(delta);
        },
        filename: `turntable-${Date.now()}`,
      });
      if (startState) scene.setCameraState(startState);
      toast.success(`Turntable saved (${format.toUpperCase()})`);
    } catch (e) {
      toast.error("Recording failed", { description: String(e) });
    } finally {
      setRecording(false);
      setRecordProgress(0);
    }
  };

  const handleHiResScreenshot = async (scale: 2 | 4) => {
    const renderer = sceneRef.current?.getRenderer();
    const scene = sceneRef.current?.getSceneRoot();
    const camera = sceneRef.current?.getCamera();
    if (!renderer || !scene || !camera) {
      toast.error("Scene not ready");
      return;
    }
    try {
      await captureHiRes(renderer, scene, camera, { scale });
      toast.success(`${scale}× screenshot saved`);
    } catch (e) {
      toast.error("Hi-res capture failed", { description: String(e) });
    }
  };

  const handleGLBExport = async () => {
    const sceneRoot = sceneRef.current?.getSceneRoot();
    if (!sceneRoot) return;
    try {
      await exportSceneToGLB(sceneRoot, `${projectName.replace(/\s+/g, "-")}.glb`);
      toast.success("GLB exported");
    } catch (e) {
      toast.error("GLB export failed", { description: String(e) });
    }
  };

  const handleSaveThumbnail = async () => {
    if (!user || !projectId) return;
    const canvas = sceneRef.current?.getCanvas();
    if (!canvas) return;
    try {
      const blob = await canvasToThumbBlob(canvas);
      await saveProjectThumbnail(user.id, projectId, blob);
      toast.success("Thumbnail updated");
    } catch (e) {
      toast.error("Thumbnail save failed", { description: String(e) });
    }
  };

  const handleToggleShare = async () => {
    try {
      const r = await toggleShare.mutateAsync(!shareState?.share_enabled);
      if (r.enabled && r.token) {
        await navigator.clipboard?.writeText(buildShareUrl(r.token));
        toast.success("Share link copied", { description: buildShareUrl(r.token) });
      } else {
        toast.success("Sharing disabled");
      }
    } catch (e) {
      toast.error("Share toggle failed", { description: String(e) });
    }
  };

  const togglePresentation = () => {
    setPresentationMode((v) => !v);
    if (!presentationMode) setAutoOrbitRpm(4);
    else setAutoOrbitRpm(0);
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  /** Export the live three.js scene as USDZ + (on iOS) launch Quick Look. */
  const handleQuickLook = async () => {
    const scene = sceneRef.current?.getSceneRoot();
    if (!scene) {
      toast.error("Scene not ready");
      return;
    }
    setExportingUsdz(true);
    try {
      await exportSceneToUSDZ(scene, `${projectName.replace(/\s+/g, "-")}.usdz`);
      toast.success(isIOSDevice() ? "Launching AR Quick Look…" : "USDZ downloaded");
    } catch (e) {
      console.error(e);
      toast.error("USDZ export failed", { description: String(e) });
    } finally {
      setExportingUsdz(false);
    }
  };

  /** End the current XR session (used by the in-AR exit button). */
  const exitAR = async () => {
    const session = (navigator as any).xr?.session ?? null;
    try {
      // r3f-xr stores the active session on the global navigator? No — fall back
      // to walking through document.exitFullscreen / requesting end via store.
      const xrSession = (window as any).__activeXrSession as XRSession | undefined;
      if (xrSession) await xrSession.end();
      else if (session) await session.end();
    } catch {
      /* swallow */
    }
    arStore.endSession();
    setArActive(false);
  };

  const projectName = (project as any)?.name ?? "Showroom";
  const isReady = !!heroStlUrl;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Scene fills the entire screen */}
      <div className="absolute inset-0">
        <ShowroomScene
          ref={sceneRef}
          template={template}
          heroStlUrl={heroStlUrl}
          bodySkinUrl={bodySkinUrl}
          bodySkinKind={skinKind}
          shellTransform={shellTransform}
          parts={parts}
          libraryItemsById={libraryItemsById}
          paintFinish={paintFinish}
          materialTags={materialTags ?? null}
          envPreset={envPreset}
          autoOrbitRpm={autoOrbitRpm}
          arActive={arActive}
        />
      </div>

      {/* Cinematic bars (Presentation Mode) */}
      {presentationMode && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[12vh] bg-black" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[12vh] bg-black" />
        </>
      )}

      {/* Top bar — hidden in presentation mode */}
      {!presentationMode && (
        <header className="absolute inset-x-0 top-0 z-40 flex items-center justify-between gap-4 bg-gradient-to-b from-background/95 via-background/80 to-transparent px-6 py-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="h-9 w-9">
              <Link to={projectId ? `/build-studio?project=${projectId}` : "/dashboard"}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <div className="text-xs text-muted-foreground">Showroom</div>
              <div className="text-sm font-semibold">{projectName}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <VRButton
              className="!relative !inline-flex !h-9 !items-center !gap-2 !rounded-md !border !border-border !bg-surface-1 !px-3 !text-sm !font-medium !text-foreground hover:!bg-surface-2"
            />
            <ARButton
              className="!relative !inline-flex !h-9 !items-center !gap-2 !rounded-md !border !border-border !bg-surface-1 !px-3 !text-sm !font-medium !text-foreground hover:!bg-surface-2"
              sessionInit={{
                requiredFeatures: ["hit-test"],
                optionalFeatures: arOverlayRef.current
                  ? ["dom-overlay", "anchors", "local-floor"]
                  : ["anchors", "local-floor"],
                domOverlay: arOverlayRef.current ? { root: arOverlayRef.current } : undefined,
              }}
              onClick={() => setArActive((v) => !v)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  onClick={handleQuickLook}
                  disabled={!isReady || exportingUsdz}
                >
                  {exportingUsdz ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Box className="h-4 w-4" />
                  )}
                  {isIOSDevice() ? "AR Quick Look" : "USDZ"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isIOSDevice()
                  ? "Open in iOS AR Quick Look"
                  : "Download .usdz for iPhone / iPad"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={toggleFullscreen}>
                  <Maximize className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fullscreen</TooltipContent>
            </Tooltip>
            <Button variant="default" size="sm" onClick={togglePresentation} className="h-9 gap-2">
              <Sparkles className="h-4 w-4" />
              Present
            </Button>
          </div>
        </header>
      )}

      {/* AR HUD — composited over the camera feed via WebXR dom-overlay. */}
      <div ref={arOverlayRef} className="pointer-events-none absolute inset-0 z-50">
        {arActive && <ARHud carLengthMeters={carLengthMeters} onExit={exitAR} />}
      </div>


      {/* Left rail — bookmarks + camera presets */}
      {!presentationMode && (
        <aside className="absolute left-4 top-1/2 z-40 w-64 -translate-y-1/2">
          <div className="rounded-xl border border-border bg-surface-1/95 p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Camera presets
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(PRESET_LABELS) as CameraPreset[]).map((p) => (
                <Button
                  key={p}
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => applyPreset(p)}
                >
                  {PRESET_LABELS[p]}
                </Button>
              ))}
            </div>

            <Separator className="my-3" />

            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Bookmarks
              </h3>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleSaveBookmark}
                title="Save current view"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Frame a great angle, then click <Bookmark className="inline h-3 w-3" /> to save it.
              </p>
            ) : (
              <ScrollArea className="max-h-48">
                <ul className="space-y-1">
                  {bookmarks.map((b) => (
                    <li
                      key={b.id}
                      className="group flex items-center justify-between gap-1 rounded-md px-2 py-1 text-xs hover:bg-surface-2"
                    >
                      <button
                        className="flex-1 truncate text-left"
                        onClick={() => handleApplyBookmark(b)}
                      >
                        {b.name}
                      </button>
                      <button
                        className="opacity-0 transition group-hover:opacity-100"
                        onClick={() => remove(b.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        </aside>
      )}

      {/* Right rail — environment + capture */}
      {!presentationMode && (
        <aside className="absolute right-4 top-1/2 z-40 w-64 -translate-y-1/2">
          <div className="rounded-xl border border-border bg-surface-1/95 p-3 shadow-xl">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Environment
            </h3>
            <Select
              value={envPreset}
              onValueChange={(v) => setEnvOverride(v as EnvPreset)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENV_PRESET_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Separator className="my-3" />

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Auto-orbit
            </h3>
            <div className="flex items-center gap-2">
              <Slider
                value={[autoOrbitRpm]}
                min={0}
                max={12}
                step={0.5}
                onValueChange={([v]) => setAutoOrbitRpm(v)}
                className="flex-1"
              />
              <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
                {autoOrbitRpm.toFixed(1)} rpm
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 w-full gap-2 text-xs"
              onClick={() => sceneRef.current?.resetView()}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Reset view
            </Button>

            <Separator className="my-3" />

            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Capture
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 text-xs"
                onClick={handleScreenshot}
                disabled={!isReady || recording}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                PNG
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 text-xs"
                onClick={() => handleTurntable("webm")}
                disabled={!isReady || recording}
              >
                {recording ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Film className="h-3.5 w-3.5" />
                )}
                {recording ? `${Math.round(recordProgress * 100)}%` : "Turntable"}
              </Button>
            </div>
            {recording && (
              <div className="mt-2 h-1 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${recordProgress * 100}%` }}
                />
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Presentation-mode minimal HUD */}
      {presentationMode && (
        <div className="pointer-events-auto absolute bottom-[14vh] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface-1/95 px-3 py-1.5 shadow-xl">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setAutoOrbitRpm((r) => (r > 0 ? 0 : 4))}
          >
            {autoOrbitRpm > 0 ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Slider
            value={[autoOrbitRpm]}
            min={0}
            max={12}
            step={0.5}
            onValueChange={([v]) => setAutoOrbitRpm(v)}
            className="w-40"
          />
          <Separator orientation="vertical" className="h-6" />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={togglePresentation}>
            <Minimize className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Empty / loading state */}
      {!isReady && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-lg border border-border bg-surface-1/95 px-4 py-3 text-sm text-muted-foreground shadow-lg">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading your build…
          </div>
        </div>
      )}

      {/* WebXR support hint */}
      {!presentationMode && typeof navigator !== "undefined" && !(navigator as any).xr && (
        <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface-1/95 px-3 py-1 text-[11px] text-muted-foreground shadow-lg">
          <Glasses className="h-3.5 w-3.5" />
          WebXR not detected — open in a VR/AR-capable browser
          <Smartphone className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}
