/**
 * BackdropPicker — toolbar dropdown that swaps the Build Studio's scene
 * environment between built-in HDRI presets ("Workshop", "Sunset", …) and
 * user-uploaded custom panoramas (.hdr / .exr).
 *
 * The selection writes back to `projects.paint_finish` via the parent's
 * `onChange` callback (toggle of `env_preset`, `custom_hdri_url`, and
 * `show_backdrop`). All persistence is handled by the parent's existing
 * debounced save loop — this component is purely presentational + upload.
 *
 * Usage:
 *   <BackdropPicker
 *     projectId={projectId}
 *     finish={paintFinish}
 *     onChange={(patch) => setPaintFinish((p) => ({ ...p, ...patch }))}
 *   />
 */
import { useRef, useState } from "react";
import { Image, Upload, Trash2, Eye, EyeOff, Loader2, Mountain } from "lucide-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  BACKDROP_PRESETS,
  type EnvPreset,
  type PaintFinish,
} from "@/lib/build-studio/paint-finish";
import {
  useDeleteHdri,
  useProjectHdriList,
  useUploadHdri,
} from "@/lib/repo";

interface Props {
  projectId: string | null;
  finish: PaintFinish;
  onChange: (patch: Partial<PaintFinish>) => void;
}

export function BackdropPicker({ projectId, finish, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: customs = [], isLoading: customsLoading } = useProjectHdriList(projectId);
  const upload = useUploadHdri();
  const del = useDeleteHdri();

  const usingCustom = !!finish.custom_hdri_url;
  const activePreset = BACKDROP_PRESETS.find((p) => p.value === finish.env_preset);
  const activeCustom = customs.find((c) => c.url === finish.custom_hdri_url);
  const activeLabel = usingCustom
    ? activeCustom?.name ?? "Custom HDRI"
    : activePreset?.label ?? "Studio";

  const handleFile = async (file: File) => {
    if (!projectId) {
      toast.error("Open a project first to upload a backdrop.");
      return;
    }
    try {
      const result = await upload.mutateAsync({ projectId, file });
      onChange({ custom_hdri_url: result.url, show_backdrop: true });
      toast.success(`Backdrop "${result.name}" uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="studio-pill"
          data-active={open}
          title="Choose scene backdrop"
        >
          <Mountain className="h-3.5 w-3.5" />
          <span className="max-w-[120px] truncate">{activeLabel}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[340px] p-0 border-border bg-popover"
      >
        {/* Header — show backdrop toggle */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Scene backdrop
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Lighting, reflections, and visible background.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {finish.show_backdrop ? (
              <Eye className="h-3.5 w-3.5 text-foreground/60" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Switch
              checked={finish.show_backdrop ?? true}
              onCheckedChange={(v) => onChange({ show_backdrop: v })}
              aria-label="Show backdrop behind car"
            />
          </div>
        </div>

        {/* Custom uploads */}
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Your HDRIs
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".hdr,.exr,image/vnd.radiance,image/x-exr"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending || !projectId}
            >
              {upload.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3 w-3" />
              )}
              Upload
            </Button>
          </div>

          {customsLoading ? (
            <div className="py-3 text-center text-[11px] text-muted-foreground">
              Loading…
            </div>
          ) : customs.length === 0 ? (
            <div className="rounded border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
              No custom HDRIs yet. Upload a <span className="text-foreground">.hdr</span> or{" "}
              <span className="text-foreground">.exr</span> from Poly Haven, HDRI-Skies, or your own shoot.
            </div>
          ) : (
            <div className="grid max-h-[140px] gap-1 overflow-y-auto pr-1">
              {customs.map((c) => {
                const active = finish.custom_hdri_url === c.url;
                return (
                  <div
                    key={c.path}
                    className={`group flex items-center justify-between gap-2 rounded border px-2 py-1.5 transition ${
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-border bg-surface-1 hover:border-border"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex flex-1 items-center gap-2 text-left"
                      onClick={() => {
                        onChange({ custom_hdri_url: c.url, show_backdrop: true });
                        setOpen(false);
                      }}
                    >
                      <Image className="h-3.5 w-3.5 shrink-0 text-foreground/60" />
                      <span className="truncate text-[11px] text-foreground">
                        {c.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                      title="Delete"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          await del.mutateAsync({ projectId: projectId!, path: c.path });
                          if (active) onChange({ custom_hdri_url: null });
                          toast.success("Backdrop deleted");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Delete failed");
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Built-in presets */}
        <div className="px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Built-in
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {BACKDROP_PRESETS.map((p) => {
              const active = !usingCustom && finish.env_preset === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    onChange({
                      env_preset: p.value as EnvPreset,
                      custom_hdri_url: null,
                      show_backdrop: true,
                    });
                    setOpen(false);
                  }}
                  className={`group rounded border px-2.5 py-2 text-left transition ${
                    active
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-surface-1 hover:border-border hover:bg-surface-2"
                  }`}
                  title={p.description}
                >
                  <div className="text-[11px] font-medium text-foreground">{p.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                    {p.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
