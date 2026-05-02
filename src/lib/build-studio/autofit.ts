import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { supabase } from "@/integrations/supabase/client";
import type { PlacedPart } from "@/lib/build-studio/placed-parts";
import {
  getCarObject,
  getPlacedPartObject,
} from "@/lib/build-studio/scene-registry";

export type AutofitPartKind =
  | "wing" | "bumper" | "spoiler" | "lip" | "skirt" | "diffuser";

export interface AutofitPlacedPartInput {
  placed_part_id: string;
  part_kind: AutofitPartKind;
  project_id: string;
  car_url?: string;
  part_url?: string;
  part: PlacedPart;
}

export interface AutofitPlacedPartResult {
  ok: boolean;
  placed_part_id: string;
  result_url: string;
  part_kind?: string;
  processing_ms: number | null;
}

function bakeLiveWorldGeometry(liveRoot: THREE.Object3D): THREE.BufferGeometry {
  liveRoot.updateWorldMatrix(true, true);
  const geometries: THREE.BufferGeometry[] = [];
  liveRoot.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as any).isMesh || !mesh.geometry) return;
    const g = mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    if (g.index) {
      const nonIndexed = g.toNonIndexed();
      g.dispose();
      nonIndexed.applyMatrix4(mesh.matrixWorld);
      if (!nonIndexed.attributes.normal) nonIndexed.computeVertexNormals();
      geometries.push(nonIndexed);
      return;
    }
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    geometries.push(g);
  });
  if (geometries.length === 0) throw new Error("No meshes found under live root");
  let totalVerts = 0;
  for (const g of geometries) totalVerts += g.attributes.position.count;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of geometries) {
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal.array as ArrayLike<number>;
    positions.set(p as any, offset * 3);
    normals.set(n as any, offset * 3);
    offset += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function exportGlb(root: THREE.Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: "model/gltf-binary" }));
        } else {
          resolve(new Blob([JSON.stringify(result)], { type: "model/gltf+json" }));
        }
      },
      (err) => reject(new Error(`GLTFExporter failed: ${(err as any)?.message ?? String(err)}`)),
      { binary: true, embedImages: false, onlyVisible: true } as Record<string, unknown>,
    );
  });
}

let cachedEvaluator: Evaluator | null = null;
function getEvaluator(): Evaluator {
  if (cachedEvaluator) return cachedEvaluator;
  const ev = new Evaluator();
  ev.attributes = ["position", "normal"];
  ev.useGroups = false;
  cachedEvaluator = ev;
  return ev;
}

async function clientCsgRefit(input: AutofitPlacedPartInput): Promise<Blob> {
  const partMesh = getPlacedPartObject(input.placed_part_id);
  const carMesh = getCarObject();
  if (!partMesh) throw new Error(`Autofit: no live scene object for placed_part_id=${input.placed_part_id}`);
  if (!carMesh) throw new Error("Autofit: no live car mesh registered in scene");

  const partGeom = bakeLiveWorldGeometry(partMesh);
  const carGeom = bakeLiveWorldGeometry(carMesh);

  const partBrush = new Brush(partGeom);
  partBrush.updateMatrixWorld();
  const carBrush = new Brush(carGeom);
  carBrush.updateMatrixWorld();

  const evaluator = getEvaluator();
  const result = evaluator.evaluate(partBrush, carBrush, SUBTRACTION) as Brush;

  const resultGeom = result.geometry.clone();
  resultGeom.computeVertexNormals();
  resultGeom.computeBoundingBox();
  resultGeom.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  const mesh = new THREE.Mesh(resultGeom, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const blob = await exportGlb(scene);
  partGeom.dispose();
  carGeom.dispose();
  return blob;
}

async function uploadResultGlb(input: AutofitPlacedPartInput, blob: Blob): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? "anon";
  const path = `${userId}/${input.project_id}/autofit/${input.placed_part_id}-${Date.now()}.glb`;
  const { error: upErr } = await supabase.storage
    .from("frozen-parts")
    .upload(path, blob, { contentType: "model/gltf-binary", upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const { data } = supabase.storage.from("frozen-parts").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Failed to resolve public URL for autofit result");
  return data.publicUrl;
}

export function useAutofitPlacedPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AutofitPlacedPartInput): Promise<AutofitPlacedPartResult> => {
      const start = performance.now();
      const blob = await clientCsgRefit(input);
      const result_url = await uploadResultGlb(input, blob);
      const processing_ms = Math.round(performance.now() - start);
      const nextMetadata = {
        ...((input.part.metadata as Record<string, unknown> | null) ?? {}),
        autofit_glb_url: result_url,
        autofit_part_kind: input.part_kind,
        autofit_processing_ms: processing_ms,
        autofit_at: new Date().toISOString(),
        autofit_frame: "world",
        autofit_source: "client-bvh-csg",
      };
      const { error: dbErr } = await (supabase as any)
        .from("placed_parts")
        .update({ metadata: nextMetadata })
        .eq("id", input.placed_part_id);
      if (dbErr) throw new Error(`Failed to save autofit metadata: ${dbErr.message}`);
      return { ok: true, placed_part_id: input.placed_part_id, result_url, part_kind: input.part_kind, processing_ms };
    },
    onSuccess: async (data, vars) => {
      const queryKey = ["placed_parts", vars.project_id];
      qc.setQueryData<PlacedPart[]>(queryKey, (current) => {
        if (!current) return current;
        return current.map((part) => {
          if (part.id !== vars.placed_part_id) return part;
          return {
            ...part,
            metadata: {
              ...(part.metadata ?? {}),
              autofit_glb_url: data.result_url,
              autofit_part_kind: data.part_kind ?? vars.part_kind,
              autofit_processing_ms: data.processing_ms ?? null,
              autofit_at: new Date().toISOString(),
              autofit_frame: "world",
              autofit_source: "client-bvh-csg",
            },
          };
        });
      });
      await qc.invalidateQueries({ queryKey });
      await qc.refetchQueries({ queryKey, type: "active" });
    },
  });
}
