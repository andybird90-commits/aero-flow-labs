/**
 * PartLasso — overlay canvas for marking the part on a 2D render.
 *
 * Two interaction modes drive the same data structure:
 *   - "click": single click adds a foreground point; shift-click adds a
 *              background point (helps SAM exclude unwanted areas).
 *   - "lasso": drag to draw a freehand polygon; release to finalise.
 *
 * The user's marks are reported back to the parent in *image-pixel* space
 * (not display pixels), so they can be sent straight to the segmentation
 * edge function which works on the real image dimensions.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type LassoMode = "click" | "lasso";
export interface LassoPoint { x: number; y: number }
export interface LassoClick extends LassoPoint { label: 0 | 1 }

interface Props {
  imageUrl: string;
  mode: LassoMode;
  points: LassoClick[];
  lasso: LassoPoint[];
  onChange: (next: { points: LassoClick[]; lasso: LassoPoint[] }) => void;
  className?: string;
}

export function PartLasso({ imageUrl, mode, points, lasso, onChange, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Natural (image-space) → display-space mapping. We draw in display space
  // but store everything in image space for the edge function.
  const [scale, setScale] = useState({ sx: 1, sy: 1, w: 0, h: 0 });
  const [drawing, setDrawing] = useState(false);
  const draftLasso = useRef<LassoPoint[]>([]);

  // Load image natural size + observe the wrapping element so we recompute
  // scale on resize / dialog open.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      recompute();
    };
    img.src = imageUrl;

    const ro = new ResizeObserver(() => recompute());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  const recompute = () => {
    const img = imgRef.current, wrap = wrapRef.current;
    if (!img || !wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const ar = img.naturalWidth / img.naturalHeight;
    let dw = W, dh = W / ar;
    if (dh > H) { dh = H; dw = H * ar; }
    setScale({
      sx: img.naturalWidth / dw,
      sy: img.naturalHeight / dh,
      w: dw, h: dh,
    });
  };

  // Repaint marks whenever inputs or scale change.
  useEffect(() => { paint(); /* eslint-disable-next-line */ }, [points, lasso, scale, mode, drawing]);

  const paint = () => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    c.width = Math.max(1, Math.round(scale.w * dpr));
    c.height = Math.max(1, Math.round(scale.h * dpr));
    c.style.width = `${scale.w}px`;
    c.style.height = `${scale.h}px`;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, scale.w, scale.h);

    // Lasso (committed)
    if (lasso.length >= 2) drawPoly(ctx, lasso.map(p => imgToDisp(p)), "hsl(140 80% 55%)", true);
    // Lasso (draft, while dragging)
    if (drawing && draftLasso.current.length >= 2) {
      drawPoly(ctx, draftLasso.current, "hsl(140 80% 55%)", false);
    }
    // Click points
    for (const p of points) {
      const d = imgToDisp(p);
      ctx.beginPath();
      ctx.arc(d.x, d.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.label === 1 ? "hsl(140 80% 55%)" : "hsl(0 80% 60%)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "white";
      ctx.stroke();
    }
  };

  const drawPoly = (
    ctx: CanvasRenderingContext2D,
    pts: LassoPoint[],
    color: string,
    closed: boolean,
  ) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (closed) ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (closed) {
      ctx.fillStyle = color.replace(")", " / 0.18)").replace("hsl(", "hsla(");
      ctx.fill();
    }
  };

  const imgToDisp = (p: LassoPoint): LassoPoint => ({ x: p.x / scale.sx, y: p.y / scale.sy });
  const dispToImg = (x: number, y: number): LassoPoint => ({ x: x * scale.sx, y: y * scale.sy });

  const localXY = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // CLICK MODE
  const onCanvasClick = (e: React.MouseEvent) => {
    if (mode !== "click") return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    if (dx < 0 || dy < 0 || dx > scale.w || dy > scale.h) return;
    const p = dispToImg(dx, dy);
    onChange({
      points: [...points, { ...p, label: e.shiftKey ? 0 : 1 }],
      lasso,
    });
  };

  // LASSO MODE
  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "lasso") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = localXY(e);
    draftLasso.current = [{ x, y }];
    setDrawing(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== "lasso" || !drawing) return;
    const { x, y } = localXY(e);
    const last = draftLasso.current[draftLasso.current.length - 1];
    // Sample at ~3px to keep the polygon manageable.
    if (!last || Math.hypot(x - last.x, y - last.y) > 3) {
      draftLasso.current = [...draftLasso.current, { x, y }];
      paint();
    }
  };
  const onPointerUp = () => {
    if (mode !== "lasso" || !drawing) return;
    setDrawing(false);
    if (draftLasso.current.length >= 3) {
      onChange({
        points,
        lasso: draftLasso.current.map(p => dispToImg(p.x, p.y)),
      });
    }
    draftLasso.current = [];
  };

  return (
    <div ref={wrapRef} className={cn("relative w-full h-full flex items-center justify-center", className)}>
      <img
        src={imageUrl}
        alt="part render"
        className="select-none pointer-events-none"
        style={{ width: scale.w, height: scale.h }}
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute touch-none",
          mode === "click" ? "cursor-crosshair" : "cursor-cell",
        )}
        style={{ width: scale.w, height: scale.h }}
        onClick={onCanvasClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
