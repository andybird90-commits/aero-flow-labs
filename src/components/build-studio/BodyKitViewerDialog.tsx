/**
 * BodyKitViewerDialog — preview a baked bodykit in 3D + browse its panels.
 *
 * Loads the kit's `combined_stl_path` (already a signed URL) into a
 * standalone Three.js Canvas, and lists every `body_kit_parts` row with a
 * download link to its individual STL.
 */
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, Bounds } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { STLLoader } from "three-stdlib";
import * as THREE from "three";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, ExternalLink, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useBodyKitParts, type BodyKit } from "@/lib/build-studio/body-kits";

interface Props {
  kit: BodyKit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BodyKitViewerDialog({ kit, open, onOpenChange }: Props) {
  const { data: parts = [], isLoading } = useBodyKitParts(kit?.id ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {kit?.name ?? "Bodykit"}
          </DialogTitle>
          {kit && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                {kit.status}
              </Badge>
              <span>·</span>
              <span>{kit.panel_count} panel{kit.panel_count === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{formatDistanceToNow(new Date(kit.created_at), { addSuffix: true })}</span>
            </div>
          )}
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_320px]">
          {/* 3D viewer */}
          <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-muted/20">
            {kit?.combined_stl_path ? (
              <Canvas shadows camera={{ position: [4, 3, 5], fov: 40 }}>
                <color attach="background" args={["#0b0e14"]} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
                <directionalLight position={[-5, 4, -3]} intensity={0.4} />
                <Bounds fit clip observe margin={1.4}>
                  <KitMesh url={kit.combined_stl_path} />
                </Bounds>
                <OrbitControls makeDefault enableDamping />
              </Canvas>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No combined mesh available yet.
              </div>
            )}
          </div>

          {/* Panel list */}
          <div className="flex flex-col">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Panels
              </span>
              <span className="text-[10px] text-muted-foreground">{parts.length}</span>
            </div>
            {isLoading ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                <Loader2 className="mx-auto mb-1 h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : parts.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-4 text-center text-[11px] text-muted-foreground">
                No panels recorded.
              </div>
            ) : (
              <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {parts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/40 p-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.label ?? p.slot}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {p.slot} · {p.triangle_count.toLocaleString()} tris ·{" "}
                        {(p.area_m2 * 10000).toFixed(0)} cm²
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      asChild
                      title="Download panel STL"
                    >
                      <a href={p.stl_path} target="_blank" rel="noopener noreferrer">
                        <Download className="h-3 w-3" />
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {kit?.combined_stl_path && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-8 text-xs"
                asChild
              >
                <a href={kit.combined_stl_path} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3 w-3" />
                  Open combined STL
                </a>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KitMesh({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url) as THREE.BufferGeometry;
  const geo = useMemo(() => {
    const g = geometry.clone();
    g.computeVertexNormals();
    return g;
  }, [geometry]);
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshPhysicalMaterial
        color="#0a1622"
        metalness={0.85}
        roughness={0.32}
        clearcoat={1.0}
        clearcoatRoughness={0.18}
      />
    </mesh>
  );
}
