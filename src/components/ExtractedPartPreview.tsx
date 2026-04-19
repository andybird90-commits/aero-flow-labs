/**
 * ExtractedPartPreview
 *
 * After clicking a hotspot on a concept render, this modal shows the part
 * we measured rendered in 3D *off the car* — same geometry that the STL
 * download will contain. Lets the user inspect it, tweak nothing for now,
 * and confirm download.
 *
 * Uses the same `buildPartMesh` builders as `part-stl.ts`, so what you see
 * here is byte-identical to what gets exported.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { buildPartMesh } from "@/lib/part-geometry";

interface Props {
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
  kind: string;
  label: string;
  params: Record<string, number>;
  reasoning?: string;
  filename: string;
}

export function ExtractedPartPreview({
  open, onClose, onDownload, kind, label, params, reasoning, filename,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  // Friendly param list (mm / deg) for the side panel.
  const paramRows = useMemo(() => {
    return Object.entries(params).map(([k, v]) => {
      const num = typeof v === "number" ? v : Number(v);
      const unit = /angle|kick|aoa/i.test(k)
        ? "°"
        : /count|pct|percent/i.test(k)
          ? ""
          : "mm";
      return { k, value: Number.isFinite(num) ? num.toFixed(unit === "" ? 0 : 1) : String(v), unit };
    });
  }, [params]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    // Wait until the dialog has actually laid out the mount with non-zero size.
    // Radix animates content in, so first frame is often 0×0.
    const waitForMount = () => {
      if (cancelled) return;
      const mount = mountRef.current;
      const w = mount?.clientWidth ?? 0;
      const h = mount?.clientHeight ?? 0;
      if (!mount || w < 20 || h < 20) {
        requestAnimationFrame(waitForMount);
        return;
      }
      cleanup = init(mount, w, h);
    };

    const init = (mount: HTMLDivElement, width: number, height: number) => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b0d10);

      // Camera works in millimetres so distances stay in nice human numbers.
      const camera = new THREE.PerspectiveCamera(40, width / height, 1, 20000);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(2000, 3000, 2000);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
      rim.position.set(-2000, 1000, -2000);
      scene.add(rim);

      // Build part (metres) and scale to mm so it matches the STL + bbox readout.
      const part = buildPartMesh(kind, params);
      part.scale.setScalar(1000);
      part.updateMatrixWorld(true);

      const material = new THREE.MeshStandardMaterial({
        color: 0xd6dae0,
        roughness: 0.45,
        metalness: 0.15,
      });
      part.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = material;
      });
      scene.add(part);

      // Wireframe overlay so internal sub-parts (fences, strakes, stands) are legible.
      const edgesGroup = new THREE.Group();
      part.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry) {
          const eg = new THREE.EdgesGeometry(m.geometry, 25);
          const line = new THREE.LineSegments(
            eg,
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
          );
          m.updateWorldMatrix(true, false);
          line.applyMatrix4(m.matrixWorld);
          edgesGroup.add(line);
        }
      });
      scene.add(edgesGroup);

      // Frame camera around the part bbox.
      const box = new THREE.Box3().setFromObject(part);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 100);

      // Grid sized to part, in mm.
      const gridSize = Math.ceil((maxDim * 3) / 100) * 100;
      const grid = new THREE.GridHelper(gridSize, 20, 0x2a313a, 0x1a1d22);
      grid.position.y = box.min.y - 5;
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.6;
      scene.add(grid);

      const dist = maxDim * 2.4;
      camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.9);
      camera.lookAt(center);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(center);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;
      controls.update();

      let raf = 0;
      const tick = () => {
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();

      const onResize = () => {
        const w = mount.clientWidth, h = mount.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
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

    waitForMount();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [open, kind, params]);

  // Approx bounding-box dims (mm) for the info panel
  const dimsMm = useMemo(() => {
    if (!open) return null;
    const part = buildPartMesh(kind, params);
    part.scale.setScalar(1000); // metres → mm
    part.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(part);
    const s = box.getSize(new THREE.Vector3());
    return { x: Math.round(s.x), y: Math.round(s.y), z: Math.round(s.z) };
  }, [open, kind, params]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {label}
            <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">{kind}</span>
          </DialogTitle>
          <DialogDescription>
            {reasoning || "Measured from the concept render. Preview below matches the STL exactly."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4">
          <div
            ref={mountRef}
            className="w-full aspect-[4/3] rounded-md border border-border bg-surface-0 overflow-hidden"
          />

          <div className="space-y-3 text-xs">
            <div>
              <div className="uppercase tracking-widest text-muted-foreground mb-1">Bounding box</div>
              <div className="font-mono text-foreground">
                {dimsMm ? `${dimsMm.x} × ${dimsMm.y} × ${dimsMm.z} mm` : "—"}
              </div>
            </div>
            <div>
              <div className="uppercase tracking-widest text-muted-foreground mb-1">Parameters</div>
              <ul className="space-y-1 font-mono">
                {paramRows.map((r) => (
                  <li key={r.k} className="flex items-center justify-between gap-2 text-foreground">
                    <span className="text-muted-foreground">{r.k}</span>
                    <span>{r.value}{r.unit}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-[10px] text-muted-foreground leading-relaxed pt-2 border-t border-border">
              File: <span className="font-mono text-foreground">{filename}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button onClick={onDownload}>
            <Download className="h-4 w-4 mr-1" /> Download STL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
