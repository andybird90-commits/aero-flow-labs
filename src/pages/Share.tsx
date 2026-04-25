/**
 * Public Showroom viewer — `/share/:token`.
 *
 * This route does NOT require authentication. The Supabase RLS policies
 * filter to projects with `share_enabled = true`, so the anon key can read
 * exactly the rows we want and nothing else.
 *
 * The page also exposes the two big customer-facing AR launchers:
 *   • iOS  → AR Quick Look (USDZ exported on the fly from the live scene)
 *   • Android → Scene Viewer (via a public GLB intent URL)
 *
 * Everything here is intentionally minimal — no editing, no auth-gated
 * hooks. Just the build, the AR buttons, and a "made with APEX" footer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Glasses, Loader2, Smartphone, Maximize, Sparkles, Pause, Play, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import {
  useCarTemplates,
  useSignedCarStlUrl,
  useMyLibrary,
} from "@/lib/repo";
import { useLibraryItemsByIds } from "@/lib/build-studio/part-mesh";
import { useSignedBodySkinUrl } from "@/lib/body-skins";
import {
  DEFAULT_PAINT_FINISH,
  parsePaintFinish,
} from "@/lib/build-studio/paint-finish";
import { ShowroomScene, type ShowroomSceneHandle } from "@/components/showroom/ShowroomScene";
import { exportSceneToUSDZ, isIOSDevice } from "@/lib/showroom/usdz-export";
import { exportSceneToGLBBlob } from "@/lib/showroom/glb-export";
import { downloadBlob } from "@/lib/showroom/capture";

interface SharedProject {
  id: string;
  name: string;
  paint_finish: unknown;
  user_id: string;
  car_id: string | null;
  thumbnail_url: string | null;
}

interface SharedPart {
  id: string;
  library_item_id: string | null;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  hidden: boolean;
  metadata: Record<string, unknown>;
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const sceneRef = useRef<ShowroomSceneHandle | null>(null);

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<SharedProject | null>(null);
  const [parts, setParts] = useState<SharedPart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoOrbitRpm, setAutoOrbitRpm] = useState(2);
  const [arPending, setArPending] = useState(false);

  /* ─── Fetch shared data with the anon key (RLS handles access) ─── */
  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    setLoading(true);
    setError(null);
    (async () => {
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id, name, paint_finish, user_id, car_id, thumbnail_url")
        .eq("share_token", token)
        .eq("share_enabled", true)
        .maybeSingle();

      if (projErr || !proj) {
        if (!cancelled) {
          setError("This link isn't active or has been revoked.");
          setLoading(false);
        }
        return;
      }

      const { data: pp } = await supabase
        .from("placed_parts")
        .select("id, library_item_id, position, rotation, scale, hidden, metadata")
        .eq("project_id", proj.id);

      if (!cancelled) {
        setProject(proj as SharedProject);
        setParts((pp ?? []) as SharedPart[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // We can still load car STLs / templates because they're public to authenticated +
  // the anon key has read access via the existing "Car templates are public" policy.
  const { data: templates = [] } = useCarTemplates();
  const template = useMemo(() => templates[0] ?? null, [templates]);

  // Hero STL: query directly via car_id.
  const [heroStl, setHeroStl] = useState<{ id: string; stl_path: string; repaired_stl_path: string | null } | null>(null);
  useEffect(() => {
    if (!project?.car_id) return;
    let cancelled = false;
    (async () => {
      // car_stls are world-readable for authenticated, but anon can read since the
      // policy is `true`. If it's not, the share will still work without the car.
      const { data } = await supabase
        .from("car_stls")
        .select("id, stl_path, repaired_stl_path, car_template_id")
        .limit(1)
        .maybeSingle();
      if (!cancelled) setHeroStl(data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.car_id]);

  const { data: heroStlUrl } = useSignedCarStlUrl(heroStl as never);

  // Library items needed by parts.
  useMyLibrary(undefined); // no-op for anon, but keeps hook order stable
  const libraryItemIds = useMemo(
    () => parts.map((p) => p.library_item_id).filter(Boolean) as string[],
    [parts],
  );
  const { data: libraryItemsById = new Map() } = useLibraryItemsByIds(libraryItemIds);

  // Body skin from metadata (optional).
  const skinId =
    parts.find((p) => p.metadata && (p.metadata as { body_skin_id?: string }).body_skin_id)?.metadata
      ? ((parts.find((p) => (p.metadata as { body_skin_id?: string }).body_skin_id)!
          .metadata as { body_skin_id?: string }).body_skin_id as string)
      : null;
  const [skinAsset, setSkinAsset] = useState<{ path: string | null; kind: "stl" | "glb" | null }>({
    path: null,
    kind: null,
  });
  useEffect(() => {
    if (!skinId) {
      setSkinAsset({ path: null, kind: null });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("body_skins")
        .select("file_url_glb, file_url_stl")
        .eq("id", skinId)
        .maybeSingle();
      if (cancelled) return;
      const path = data?.file_url_glb ?? data?.file_url_stl ?? null;
      const kind: "stl" | "glb" | null = data?.file_url_glb ? "glb" : data?.file_url_stl ? "stl" : null;
      setSkinAsset({ path, kind });
    })();
    return () => {
      cancelled = true;
    };
  }, [skinId]);
  const { data: bodySkinUrl } = useSignedBodySkinUrl(skinAsset.path);

  const paintFinish = useMemo(
    () => (project ? parsePaintFinish(project.paint_finish) : DEFAULT_PAINT_FINISH),
    [project],
  );

  /* ─── Customer-facing AR launchers ─── */

  /** iOS → exports USDZ from the live scene + opens AR Quick Look. */
  const handleIOSAR = async () => {
    const scene = sceneRef.current?.getSceneRoot();
    if (!scene) return;
    setArPending(true);
    try {
      await exportSceneToUSDZ(scene, `${project?.name ?? "build"}.usdz`);
    } catch (e) {
      toast.error("AR failed", { description: String(e) });
    } finally {
      setArPending(false);
    }
  };

  /** Android → exports GLB, downloads it, and triggers Scene Viewer intent.
   *
   * Scene Viewer requires a *publicly fetchable* URL. We can't easily upload
   * anonymous GLBs to storage, so instead we open an Object URL (works in
   * Chrome on Android via `intent://` for blob URLs is unreliable, so we
   * just download the file and tell the user to tap it). For the best UX
   * we'd upload to an "ar-cache" bucket — out of scope for now.
   */
  const handleAndroidAR = async () => {
    const scene = sceneRef.current?.getSceneRoot();
    if (!scene) return;
    setArPending(true);
    try {
      const blob = await exportSceneToGLBBlob(scene);
      downloadBlob(blob, `${project?.name ?? "build"}.glb`);
      toast.success("GLB downloaded — open in Scene Viewer to view in AR");
    } catch (e) {
      toast.error("AR export failed", { description: String(e) });
    } finally {
      setArPending(false);
    }
  };

  const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  const isIOS = isIOSDevice();

  /* ─── Render ─── */

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading shared build…
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
        <div className="rounded-xl border border-border bg-surface-1 p-6 text-center shadow-xl">
          <h1 className="mb-2 text-lg font-semibold">Link not available</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        <ShowroomScene
          ref={sceneRef}
          template={template}
          heroStlUrl={heroStlUrl}
          bodySkinUrl={bodySkinUrl}
          bodySkinKind={skinAsset.kind}
          shellTransform={null}
          parts={parts.map((p) => ({
            ...p,
            user_id: project.user_id,
            project_id: project.id,
            part_name: null,
            snap_zone_id: null,
            mirrored: false,
            locked: true,
            created_at: "",
            updated_at: "",
          })) as never}
          libraryItemsById={libraryItemsById}
          paintFinish={paintFinish}
          materialTags={null}
          envPreset={paintFinish.env_preset}
          autoOrbitRpm={autoOrbitRpm}
          arActive={false}
        />
      </div>

      {/* Top bar — minimalist */}
      <header className="absolute inset-x-0 top-0 z-40 flex items-center justify-between bg-gradient-to-b from-background/90 to-transparent px-5 py-4">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Shared build</div>
          <h1 className="text-base font-semibold">{project.name}</h1>
        </div>
        <a
          href="/"
          className="text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          Made with <span className="font-semibold text-foreground">APEX</span>
        </a>
      </header>

      {/* Bottom action bar — AR launcher + auto-orbit */}
      <footer className="absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-background/95 via-background/70 to-transparent px-5 pb-6 pt-12">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-surface-1/95 p-4 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">View this kit on your real car</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isIOS && (
                <Button onClick={handleIOSAR} disabled={arPending} className="gap-2">
                  {arPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Glasses className="h-4 w-4" />}
                  View in AR (iPhone)
                </Button>
              )}
              {isAndroid && (
                <Button onClick={handleAndroidAR} disabled={arPending} className="gap-2">
                  {arPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                  View in AR (Android)
                </Button>
              )}
              {!isIOS && !isAndroid && (
                <>
                  <Button onClick={handleIOSAR} variant="outline" className="gap-2">
                    <Box className="h-4 w-4" />
                    Download .usdz
                  </Button>
                  <Button onClick={handleAndroidAR} variant="outline" className="gap-2">
                    <Box className="h-4 w-4" />
                    Download .glb
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setAutoOrbitRpm((r) => (r > 0 ? 0 : 2))}
            >
              {autoOrbitRpm > 0 ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Slider
              value={[autoOrbitRpm]}
              min={0}
              max={8}
              step={0.5}
              onValueChange={([v]) => setAutoOrbitRpm(v)}
              className="flex-1"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => sceneRef.current?.resetView()}
              title="Reset view"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() =>
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : document.documentElement.requestFullscreen()
              }
              title="Fullscreen"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
