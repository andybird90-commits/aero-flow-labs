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

function PartMeshInner({ libraryItem, selected, locked, placedMetadata }: Props) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);

  // Autofit override wins over the library asset, so a re-baked part can swap
  // in without touching the shared library_items row.
  const autofitUrl = (placedMetadata?.autofit_glb_url as string | undefined) ?? null;
  const baseUrl = autofitUrl ?? libraryItem?.asset_url ?? null;
  // Cache-bust autofit results so Three.js / browser GLTF cache doesn't
  // hand back the previous fitted GLB when the URL string is reused.
  const url = baseUrl
    ? (autofitUrl ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}t=${encodeURIComponent(
        (placedMetadata?.autofit_at as string | undefined) ?? Date.now().toString(),
      )}` : baseUrl)
    : null;

  // Debug: log every render so we can see whether the autofit metadata is
  // actually reaching this component after the mutation completes.
  // eslint-disable-next-line no-console
  console.log("[PartMesh render]", {
    placedMetadata,
    autofitUrl,
    url,
    libraryItemId: libraryItem?.id ?? null,
  });
  const kind: "glb" | "stl" = autofitUrl ? "glb" : (detectMeshKind(libraryItem ?? null) ?? "stl");
  const metadata = (libraryItem?.metadata ?? {}) as Record<string, unknown>;
  // Render as-is (no recentre/rescale) when the mesh was already baked into
  // the placed-part local frame.
  const preservesLocalFrame = metadata.source === "live-fit" || !!autofitUrl;

  // Dispose helper — releases GPU memory of the previously loaded GLB so
  // a re-fitted part doesn't leak geometry/materials each iteration.
  const disposeObject = (obj: THREE.Object3D | null) => {
    if (!obj) return;
    obj.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose?.();
        const mat = m.material as any;
        if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
        else mat?.dispose?.();
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    setObject((prev) => { disposeObject(prev); return null; });
    setFailed(false);

    if (!url || !kind) return () => { cancelled = true; };

    loadObject(url, kind).then((obj) => {
      if (cancelled) { disposeObject(obj); return; }
      if (!obj) {
        setFailed(true);
        return;
      }

      const wrapper = new THREE.Group();
      wrapper.add(obj);

      // Diagnostic: log the loaded GLB's world bbox + per-node transforms so we
      // can confirm the autofit result is at world origin with identity TRS.
      if (autofitUrl) {
        const bbox = new THREE.Box3().setFromObject(wrapper);
        const size = new THREE.Vector3(); bbox.getSize(size);
        const center = new THREE.Vector3(); bbox.getCenter(center);
        const nodes: Array<{ name: string; type: string; pos: number[]; rot: number[]; scl: number[] }> = [];
        obj.traverse((n) => {
          nodes.push({
            name: n.name || "(unnamed)",
            type: n.type,
            pos: [n.position.x, n.position.y, n.position.z],
            rot: [n.rotation.x, n.rotation.y, n.rotation.z],
            scl: [n.scale.x, n.scale.y, n.scale.z],
          });
        });
        // eslint-disable-next-line no-console
        console.log("[PartMesh autofit GLB loaded]", {
          url,
          bbox: {
            min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
            max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z },
            size: { x: size.x, y: size.y, z: size.z },
            center: { x: center.x, y: center.y, z: center.z },
          },
          sceneNodes: nodes,
        });
      }

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
          // Autofit results from CSG can have inconsistent triangle winding,
          // which renders as holes/shredded geometry from certain angles.
          // Force double-sided rendering so the part looks solid from any view.
          if (autofitUrl) {
            const applySide = (mat: any) => {
              if (mat && "side" in mat) {
                mat.side = THREE.DoubleSide;
                mat.shadowSide = THREE.DoubleSide;
                mat.needsUpdate = true;
              }
            };
            const mat = m.material as any;
            if (Array.isArray(mat)) mat.forEach(applySide);
            else applySide(mat);
          }
        }
      });

      setObject(wrapper);
    });

    return () => {
      cancelled = true;
    };
  }, [url, kind, preservesLocalFrame]);

  // Dispose on unmount.
  useEffect(() => {
    return () => { disposeObject(object); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

/**
 * Public wrapper — keys the inner component on the autofit URL so when a
 * re-baked GLB lands the loader is fully remounted (no stale state, no
 * cached GLTF parser instance reusing the previous geometry).
 */
export function PartMesh(props: Props) {
  const autofitUrl = (props.placedMetadata?.autofit_glb_url as string | undefined) ?? null;
  const autofitAt = (props.placedMetadata?.autofit_at as string | undefined) ?? "";
  const remountKey = autofitUrl ? `${autofitUrl}::${autofitAt}` : "base";
  return <PartMeshInner key={remountKey} {...props} />;
}
