/**
 * Hardpoint visual marker — colored crosshair + label that hovers in 3D.
 * Used both in the admin picker and in Build Studio's Shell Fit overlay.
 */
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Vec3 } from "@/lib/build-studio/placed-parts";

interface Props {
  position: Vec3;
  label?: string | null;
  /** "car" = teal, "shell" = orange, "paired" = green. */
  variant?: "car" | "shell" | "paired";
  selected?: boolean;
  onClick?: () => void;
  showLabel?: boolean;
  /** Render the marker on top of all geometry (for hardpoints buried in mesh). */
  alwaysOnTop?: boolean;
}

const COLORS = {
  car: "#22d3ee",
  shell: "#fb923c",
  paired: "#4ade80",
};

export function HardpointViz({
  position,
  label,
  variant = "car",
  selected,
  onClick,
  showLabel = true,
  alwaysOnTop = true,
}: Props) {
  const color = COLORS[variant];
  return (
    <group
      position={[position.x, position.y, position.z]}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
      renderOrder={alwaysOnTop ? 999 : 0}
    >
      {/* Inner sphere */}
      <mesh>
        <sphereGeometry args={[selected ? 0.05 : 0.035, 16, 16]} />
        <meshBasicMaterial color={color} depthTest={!alwaysOnTop} />
      </mesh>
      {/* Outer ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[selected ? 0.09 : 0.07, selected ? 0.11 : 0.085, 24]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 1 : 0.6} side={THREE.DoubleSide} depthTest={!alwaysOnTop} />
      </mesh>
      {/* Crosshair lines */}
      <mesh>
        <boxGeometry args={[0.18, 0.004, 0.004]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} depthTest={!alwaysOnTop} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.004, 0.18, 0.004]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} depthTest={!alwaysOnTop} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.004, 0.004, 0.18]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} depthTest={!alwaysOnTop} />
      </mesh>
      {showLabel && label && (
        <Html
          center
          distanceFactor={6}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
          position={[0, 0.18, 0]}
        >
          <div
            className="rounded-sm border border-border bg-background/85 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-foreground backdrop-blur whitespace-nowrap"
            style={{ borderColor: color, color }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
