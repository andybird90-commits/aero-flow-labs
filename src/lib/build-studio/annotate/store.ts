/**
 * Annotation store — in-memory state for the active drawing session.
 *
 * Two stroke kinds:
 *  - "screen": 2D paths in normalised viewport coords [0,1] × [0,1], pinned
 *    to a camera pose. Rendered by the HTML canvas overlay; faded when the
 *    user orbits away from the saved pose.
 *  - "surface": 3D polylines in world coordinates, raycast onto the car.
 *    Rendered inside the R3F scene as offset tube geometry so they stick
 *    to the body without z-fighting.
 *
 * Persistence is opt-in via `useSyncAnnotations(projectId)` (see hooks).
 * The store itself is synchronous — drawing must feel instant.
 */
import { create } from "zustand";

export type Vec3 = { x: number; y: number; z: number };

export interface ScreenStroke {
  id: string;
  kind: "screen";
  color: string;
  width: number;             // px at the captured viewport size
  /** Normalised points [0,1] × [0,1], origin top-left. */
  points: Array<[number, number]>;
}

export interface SurfaceStroke {
  id: string;
  kind: "surface";
  color: string;
  width: number;             // metres (tube radius ≈ width/2)
  points: Vec3[];            // world-space polyline
}

export type Stroke = ScreenStroke | SurfaceStroke;

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Captured aspect at draw time (for screen strokes). */
  aspect: number;
}

export interface AnnotationLayer {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  kind: "screen" | "surface";
  /** Camera pose captured the moment the first stroke was drawn (screen only). */
  cameraPose: CameraPose | null;
  strokes: Stroke[];
  /** Persisted to DB? (false = local draft) */
  persistedId?: string;
}

export type AnnotationMode = "off" | "screen" | "surface";
export type AnnotationTool = "pen" | "eraser";

interface AnnotationState {
  mode: AnnotationMode;
  tool: AnnotationTool;
  color: string;
  width: number;
  layers: AnnotationLayer[];
  activeLayerId: string | null;

  setMode: (m: AnnotationMode) => void;
  setTool: (t: AnnotationTool) => void;
  setColor: (c: string) => void;
  setWidth: (w: number) => void;

  addLayer: (kind: "screen" | "surface", pose?: CameraPose | null) => string;
  setActiveLayer: (id: string | null) => void;
  toggleLayerVisible: (id: string) => void;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, label: string) => void;

  appendStroke: (layerId: string, stroke: Stroke) => void;
  clearAll: () => void;

  /** Replace the layer set wholesale (used when hydrating from DB). */
  hydrate: (layers: AnnotationLayer[]) => void;
}

let layerCounter = 0;

export const useAnnotationStore = create<AnnotationState>((set) => ({
  mode: "off",
  tool: "pen",
  color: "#fb923c",
  width: 3,
  layers: [],
  activeLayerId: null,

  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setWidth: (width) => set({ width }),

  addLayer: (kind, pose = null) => {
    const id = `layer-${Date.now()}-${++layerCounter}`;
    set((s) => ({
      layers: [
        ...s.layers,
        {
          id,
          label: kind === "screen" ? `Markup ${s.layers.length + 1}` : `Surface ${s.layers.length + 1}`,
          color: s.color,
          visible: true,
          kind,
          cameraPose: pose,
          strokes: [],
        },
      ],
      activeLayerId: id,
    }));
    return id;
  },

  setActiveLayer: (activeLayerId) => set({ activeLayerId }),

  toggleLayerVisible: (id) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),

  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      activeLayerId: s.activeLayerId === id ? null : s.activeLayerId,
    })),

  renameLayer: (id, label) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, label } : l)),
    })),

  appendStroke: (layerId, stroke) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, strokes: [...l.strokes, stroke] } : l,
      ),
    })),

  clearAll: () => set({ layers: [], activeLayerId: null }),

  hydrate: (layers) => set({ layers, activeLayerId: layers[0]?.id ?? null }),
}));
