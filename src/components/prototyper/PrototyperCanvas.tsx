/**
 * Centre canvas for the Prototyper. Shows the active car/concept image and
 * dispatches mode-specific overlays (click-to-segment, drag-to-place).
 */
import { useEffect, useRef, useState } from "react";
import type { PrototyperMode } from "./ModeSwitcher";
import type { PlacementInstance } from "@/lib/prototyper/transforms";
import type { FrozenPart } from "@/lib/prototyper/frozen-parts";
import { Loader2 } from "lucide-react";

interface Props {
  imageUrl: string | null;
  mode: PrototyperMode;
  loading?: boolean;
  // Freeze mode
  proposedSilhouetteUrl?: string | null;
  onCanvasClick?: (norm: { x: number; y: number }) => void;
  // Place mode
  placements?: PlacementInstance[];
  partsById?: Map<string, FrozenPart>;
  selectedInstanceId?: string | null;
  onSelectInstance?: (id: string | null) => void;
  onUpdateInstance?: (id: string, patch: Partial<PlacementInstance["transform"]>) => void;
}

export function PrototyperCanvas({
  imageUrl,
  mode,
  loading,
  proposedSilhouetteUrl,
  onCanvasClick,
  placements = [],
  partsById,
  selectedInstanceId,
  onSelectInstance,
  onUpdateInstance,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el || !onUpdateInstance) return;
      const rect = el.getBoundingClientRect();
      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      onUpdateInstance(drag.id, {
        x: Math.max(0, Math.min(1, drag.origX + dx)),
        y: Math.max(0, Math.min(1, drag.origY + dy)),
      });
    };
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, onUpdateInstance]);

  const handleClick = (e: React.MouseEvent) => {
    if (mode !== "freeze" || !onCanvasClick) return;
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onCanvasClick({ x, y });
  };

  return (
    <div className="relative w-full h-full bg-surface-2 rounded-lg overflow-hidden border border-border">
      {!imageUrl ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Pick a car view to start.
        </div>
      ) : (
        <div
          ref={wrapRef}
          className="relative w-full h-full"
          onClick={handleClick}
          style={{ cursor: mode === "freeze" ? "crosshair" : "default" }}
        >
          <img
            src={imageUrl}
            alt="Active view"
            className="w-full h-full object-contain pointer-events-none select-none"
            draggable={false}
          />

          {/* Freeze mode: proposed silhouette overlay */}
          {mode === "freeze" && proposedSilhouetteUrl && (
            <img
              src={proposedSilhouetteUrl}
              alt="Proposed mask"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none mix-blend-screen opacity-90"
            />
          )}

          {/* Place mode: render placement instances */}
          {mode === "place" && placements.map((inst) => {
            const part = partsById?.get(inst.frozen_part_id);
            if (!part?.silhouette_url) return null;
            const t = inst.transform;
            const selected = inst.instance_id === selectedInstanceId;
            return (
              <div
                key={inst.instance_id}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onSelectInstance?.(inst.instance_id);
                  if (inst.locked) return;
                  setDrag({
                    id: inst.instance_id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: t.x,
                    origY: t.y,
                  });
                }}
                className={`absolute pointer-events-auto ${selected ? "outline outline-2 outline-primary" : ""}`}
                style={{
                  left: `${t.x * 100}%`,
                  top: `${t.y * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${t.rotation}rad) scale(${t.scale}) ${t.mirror ? "scaleX(-1)" : ""}`,
                  cursor: inst.locked ? "not-allowed" : "move",
                  width: "30%",
                }}
              >
                <img
                  src={part.silhouette_url}
                  alt={part.name}
                  className="w-full pointer-events-none select-none"
                  draggable={false}
                />
              </div>
            );
          })}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
