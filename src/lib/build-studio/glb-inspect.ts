/**
 * GLB / STL structure inspector.
 *
 * Downloads a mesh asset once, walks the scene graph, and returns a small
 * summary used by the Library + Part Rail to tell the user whether they're
 * looking at a single fused shell (sculpt-friendly) or a kit of separate
 * panels (per-part edit / recolour-friendly). Results are persisted into
 * `library_items.metadata.structure` so we never re-inspect.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LibraryItem } from "@/lib/repo";

export interface MeshStructure {
  /** Total `THREE.Mesh` nodes in the file. */
  meshCount: number;
  /** Distinct material instances across all meshes. */
  materialCount: number;
  /** Total triangle count (all meshes). */
  triangleCount: number;
  /** First ~10 readable node names — gives the user a hint at part naming. */
  nodeNames: string[];
  /** ISO timestamp the inspection ran. Used to invalidate later if needed. */
  inspectedAt: string;
}

export type StructureKind = "single-shell" | "multi-part" | "unknown";

export function classifyStructure(s: MeshStructure | null | undefined): StructureKind {
  if (!s) return "unknown";
  if (s.meshCount <= 1) return "single-shell";
  return "multi-part";
}

/** Sniff GLB vs STL from the first 4 bytes. */
function sniffKind(buf: ArrayBuffer): "glb" | "stl" {
  const head = new TextDecoder().decode(buf.slice(0, 4));
  return head === "glTF" ? "glb" : "stl";
}

/** Inspect a fetched buffer. Pure — no network, no disposal needed by caller. */
export async function inspectBuffer(buf: ArrayBuffer): Promise<MeshStructure> {
  const kind = sniffKind(buf);
  const meshes: THREE.Mesh[] = [];
  const names: string[] = [];

  if (kind === "glb") {
    const loader = new GLTFLoader();
    let gltf: any;
    try {
      gltf = await parseGLBAsync(loader, buf);
    } catch {
      return emptyStructure();
    }
    gltf.scene.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        meshes.push(m);
        if (o.name && names.length < 10) names.push(o.name);
      }
    });
  } else {
    try {
      const stlLoader = new STLLoader();
      const head = new TextDecoder().decode(buf.slice(0, 1024)).trim().toLowerCase();
      const isAscii = head.startsWith("solid") && head.includes("facet");
      const geo = isAscii
        ? stlLoader.parse(new TextDecoder().decode(buf))
        : stlLoader.parse(buf);
      meshes.push(new THREE.Mesh(geo));
    } catch {
      return emptyStructure();
    }
  }

  const materialIds = new Set<number>();
  let triangleCount = 0;
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) materialIds.add((mat as THREE.Material).id);
    const geo = m.geometry as THREE.BufferGeometry;
    if (geo) {
      const tris = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3;
      triangleCount += Math.floor(tris);
    }
  }

  // Dispose geometries we created so we don't leak GPU buffers (none uploaded
  // yet here — but Three may have allocated typed arrays for STL).
  for (const m of meshes) m.geometry?.dispose?.();

  return {
    meshCount: meshes.length,
    materialCount: materialIds.size,
    triangleCount,
    nodeNames: names,
    inspectedAt: new Date().toISOString(),
  };
}

function emptyStructure(): MeshStructure {
  return {
    meshCount: 0,
    materialCount: 0,
    triangleCount: 0,
    nodeNames: [],
    inspectedAt: new Date().toISOString(),
  };
}

/** Wrap GLTFLoader.parse callback API into a sync-ish helper. */
function parseGLBSync(loader: GLTFLoader, buf: ArrayBuffer): any {
  let result: any = null;
  let err: any = null;
  loader.parse(
    buf,
    "",
    (g) => {
      result = g;
    },
    (e) => {
      err = e;
    },
  );
  if (err) throw err;
  if (!result) throw new Error("GLTFLoader returned no result");
  return result;
}

/** Fetch + inspect in one go. Returns null on network/parse failure. */
export async function inspectAssetUrl(url: string): Promise<MeshStructure | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return inspectBuffer(buf);
  } catch {
    return null;
  }
}

/* ─────────── Lazy hook: inspect-on-mount, cache to library_items ─────────── */

/**
 * Inspect a library item's mesh asset on first view and persist the result
 * into `metadata.structure`. No-op if already inspected, missing asset,
 * or non-mesh kind.
 */
export function useEnsureStructureInspected(item: LibraryItem | undefined) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (i: LibraryItem) => {
      const structure = await inspectAssetUrl(i.asset_url!);
      if (!structure) return;
      const nextMeta = { ...(i.metadata ?? {}), structure };
      const { error } = await (supabase as any)
        .from("library_items")
        .update({ metadata: nextMeta })
        .eq("id", i.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library_items"] });
    },
  });

  useEffect(() => {
    if (!item) return;
    if (!item.asset_url) return;
    if (item.metadata?.structure) return;
    // Only inspect mesh assets. Skip images.
    const mime = (item.asset_mime ?? "").toLowerCase();
    const url = item.asset_url.toLowerCase().split("?")[0];
    const isMesh =
      mime.includes("gltf") ||
      mime.includes("glb") ||
      mime.includes("stl") ||
      url.endsWith(".glb") ||
      url.endsWith(".gltf") ||
      url.endsWith(".stl");
    if (!isMesh) return;
    if (mut.isPending) return;
    mut.mutate(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.asset_url, item?.metadata?.structure]);
}

/** Read structure from a library item's metadata, if cached. */
export function getCachedStructure(item: LibraryItem | undefined): MeshStructure | null {
  const s = item?.metadata?.structure;
  if (!s || typeof s !== "object") return null;
  return s as MeshStructure;
}
