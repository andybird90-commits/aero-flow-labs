/**
 * PartMesh — loads and renders a placed part's actual GLB/STL asset.
 *
 * Falls back to a labelled box if the asset can't be loaded yet (still
 * fetching, missing URL, or load error). Mirroring is supported by flipping
 * scale.z (handled by the parent transform).
 *
 * Auto-fits the loaded geometry into a small bounding cube (~0.5m max edge)
 * before applying the placed-part scale, so wildly different mesh export
 * scales all start out at a sensible size in the scene.
 */
import { useEffect, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { GLTFLoader } from "three-stdlib";
import type { LibraryItem } from "@/lib/repo";
import { detectMeshKind } from "@/lib/build-studio/part-mesh";

const TARGET_FIT = 0.5; // metres — base size before user scale is applied

interface Props {
  libraryItem?: LibraryItem | null;
  selected: boolean;
  locked: boolean;
  /**
   * Per-placed-part metadata. If it contains `autofit_glb_url`, that fitted
   * GLB takes precedence over the library item's asset_url so the autofitted
   * mesh shows in the viewport without mutating shared library entries.
   */
  placedMetadata?: Record<string, unknown> | null;
}

function loadObject(
  url: string,
  kind: "glb" | "stl",
): Promise<THREE.Object3D | null> {
  return new Promise((resolve) => {
    if (kind === "stl") {
      const loader = new STLLoader();
      loader.load(
        url,
        (geo) => {
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo);
          resolve(mesh);
        },
        undefined,
        () => resolve(null),
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        () => resolve(null),
      );
    }
  });
}

export function PartMesh({ libraryItem, selected, locked, placedMetadata }: Props) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);

  // Autofit override wins over the library asset, so a re-baked part can swap
  // in without touching the shared library_items row.
  const autofitUrl = (placedMetadata?.autofit_glb_url as string | undefined) ?? null;
  const url = autofitUrl ?? libraryItem?.asset_url ?? null;
  const kind: "glb" | "stl" = autofitUrl ? "glb" : (detectMeshKind(libraryItem ?? null) ?? "stl");
  const metadata = (libraryItem?.metadata ?? {}) as Record<string, unknown>;
  // Both Live Fit AND Autofit return meshes already baked in the car's world
  // frame — render them as-is without re-centering or re-scaling. The parent
  // group is forced to identity for autofit parts (see BuildStudioViewport).
  const preservesLocalFrame = !!autofitUrl || metadata.source === "live-fit";

  useEffect(() => {
    let cancelled = false;
    setObject(null);
    setFailed(false);

    if (!url || !kind) return () => { cancelled = true; };

    loadObject(url, kind).then((obj) => {
      if (cancelled) return;
      if (!obj) {
        setFailed(true);
        return;
      }

      // Fit ordinary uploads into a unit-ish bounding box. Baked Live Fit
      // meshes are already written in the placed part's local frame; centring
      // them again moves the conformed arch away from the exact fitted offset.
      const wrapper = new THREE.Group();
      wrapper.add(obj);

      if (!preservesLocalFrame) {
        const box = new THREE.Box3().setFromObject(wrapper);
        const size = new THREE.Vector3();
        box.getSize(size);
        const longest = Math.max(size.x, size.y, size.z);
        if (isFinite(longest) && longest > 0) {
          wrapper.scale.setScalar(TARGET_FIT / longest);
        }

        const fitted = new THREE.Box3().setFromObject(wrapper);
        const center = new THREE.Vector3();
        fitted.getCenter(center);
        wrapper.position.sub(center);
      }

      // Apply a clean motorsport material to anything missing one.
      wrapper.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          if (!m.material || (m.material as any).isMeshBasicMaterial) {
            m.material = new THREE.MeshPhysicalMaterial({
              color: "#0a0d11",
              metalness: 0.7,
              roughness: 0.35,
              clearcoat: 0.9,
              clearcoatRoughness: 0.25,
            });
          }
        }
      });

      setObject(wrapper);
    });

    return () => {
      cancelled = true;
    };
  }, [url, kind, preservesLocalFrame]);

  // Selected outline: re-tint materials. Keep simple.
  useEffect(() => {
    if (!object) return;
    object.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.material && !Array.isArray(m.material)) {
        const mat = m.material as THREE.MeshPhysicalMaterial;
        if (mat.emissive) {
          mat.emissive.set(selected ? "#7c2d12" : "#000000");
          mat.emissiveIntensity = selected ? 0.45 : 0;
          mat.needsUpdate = true;
        }
      }
    });
  }, [object, selected]);

  if (object) return <primitive object={object} />;

  // Fallback box — orange when active, slate when locked.
  const color = selected ? "#fb923c" : locked ? "#475569" : failed ? "#7f1d1d" : "#f97316";
  return (
    <mesh castShadow>
      <boxGeometry args={[0.4, 0.18, 0.6]} />
      <meshStandardMaterial
        color={color}
        metalness={0.3}
        roughness={0.5}
        emissive={selected ? "#7c2d12" : "#000000"}
        emissiveIntensity={selected ? 0.4 : 0}
      />
    </mesh>
  );
}
