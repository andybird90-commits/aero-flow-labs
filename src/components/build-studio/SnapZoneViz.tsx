/**
 * Snap zone visual — small wireframe disc + label that hovers in 3D space.
 * Click selects the zone (admin mode) or shows label (read-only mode).
 */
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { SnapZone } from "@/lib/build-studio/snap-zones";
import { SNAP_ZONE_LABELS } from "@/lib/build-studio/snap-zones";

interface Props {
  zone: SnapZone;
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
  showLabel?: boolean;
}

export function SnapZoneViz({ zone, active, selected, onClick, showLabel = true }: Props) {
  const color = selected ? "#fb923c" : active ? "#22d3ee" : "#94a3b8";
  return (
    <group
      position={[zone.position.x, zone.position.y, zone.position.z]}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
    >
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.08, 0.12, 24]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 1 : 0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.025, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {showLabel && (
        <Html
          center
          distanceFactor={6}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
          position={[0, 0.18, 0]}
        >
          <div className="rounded-sm border border-border bg-background/80 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-foreground backdrop-blur">
            {zone.label || SNAP_ZONE_LABELS[zone.zone_type]}
          </div>
        </Html>
      )}
    </group>
  );
}
