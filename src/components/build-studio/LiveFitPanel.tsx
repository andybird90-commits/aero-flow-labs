/**
 * LiveFitPanel — in-app, real-time body conform + CSG trim.
 *
 * Mounted inside PropertiesPanel when:
 *   • The selected placed_part has an asset URL (library_item_id resolvable),
 *   • A base car STL/GLB is available for the project,
 *   • Either the part is body-conforming OR the user manually opens the
 *     fit section.
 *
 * Flow:
 *   1. On open: load base + part geometries (cached), upload base to worker.
 *   2. On every offset change: debounced snap+trim via worker → preview updates.
 *   3. Bake: convert preview geometry to STL, upload, create library_item,
 *      repoint the placed_part. Done in <1s, fully local except the upload.
 *   4. Send for print-ready STL: pre-fills SendToGeometryWorker with the
 *      already-fitted geometry so the worker only needs to solidify + clean.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Loader2, Magnet, Scissors, Wand2, Send, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useLiveFitWorker, type FitGeometry } from "@/lib/build-studio/fit/use-live-fit-worker";
import {
  loadGeometryNormalised,
  geometryToStlBuffer,
} from "@/lib/build-studio/fit/load-geometry";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import type { LibraryItem } from "@/lib/repo";
import { detectMeshKind } from "@/lib/build-studio/part-mesh";

/**
 * Same scale heuristic used by HeroStlCar in BuildStudioViewport so part +
 * base end up sharing one world frame (longest axis = wheelbase + 1.45 m).
 */
const BASE_TARGET_SIZE_DEFAULT = 4.02; // 2.575 m wheelbase + 1.45
const PART_TARGET_SIZE = 0.5;

interface Props {
  part: PlacedPart;
  libraryItem: LibraryItem | null;
  baseMeshUrl: string | null;
  baseTargetSizeM?: number;
  /** Called after a successful Bake — parent re-resolves placed-part assets. */
  onBaked: (newAssetUrl: string, newLibraryItemId: string) => void;
  /** Open the existing worker dialog with the snapped geometry pre-filled. */
  onSendForPrint?: (snappedStlBlob: Blob) => void;
  userId: string | null;
}

export function LiveFitPanel({
  part,
  libraryItem,
  baseMeshUrl,
  baseTargetSizeM = BASE_TARGET_SIZE_DEFAULT,
  onBaked,
  onSendForPrint,
  userId,
}: Props) {
  const { toast } = useToast();
  const { setBase, run } = useLiveFitWorker();

  // Loaded geometries (kept across slider drags).
  const [partGeo, setPartGeo] = useState<THREE.BufferGeometry | null>(null);
  const [baseReady, setBaseReady] = useState(false);
  const [previewGeo, setPreviewGeo] = useState<THREE.BufferGeometry | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [busy, setBusy] = useState<"snap" | "trim" | "bake" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [offsetMm, setOffsetMm] = useState(2);
  const [trim, setTrim] = useState(true);
  const [baking, setBaking] = useState(false);

  const baseId = baseMeshUrl ?? "__none__";
  const partUrl = libraryItem?.asset_url ?? null;
  const partKind = detectMeshKind(libraryItem ?? null) ?? "stl";
  const baseKind: "stl" | "glb" = baseMeshUrl
    ? baseMeshUrl.toLowerCase().includes(".glb")
      ? "glb"
      : "stl"
    : "stl";

  // 1) Load both geometries when the inputs change.
  useEffect(() => {
    if (!baseMeshUrl || !partUrl) return;
    let cancelled = false;
    setLoadingAssets(true);
    setError(null);
    setPartGeo(null);
    setPreviewGeo(null);
    setBaseReady(false);

    (async () => {
      try {
        const [base, p] = await Promise.all([
          loadGeometryNormalised(baseMeshUrl, baseKind, baseTargetSizeM, true),
          loadGeometryNormalised(partUrl, partKind, PART_TARGET_SIZE, false),
        ]);
        if (cancelled) return;

        // Upload base to worker.
        const basePos = (base.geometry.attributes.position.array as Float32Array).slice();
        const baseIdx = base.geometry.index
          ? new Uint32Array(base.geometry.index.array as ArrayLike<number>)
          : null;
        await setBase(baseId, { positions: basePos, indices: baseIdx ?? undefined });
        if (cancelled) return;

        setPartGeo(p.geometry);
        setBaseReady(true);
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message ?? e));
          toast({
            title: "Live Fit unavailable",
            description: "Couldn't load the base or part mesh — falling back to the worker flow.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoadingAssets(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseMeshUrl, partUrl, baseKind, partKind, baseTargetSizeM]);

  // 2) Run snap (fast) on every offset change. Debounce trim (slower).
  const snapTimer = useRef<number | null>(null);
  const trimTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!partGeo || !baseReady) return;
    if (snapTimer.current) window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => void runSnap(), 60);
    return () => {
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetMm, partGeo, baseReady]);

  useEffect(() => {
    if (!partGeo || !baseReady) return;
    if (!trim) return; // snap covers the no-trim case
    if (trimTimer.current) window.clearTimeout(trimTimer.current);
    trimTimer.current = window.setTimeout(() => void runFit(), 220);
    return () => {
      if (trimTimer.current) window.clearTimeout(trimTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsetMm, trim, partGeo, baseReady]);

  const partAsFitGeometry = (g: THREE.BufferGeometry): FitGeometry => ({
    positions: (g.attributes.position.array as Float32Array).slice(),
    normals: g.attributes.normal ? (g.attributes.normal.array as Float32Array).slice() : null,
    indices: g.index ? new Uint32Array(g.index.array as ArrayLike<number>) : null,
  });

  async function runSnap() {
    if (!partGeo || !baseReady) return;
    try {
      setBusy("snap");
      const result = await run("snap", baseId, partAsFitGeometry(partGeo), {
        offsetM: offsetMm / 1000,
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      // Only show snap result when trim is off — otherwise wait for trim.
      if (!trim) setPreviewGeo(g);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy((b) => (b === "snap" ? null : b));
    }
  }

  async function runFit() {
    if (!partGeo || !baseReady || !trim) return;
    try {
      setBusy("trim");
      const result = await run("snap-and-trim", baseId, partAsFitGeometry(partGeo), {
        offsetM: offsetMm / 1000,
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(result.normals, 3));
      if (result.indices) g.setIndex(new THREE.BufferAttribute(result.indices, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      setPreviewGeo(g);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy((b) => (b === "trim" ? null : b));
    }
  }

  async function handleBake() {
    if (!previewGeo || !userId) return;
    try {
      setBaking(true);
      const stl = geometryToStlBuffer(previewGeo);
      const blob = new Blob([stl], { type: "model/stl" });
      const filename = `live-fit-${part.id}-${Date.now()}.stl`;
      const path = `${userId}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from("geometries")
        .upload(path, blob, { contentType: "model/stl", upsert: true });
      if (upErr) throw upErr;
      // 7-day signed URL — Build Studio re-resolves library_items via React Query
      // when the placed_part repoints, and the URL is refreshed on each session.
      const { data: signed, error: signErr } = await supabase.storage
        .from("geometries")
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Failed to sign URL");
      const url = signed.signedUrl;

      const insertItem = {
        user_id: userId,
        kind: "concept_part_mesh" as const,
        title: `${part.part_name ?? "Part"} (Live Fit)`,
        asset_url: url,
        asset_mime: "model/stl",
        visibility: "private" as const,
        metadata: {
          source: "live-fit",
          source_part_id: part.id,
          offset_mm: offsetMm,
          trimmed: trim,
        },
      };
      const { data: row, error: insErr } = await (supabase as any)
        .from("library_items")
        .insert(insertItem)
        .select("id, asset_url")
        .single();
      if (insErr) throw insErr;

      // Repoint the placed part to the new asset.
      const { error: updErr } = await (supabase as any)
        .from("placed_parts")
        .update({ library_item_id: row.id })
        .eq("id", part.id);
      if (updErr) throw updErr;

      toast({ title: "Baked", description: "Live-fitted part saved to this project." });
      onBaked(row.asset_url, row.id);
    } catch (e: any) {
      toast({
        title: "Bake failed",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setBaking(false);
    }
  }

  function handleSendForPrint() {
    if (!previewGeo) return;
    const stl = geometryToStlBuffer(previewGeo);
    const blob = new Blob([stl], { type: "model/stl" });
    onSendForPrint?.(blob);
  }

  if (!baseMeshUrl) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-[11px] text-muted-foreground">
        Add a base car STL on this project to enable Live Fit.
      </div>
    );
  }
  if (!partUrl) {
    return (
      <div className="rounded-md border border-border bg-surface-0 p-2 text-[11px] text-muted-foreground">
        This part has no mesh asset yet — generate or upload one to use Live Fit.
      </div>
    );
  }

  const liveStatus =
    busy === "snap" ? "Conforming…"
    : busy === "trim" ? "Trimming…"
    : loadingAssets ? "Loading meshes…"
    : "Live";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-xs">
          <Wand2 className="h-3 w-3 text-primary" /> Live Fit
        </Label>
        <Badge variant="secondary" className="text-[10px]">
          {liveStatus}
        </Badge>
      </div>

      <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-surface-0">
        {previewGeo ? (
          <Canvas camera={{ position: [0.6, 0.5, 0.9], fov: 38 }} dpr={[1, 1.5]} shadows={false}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[2, 3, 2]} intensity={1.2} />
            <directionalLight position={[-2, 1, -1]} intensity={0.4} />
            <Suspense fallback={null}>
              <Bounds fit observe margin={1.3}>
                <mesh geometry={previewGeo}>
                  <meshPhysicalMaterial
                    color="#0a0d11"
                    metalness={0.65}
                    roughness={0.35}
                    clearcoat={0.8}
                    emissive="#06b6d4"
                    emissiveIntensity={0.18}
                  />
                </mesh>
              </Bounds>
            </Suspense>
            <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
          </Canvas>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            {loadingAssets ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            ) : (
              "Drag the offset to begin"
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Magnet className="h-3 w-3" /> Body offset
          </Label>
          <span className="text-mono text-[10px] tabular-nums text-foreground">
            {offsetMm.toFixed(1)} mm
          </span>
        </div>
        <Slider
          value={[offsetMm]}
          min={0}
          max={10}
          step={0.5}
          onValueChange={(v) => setOffsetMm(v[0] ?? 0)}
          disabled={loadingAssets}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-[11px]">
          <Scissors className="h-3 w-3" /> Cut where it overlaps body
        </Label>
        <Switch checked={trim} onCheckedChange={setTrim} disabled={loadingAssets} />
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          onClick={handleBake}
          disabled={!previewGeo || baking}
          className="h-7 text-xs"
        >
          {baking ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
          Bake
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSendForPrint}
          disabled={!previewGeo || !onSendForPrint}
          className="h-7 text-xs"
          title="Send the fitted geometry to the worker for a print-ready STL"
        >
          <Send className="mr-1 h-3 w-3" /> Print-ready
        </Button>
      </div>
    </div>
  );
}
