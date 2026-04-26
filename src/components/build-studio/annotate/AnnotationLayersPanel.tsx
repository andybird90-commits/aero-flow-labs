/**
 * Annotation layers panel — small floating card listing the markup/surface
 * layers, with visibility, rename, and delete controls.
 *
 * Sits inside the right rail above the Properties panel content.
 */
import { Eye, EyeOff, Trash2, Layers as LayersIcon, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnotationStore } from "@/lib/build-studio/annotate/store";
import {
  useSaveAnnotationLayer,
  useDeleteAnnotationLayer,
} from "@/lib/build-studio/annotate/hooks";
import { toast } from "sonner";

interface Props {
  projectId: string | null | undefined;
  userId: string | null | undefined;
}

export function AnnotationLayersPanel({ projectId, userId }: Props) {
  const layers = useAnnotationStore((s) => s.layers);
  const activeLayerId = useAnnotationStore((s) => s.activeLayerId);
  const setActiveLayer = useAnnotationStore((s) => s.setActiveLayer);
  const toggleVisible = useAnnotationStore((s) => s.toggleLayerVisible);
  const removeLayer = useAnnotationStore((s) => s.removeLayer);
  const renameLayer = useAnnotationStore((s) => s.renameLayer);

  const save = useSaveAnnotationLayer();
  const del = useDeleteAnnotationLayer();

  if (layers.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed p-3 text-center text-[11px]"
        style={{
          borderColor: "hsl(var(--studio-stroke))",
          color: "hsl(var(--muted-foreground))",
        }}
      >
        No annotations yet. Pick <span className="text-foreground">Markup</span> or
        <span className="text-foreground"> Surface</span> in the toolbar and start sketching.
      </div>
    );
  }

  const handleSave = async (layerId: string) => {
    if (!projectId || !userId) {
      toast.error("Open a project first");
      return;
    }
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    await save.mutateAsync({ userId, projectId, layer });
    toast.success(`Saved “${layer.label}”`);
  };

  const handleDelete = async (layerId: string) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    if (layer.persistedId && projectId) {
      await del.mutateAsync({ id: layer.persistedId, projectId });
    }
    removeLayer(layerId);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1 text-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <LayersIcon className="h-3 w-3" /> Annotations · {layers.length}
      </div>
      {layers.map((layer) => {
        const isActive = layer.id === activeLayerId;
        return (
          <div
            key={layer.id}
            onClick={() => setActiveLayer(layer.id)}
            className="group flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition"
            style={{
              background: isActive
                ? "hsl(var(--studio-accent) / 0.08)"
                : "hsl(var(--studio-bg-2))",
              borderColor: isActive
                ? "hsl(var(--studio-accent) / 0.4)"
                : "hsl(var(--studio-stroke))",
            }}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: layer.color }}
            />
            <input
              value={layer.label}
              onChange={(e) => renameLayer(layer.id, e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none focus:text-foreground"
            />
            <span className="text-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
              {layer.kind === "screen" ? "2D" : "3D"}·{layer.strokes.length}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleVisible(layer.id);
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title={layer.visible ? "Hide" : "Show"}
            >
              {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSave(layer.id);
              }}
              className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
              title={layer.persistedId ? "Update" : "Save"}
            >
              <Save className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(layer.id);
              }}
              className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
