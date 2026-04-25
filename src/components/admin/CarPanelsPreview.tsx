/**
 * CarPanelsPreview — admin-only debug viewer for auto-split body panels.
 *
 * Renders each panel STL in a different colour so the admin can eyeball
 * whether the dihedral split produced sensible groupings. Hover a panel
 * row → only that panel renders (others fade) so you can isolate ambiguous
 * unknowns. Click an unknown's slot dropdown to re-label it without
 * re-running the split.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import { Loader2 } from "lucide-react";
import {
  getPanelSignedUrl,
  panelDisplayLabel,
  type CarPanel,
} from "@/lib/build-studio/car-panels";

interface PanelMeshState {
  panel: CarPanel;
  geometry: THREE.BufferGeometry | null;
  color: string;
}

const COLOURS = [
  "#22d3ee", "#fb923c", "#a78bfa", "#34d399", "#f472b6",
  "#fbbf24", "#60a5fa", "#f87171", "#4ade80", "#c084fc",
  "#2dd4bf", "#facc15", "#818cf8", "#fb7185", "#10b981",
];

interface Props {
  panels: CarPanel[];
  highlightedPanelId?: string | null;
}

export function CarPanelsPreview({ panels, highlightedPanelId }: Props) {
  const [meshes, setMeshes] = useState<PanelMeshState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const loader = new STLLoader();
      const states: PanelMeshState[] = [];
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i];
        const url = await getPanelSignedUrl(p.stl_path, 3600);
        if (cancelled) return;
        if (!url) {
          states.push({ panel: p, geometry: null, color: COLOURS[i % COLOURS.length] });
          continue;
        }
        try {
          const geo = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
            loader.load(url, (g) => resolve(g), undefined, (err) => reject(err));
          });
          if (cancelled) return;
          geo.computeVertexNormals();
          states.push({ panel: p, geometry: geo, color: COLOURS[i % COLOURS.length] });
        } catch {
          states.push({ panel: p, geometry: null, color: COLOURS[i % COLOURS.length] });
        }
      }
      if (!cancelled) {
        setMeshes(states);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [panels]);

  // Build a wrapper group that auto-fits the union of all panels into ~3 m.
  const wrapper = useMemo(() => {
    if (meshes.length === 0) return null;
    const group = new THREE.Group();
    for (const m of meshes) {
      if (!m.geometry) continue;
      const isHidden = !!highlightedPanelId && m.panel.id !== highlightedPanelId;
      const mat = new THREE.MeshStandardMaterial({
        color: m.color,
        metalness: 0.2,
        roughness: 0.55,
        transparent: isHidden,
        opacity: isHidden ? 0.08 : 1.0,
        depthWrite: !isHidden,
      });
      const mesh = new THREE.Mesh(m.geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // Three.js convention: STLs are typically Z-up. After our canonicalisation
    // we already saved them as Y-up (-Z forward), so no rotation needed.
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    if (isFinite(longest) && longest > 0) group.scale.setScalar(3.5 / longest);
    const box2 = new THREE.Box3().setFromObject(group);
    const center = new THREE.Vector3();
    box2.getCenter(center);
    group.position.sub(center);
    const box3 = new THREE.Box3().setFromObject(group);
    group.position.y -= box3.min.y;
    return group;
  }, [meshes, highlightedPanelId]);

  if (loading) {
    return (
      <div className="grid h-[420px] place-items-center rounded-lg border border-border bg-surface-1/50 text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading {panels.length} panels…
        </div>
      </div>
    );
  }

  if (panels.length === 0) {
    return (
      <div className="grid h-[420px] place-items-center rounded-lg border border-border bg-surface-1/50 text-sm text-muted-foreground">
        No panels yet. Run Auto-split to generate them.
      </div>
    );
  }

  return (
    <div className="h-[420px] overflow-hidden rounded-lg border border-border bg-[#0a0a0c]">
      <Canvas
        shadows
        camera={{ position: [4, 2.5, 4.5], fov: 38, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0a0a0c"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 8, 5]} intensity={1.0} castShadow shadow-mapSize={[1024, 1024]} />
        <Suspense fallback={null}>
          <Environment preset="warehouse" />
        </Suspense>
        <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={10} blur={2.5} far={4} />
        {wrapper && <primitive object={wrapper} />}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={20} />
      </Canvas>
      <div className="pointer-events-none absolute -mt-[420px] flex h-[420px] flex-col justify-end p-3">
        <div className="flex flex-wrap gap-1.5">
          {meshes.slice(0, 18).map((m) => (
            <div
              key={m.panel.id}
              className="flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 text-mono text-[10px] uppercase tracking-wider backdrop-blur"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.color }} />
              {panelDisplayLabel(m.panel.slot)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
