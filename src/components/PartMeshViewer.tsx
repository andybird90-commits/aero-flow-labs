/**
 * Compact STL/GLB viewer used by the Library to preview a saved concept_part.
 * Auto-rotates, frames the model, and degrades to a static fallback if the
 * mesh fails to load.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Loader2 } from "lucide-react";

interface Props {
  url: string;
  className?: string;
  /** Background colour (hex int, e.g. 0x000000). Default 0x0b0d10. */
  background?: number;
  /** Mesh material colour (hex int). Default 0xb8c2cc (warm clay). */
  meshColor?: number;
  /** Auto-rotate the model. Default true. */
  autoRotate?: boolean;
}

export function PartMeshViewer({
  url,
  className,
  background = 0x0b0d10,
  meshColor = 0xb8c2cc,
  autoRotate = true,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    setError(null);
    setLoading(true);

    const init = (mount: HTMLDivElement, w: number, h: number) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(background);
      const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 10000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(3, 4, 3); scene.add(key);
      const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
      rim.position.set(-3, 2, -3); scene.add(rim);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 0.7;

      (async () => {
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          if (cancelled) return;

          // Detect format: GLB starts with "glTF" magic bytes; otherwise STL.
          const head4 = new TextDecoder().decode(buf.slice(0, 4));
          const isGlb = head4 === "glTF";

          let model: THREE.Object3D;
          if (isGlb) {
            const gltfLoader = new GLTFLoader();
            const gltf: any = await new Promise((resolve, reject) =>
              gltfLoader.parse(buf, "", resolve, reject),
            );
            model = gltf.scene;
            // Re-skin with neutral clay material so it matches our STL look.
            const clay = new THREE.MeshStandardMaterial({
              color: meshColor, metalness: 0.2, roughness: 0.6,
            });
            model.traverse((o) => {
              const m = o as THREE.Mesh;
              if (m.isMesh) m.material = clay;
            });
          } else {
            const stlLoader = new STLLoader();
            const head = new TextDecoder().decode(buf.slice(0, 1024)).trim().toLowerCase();
            const isAscii = head.startsWith("solid") && head.includes("facet");
            const geometry = isAscii
              ? stlLoader.parse(new TextDecoder().decode(buf))
              : stlLoader.parse(buf);
            geometry.computeVertexNormals();
            const material = new THREE.MeshStandardMaterial({
              color: meshColor, metalness: 0.2, roughness: 0.6,
            });
            model = new THREE.Mesh(geometry, material);
          }
          scene.add(model);

          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const dist = maxDim * 1.6;
          camera.near = Math.max(0.1, maxDim / 1000);
          camera.far = Math.max(10000, maxDim * 10);
          camera.updateProjectionMatrix();
          camera.position.set(center.x + dist, center.y + dist * 0.3, center.z + dist);
          controls.target.copy(center);
          controls.minDistance = maxDim * 0.2;
          controls.maxDistance = maxDim * 6;
          controls.update();
          setLoading(false);
        } catch (e: any) {
          if (cancelled) return;
          setError(String(e?.message ?? e));
          setLoading(false);
        }
      })();

      let raf = 0;
      const tick = () => {
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      const onResize = () => {
        const cw = mount.clientWidth, ch = mount.clientHeight;
        if (!cw || !ch) return;
        camera.aspect = cw / ch;
        camera.updateProjectionMatrix();
        renderer.setSize(cw, ch);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(mount);

      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = (m as any).material;
          if (Array.isArray(mat)) mat.forEach((x: any) => x?.dispose?.());
          else mat?.dispose?.();
        });
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      };
    };

    const wait = () => {
      if (cancelled) return;
      const m = mountRef.current;
      const w = m?.clientWidth ?? 0;
      const h = m?.clientHeight ?? 0;
      if (!m || w < 20 || h < 20) {
        requestAnimationFrame(wait);
        return;
      }
      cleanup = init(m, w, h);
    };
    wait();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [url, background, meshColor, autoRotate]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={mountRef} className="absolute inset-0" />
      {loading && !error && (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground p-4 text-center">
          Mesh failed to load
        </div>
      )}
    </div>
  );
}
