/**
 * Screen-space markup overlay — transparent <canvas> stretched over the
 * R3F viewport. Records 2D strokes pinned to the camera pose at draw time
 * and fades them when the user orbits significantly away.
 *
 * Drawing semantics:
 *  - Single layer at a time (the active one). When mode flips to "screen"
 *    with no active screen layer, we auto-create one and pin the current
 *    camera pose.
 *  - Points stored as normalised viewport coords [0,1] for resolution
 *    independence on replay.
 *
 * Camera orientation tracking lives in <CameraPoseProbe/> which sits
 * inside the R3F Canvas and pushes the live pose into a shared ref.
 */
import { useEffect, useRef, useCallback } from "react";
import { useAnnotationStore, type ScreenStroke, type CameraPose } from "@/lib/build-studio/annotate/store";

interface Props {
  /** Live camera pose from inside the R3F Canvas (continuously updated). */
  livePoseRef: React.MutableRefObject<CameraPose | null>;
  /** Called when the active layer changes — parent persists if needed. */
  onLayerCommit?: (layerId: string) => void;
}

const POSE_FADE_THRESHOLD = 0.35;   // cosine; below = fade
const POSE_HIDE_THRESHOLD = 0.0;    // cosine; below = hide

function dirVec(p: CameraPose): [number, number, number] {
  const dx = p.target.x - p.position.x;
  const dy = p.target.y - p.position.y;
  const dz = p.target.z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

function cosBetween(a: CameraPose, b: CameraPose) {
  const da = dirVec(a);
  const db = dirVec(b);
  return da[0] * db[0] + da[1] * db[1] + da[2] * db[2];
}

export function ScreenAnnotationOverlay({ livePoseRef, onLayerCommit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef<ScreenStroke | null>(null);
  const rafRef = useRef<number | null>(null);

  const mode = useAnnotationStore((s) => s.mode);
  const tool = useAnnotationStore((s) => s.tool);
  const color = useAnnotationStore((s) => s.color);
  const width = useAnnotationStore((s) => s.width);
  const layers = useAnnotationStore((s) => s.layers);
  const activeLayerId = useAnnotationStore((s) => s.activeLayerId);
  const addLayer = useAnnotationStore((s) => s.addLayer);
  const setActiveLayer = useAnnotationStore((s) => s.setActiveLayer);
  const appendStroke = useAnnotationStore((s) => s.appendStroke);

  const enabled = mode === "screen";

  // Resize canvas to match wrapper.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      requestRedraw();
    });
    ro.observe(wrapper);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redraw();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, activeLayerId]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const livePose = livePoseRef.current;

    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.kind !== "screen") continue;

      // Compute opacity based on how far we've orbited from the captured pose.
      let alpha = 1;
      if (layer.cameraPose && livePose && layer.id !== activeLayerId) {
        const c = cosBetween(layer.cameraPose, livePose);
        if (c <= POSE_HIDE_THRESHOLD) continue;
        if (c < POSE_FADE_THRESHOLD) {
          alpha = (c - POSE_HIDE_THRESHOLD) / (POSE_FADE_THRESHOLD - POSE_HIDE_THRESHOLD);
        }
      }
      ctx.globalAlpha = alpha;

      for (const stroke of layer.strokes) {
        if (stroke.kind !== "screen") continue;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width * dpr;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        for (let i = 0; i < stroke.points.length; i++) {
          const [nx, ny] = stroke.points[i];
          const x = nx * canvas.width;
          const y = ny * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }, [layers, activeLayerId, livePoseRef]);

  // Redraw on layer changes.
  useEffect(() => {
    requestRedraw();
  }, [layers, activeLayerId, requestRedraw]);

  // Continuously poll the live pose so out-of-pose layers fade smoothly while
  // the user orbits. Cheap (just reads a ref + redraws a 2D canvas).
  useEffect(() => {
    if (!enabled && layers.every((l) => l.kind !== "screen")) return;
    let id: number;
    const tick = () => {
      requestRedraw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [enabled, layers, requestRedraw]);

  // ── Pointer handlers ──────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    // Ensure we have an active screen layer with a captured pose.
    let layerId = activeLayerId;
    const activeLayer = layers.find((l) => l.id === layerId);
    if (!activeLayer || activeLayer.kind !== "screen") {
      layerId = addLayer("screen", livePoseRef.current ? { ...livePoseRef.current } : null);
    } else if (!activeLayer.cameraPose && livePoseRef.current) {
      // Should already be set, but guard against missing pose.
      activeLayer.cameraPose = { ...livePoseRef.current };
    }
    setActiveLayer(layerId);

    const rect = wrapper.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    drawingRef.current = true;
    currentStrokeRef.current = {
      id: `s-${Date.now()}`,
      kind: "screen",
      color,
      width,
      points: [[nx, ny]],
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current || !currentStrokeRef.current) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const pts = currentStrokeRef.current.points;
    const last = pts[pts.length - 1];
    // Decimate near-duplicates for performance.
    if (Math.hypot(nx - last[0], ny - last[1]) < 0.001) return;
    pts.push([nx, ny]);

    // Live preview: draw the partial stroke directly onto the canvas.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last[0] * canvas.width, last[1] * canvas.height);
    ctx.lineTo(nx * canvas.width, ny * canvas.height);
    ctx.stroke();
  };

  const finishStroke = (layerId: string | null) => {
    if (!drawingRef.current || !currentStrokeRef.current || !layerId) {
      drawingRef.current = false;
      currentStrokeRef.current = null;
      return;
    }
    const stroke = currentStrokeRef.current;
    drawingRef.current = false;
    currentStrokeRef.current = null;
    if (stroke.points.length < 2) return;
    appendStroke(layerId, stroke);
    onLayerCommit?.(layerId);
  };

  const onPointerUp = () => finishStroke(activeLayerId);
  const onPointerLeave = () => finishStroke(activeLayerId);

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 z-20"
      style={{
        pointerEvents: enabled ? "auto" : "none",
        cursor: enabled ? (tool === "eraser" ? "cell" : "crosshair") : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {enabled && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border px-3 py-1 text-mono text-[10px] uppercase tracking-widest"
          style={{
            background: "hsl(var(--studio-bg-1) / 0.85)",
            color: "hsl(var(--studio-accent-glow))",
            borderColor: "hsl(var(--studio-accent) / 0.5)",
            backdropFilter: "blur(8px)",
          }}
        >
          ✎ Sketching · Markup mode
        </div>
      )}
    </div>
  );
}
