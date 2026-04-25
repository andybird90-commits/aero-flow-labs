/**
 * ShowroomCar — read-only renderer for the project's hero STL with the
 * curated paint finish + per-region material tags.
 *
 * Functionally a slimmer cousin of <HeroStlCar> from BuildStudioViewport,
 * but optimised for presentation: no gizmos, no picking, no transform refs.
 * If we ever want to refactor BuildStudio to share this, the grouping logic
 * is identical.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader, GLTFLoader } from "three-stdlib";
import type { CarTemplate } from "@/lib/repo";
import {
  DEFAULT_GLASS_FINISH,
  DEFAULT_TYRE_FINISH,
  DEFAULT_WHEEL_FINISH,
  type MaterialFinish,
  type PaintFinish,
} from "@/lib/build-studio/paint-finish";

export function ShowroomCar({
  url,
  template,
  paintFinish,
  materialTags,
}: {
  url: string;
  template?: CarTemplate | null;
  paintFinish: PaintFinish;
  materialTags?: Uint8Array | null;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);
  const matRefs = useRef<{
    body: THREE.MeshPhysicalMaterial | null;
    glass: THREE.MeshPhysicalMaterial | null;
    wheel: THREE.MeshPhysicalMaterial | null;
    tyre: THREE.MeshPhysicalMaterial | null;
  }>({ body: null, glass: null, wheel: null, tyre: null });

  useEffect(() => {
    let cancelled = false;
    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

    const loader = new STLLoader();
    loader.load(
      url,
      (geo) => {
        if (cancelled) return;
        geo.computeVertexNormals();

        const triCount = geo.attributes.position.count / 3;
        const tagsValid = materialTags && materialTags.length === triCount;

        const bodyMat = new THREE.MeshPhysicalMaterial({
          color: paintFinish.color,
          metalness: paintFinish.metalness,
          roughness: paintFinish.roughness,
          clearcoat: paintFinish.clearcoat,
          clearcoatRoughness: paintFinish.clearcoat_roughness,
          envMapIntensity: paintFinish.env_intensity,
        });
        matRefs.current.body = bodyMat;

        let materials: THREE.Material[] = [bodyMat];

        if (tagsValid) {
          const glassFinish = paintFinish.glass ?? DEFAULT_GLASS_FINISH;
          const wheelFinish = paintFinish.wheels ?? DEFAULT_WHEEL_FINISH;
          const tyreFinish = paintFinish.tyres ?? DEFAULT_TYRE_FINISH;

          const glassMat = new THREE.MeshPhysicalMaterial({
            color: glassFinish.color,
            metalness: glassFinish.metalness,
            roughness: glassFinish.roughness,
            clearcoat: glassFinish.clearcoat,
            clearcoatRoughness: glassFinish.clearcoat_roughness,
            transparent: true,
            opacity: glassFinish.opacity ?? 0.55,
            transmission: 0.6,
            thickness: 0.05,
            envMapIntensity: paintFinish.env_intensity,
            depthWrite: false,
          });
          const wheelMat = new THREE.MeshPhysicalMaterial({
            color: wheelFinish.color,
            metalness: wheelFinish.metalness,
            roughness: wheelFinish.roughness,
            clearcoat: wheelFinish.clearcoat,
            clearcoatRoughness: wheelFinish.clearcoat_roughness,
            envMapIntensity: paintFinish.env_intensity,
          });
          const tyreMat = new THREE.MeshPhysicalMaterial({
            color: tyreFinish.color,
            metalness: tyreFinish.metalness,
            roughness: tyreFinish.roughness,
            clearcoat: tyreFinish.clearcoat,
            clearcoatRoughness: tyreFinish.clearcoat_roughness,
          });
          matRefs.current.glass = glassMat;
          matRefs.current.wheel = wheelMat;
          matRefs.current.tyre = tyreMat;
          materials = [bodyMat, glassMat, wheelMat, tyreMat];

          // Sort triangles by tag → contiguous geometry groups.
          const positions = geo.attributes.position.array as Float32Array;
          const normals = geo.attributes.normal.array as Float32Array;
          const triIndices = new Uint32Array(triCount);
          for (let i = 0; i < triCount; i++) triIndices[i] = i;
          triIndices.sort((a, b) => materialTags![a] - materialTags![b]);

          const newPos = new Float32Array(positions.length);
          const newNorm = new Float32Array(normals.length);
          for (let i = 0; i < triCount; i++) {
            const src = triIndices[i] * 9;
            const dst = i * 9;
            for (let k = 0; k < 9; k++) {
              newPos[dst + k] = positions[src + k];
              newNorm[dst + k] = normals[src + k];
            }
          }
          geo.setAttribute("position", new THREE.BufferAttribute(newPos, 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(newNorm, 3));

          geo.clearGroups();
          let runStart = 0;
          let runTag = materialTags![triIndices[0]];
          for (let i = 1; i <= triCount; i++) {
            const t = i < triCount ? materialTags![triIndices[i]] : -1;
            if (t !== runTag) {
              const start = runStart * 3;
              const count = (i - runStart) * 3;
              const matIndex = Math.min(3, Math.max(0, runTag));
              geo.addGroup(start, count, matIndex);
              runStart = i;
              runTag = t;
            }
          }
        }

        const mesh = new THREE.Mesh(
          geo,
          materials.length === 1 ? materials[0] : (materials as THREE.Material[]),
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const wrapper = new THREE.Group();
        mesh.rotation.x = -Math.PI / 2;
        wrapper.add(mesh);

        const box = new THREE.Box3().setFromObject(wrapper);
        const size = new THREE.Vector3();
        box.getSize(size);
        const longest = Math.max(size.x, size.y, size.z);
        if (isFinite(longest) && longest > 0) {
          wrapper.scale.setScalar(targetLength / longest);
        }
        const box2 = new THREE.Box3().setFromObject(wrapper);
        const center = new THREE.Vector3();
        box2.getCenter(center);
        wrapper.position.sub(center);
        const box3 = new THREE.Box3().setFromObject(wrapper);
        wrapper.position.y -= box3.min.y;

        setObject(wrapper);
      },
      undefined,
      () => {
        if (!cancelled) setObject(null);
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, template?.wheelbase_mm, materialTags]);

  // Live paint updates without reloading the STL.
  useEffect(() => {
    const apply = (
      m: THREE.MeshPhysicalMaterial | null,
      f: MaterialFinish | undefined,
      env: number,
    ) => {
      if (!m || !f) return;
      m.color.set(f.color);
      m.metalness = f.metalness;
      m.roughness = f.roughness;
      m.clearcoat = f.clearcoat;
      m.clearcoatRoughness = f.clearcoat_roughness;
      m.envMapIntensity = env;
      if (f.opacity !== undefined) m.opacity = f.opacity;
      m.needsUpdate = true;
    };
    apply(
      matRefs.current.body,
      {
        color: paintFinish.color,
        metalness: paintFinish.metalness,
        roughness: paintFinish.roughness,
        clearcoat: paintFinish.clearcoat,
        clearcoat_roughness: paintFinish.clearcoat_roughness,
      },
      paintFinish.env_intensity,
    );
    apply(matRefs.current.wheel, paintFinish.wheels, paintFinish.env_intensity);
    apply(matRefs.current.tyre, paintFinish.tyres, paintFinish.env_intensity);
    apply(matRefs.current.glass, paintFinish.glass, paintFinish.env_intensity);
  }, [paintFinish]);

  if (!object) return null;
  return <primitive object={object} />;
}

/**
 * ShowroomShell — translucent body-skin overlay (matches BuildStudio's look).
 */
export function ShowroomShell({
  url,
  kind,
  template,
  transform,
}: {
  url: string;
  kind: "stl" | "glb";
  template?: CarTemplate | null;
  transform?: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } } | null;
}) {
  const [object, setObject] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    const targetLength = ((template?.wheelbase_mm ?? 2575) / 1000) + 1.45;

    const onLoaded = (raw: THREE.Object3D) => {
      if (cancelled) return;
      const wrapper = new THREE.Group();
      wrapper.add(raw);
      const box = new THREE.Box3().setFromObject(wrapper);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longest = Math.max(size.x, size.y, size.z);
      if (isFinite(longest) && longest > 0) wrapper.scale.setScalar(targetLength / longest);
      const box2 = new THREE.Box3().setFromObject(wrapper);
      const center = new THREE.Vector3();
      box2.getCenter(center);
      wrapper.position.sub(center);
      const box3 = new THREE.Box3().setFromObject(wrapper);
      wrapper.position.y -= box3.min.y;

      wrapper.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false;
          m.receiveShadow = false;
          m.material = new THREE.MeshPhysicalMaterial({
            color: "#fb923c",
            metalness: 0.2,
            roughness: 0.6,
            transparent: true,
            opacity: 0.42,
            clearcoat: 0.3,
          });
        }
      });

      setObject(wrapper);
    };

    if (kind === "stl") {
      const loader = new STLLoader();
      loader.load(
        url,
        (geo) => {
          geo.computeVertexNormals();
          const mesh = new THREE.Mesh(geo);
          mesh.rotation.x = -Math.PI / 2;
          onLoaded(mesh);
        },
        undefined,
        () => !cancelled && setObject(null),
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => onLoaded(gltf.scene),
        undefined,
        () => !cancelled && setObject(null),
      );
    }

    return () => {
      cancelled = true;
    };
  }, [url, kind, template?.wheelbase_mm]);

  if (!object) return null;
  return (
    <group
      position={transform ? [transform.position.x, transform.position.y, transform.position.z] : [0, 0, 0]}
      rotation={transform ? [transform.rotation.x, transform.rotation.y, transform.rotation.z] : [0, 0, 0]}
      scale={transform ? [transform.scale.x, transform.scale.y, transform.scale.z] : [1, 1, 1]}
    >
      <primitive object={object} />
    </group>
  );
}
