/**
 * PrototypeMaskEditor
 *
 * Full-screen canvas overlay that lets the user paint a binary mask on top of
 * a source photo, marking exactly which pixels are the aftermarket part vs
 * the host car body. The output PNG is stored alongside the prototype and
 * used by `build-prototype-reference-from-mask` to produce a clean isolated
 * reference from real pixels (instead of asking an image model to guess).
 *
 * Tools:
 *  - Brush: paint with adjustable radius. Right-click / Eraser mode wipes.
 *  - Polygon lasso: click to add vertices, double-click to close + fill.
 *
 * Output: PNG data URL where alpha=255 marks "part" pixels and alpha=0 marks
 * "not part" pixels, sized to match the source image's natural dimensions.
 */
import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, Brush, Hexagon, Eraser, Undo2, Save, RotateCcw, MousePointer2 } from "lucide-react";

type Tool = "brush" | "eraser" | "polygon";

interface Props {
  open: boolean;
  imageUrl: string | null;
  onClose: () => void;
  onSave: (maskPngDataUrl: string, sourceUrl: string) => Promise<void> | void;
  saving?: boolean;
}

export default function PrototypeMaskEditor({ open, imageUrl, onClose, onSave, saving }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(40); // in source-pixel units
  const [polygonPoints, setPolygonPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [history, setHistory] = useState<string[]>([]);
  const isPainting = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Reset on open / new image
  useEffect(() => {
    if (!open) return;
    setPolygonPoints([]);
    setHistory([]);
    setTool("brush");
  }, [open, imageUrl]);

  // When the underlying image loads, size the mask canvas to the source dims.
  const onImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    const mask = maskCanvasRef.current;
    if (mask) {
      mask.width = img.naturalWidth;
      mask.height = img.naturalHeight;
      const ctx = mask.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, mask.width, mask.height);
      }
    }
    requestAnimationFrame(measureDisplay);
  };

  const measureDisplay = () => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setDisplaySize({ w: rect.width, h: rect.height });
    const ov = overlayCanvasRef.current;
    if (ov) {
      ov.width = Math.round(rect.width * window.devicePixelRatio);
      ov.height = Math.round(rect.height * window.devicePixelRatio);
      ov.style.width = `${rect.width}px`;
      ov.style.height = `${rect.height}px`;
      const ctx = ov.getContext("2d");
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    redrawOverlay();
  };

  // Re-measure on window resize.
  useEffect(() => {
    if (!open) return;
    const onResize = () => measureDisplay();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // Map a mouse event to source-image coordinates.
  const eventToSourceCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img || !imgSize) return null;
    const rect = img.getBoundingClientRect();
    const xCss = clientX - rect.left;
    const yCss = clientY - rect.top;
    if (xCss < 0 || yCss < 0 || xCss > rect.width || yCss > rect.height) return null;
    const sx = (xCss / rect.width) * imgSize.w;
    const sy = (yCss / rect.height) * imgSize.h;
    return { x: sx, y: sy };
  };

  const pushHistory = () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    try {
      const snap = mask.toDataURL("image/png");
      setHistory((h) => [...h.slice(-19), snap]);
    } catch (e) {
      // ignore
    }
  };

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const next = h.slice(0, -1);
      const snap = h[h.length - 1];
      const mask = maskCanvasRef.current;
      const ctx = mask?.getContext("2d");
      if (!mask || !ctx) return next;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, mask.width, mask.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = snap;
      return next;
    });
  };

  const clearMask = () => {
    pushHistory();
    const mask = maskCanvasRef.current;
    const ctx = mask?.getContext("2d");
    if (mask && ctx) ctx.clearRect(0, 0, mask.width, mask.height);
    setPolygonPoints([]);
    redrawOverlay();
  };

  const paintLine = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(0,255,0,1)";
      ctx.fillStyle = "rgba(0,255,0,1)";
    }
    ctx.beginPath();
    if (from) ctx.moveTo(from.x, from.y);
    else ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    // Also drop a dot so single clicks register.
    ctx.beginPath();
    ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const p = eventToSourceCoords(e.clientX, e.clientY);
    if (!p) return;
    if (tool === "polygon") {
      // Add a vertex; double-click closes.
      setPolygonPoints((pts) => [...pts, p]);
      return;
    }
    pushHistory();
    isPainting.current = true;
    lastPos.current = null;
    paintLine(null, p);
    lastPos.current = p;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (tool === "polygon") {
      // Live-render the in-progress polygon edge to the cursor.
      const p = eventToSourceCoords(e.clientX, e.clientY);
      if (p) redrawOverlay(p);
      return;
    }
    if (!isPainting.current) return;
    const p = eventToSourceCoords(e.clientX, e.clientY);
    if (!p) return;
    paintLine(lastPos.current, p);
    lastPos.current = p;
  };

  const onPointerUp = () => {
    isPainting.current = false;
    lastPos.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== "polygon") return;
    e.preventDefault();
    if (polygonPoints.length < 3) {
      setPolygonPoints([]);
      return;
    }
    const mask = maskCanvasRef.current;
    if (!mask) return;
    const ctx = mask.getContext("2d");
    if (!ctx) return;
    pushHistory();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(0,255,0,1)";
    ctx.beginPath();
    polygonPoints.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();
    setPolygonPoints([]);
    redrawOverlay();
  };

  // Visual overlay (semi-transparent mask preview + polygon-in-progress).
  const redrawOverlay = (cursor?: { x: number; y: number }) => {
    const ov = overlayCanvasRef.current;
    const img = imgRef.current;
    const mask = maskCanvasRef.current;
    if (!ov || !img || !mask || !imgSize) return;
    const ctx = ov.getContext("2d");
    if (!ctx) return;
    const rect = img.getBoundingClientRect();
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    // Tinted mask preview
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(mask, 0, 0, rect.width, rect.height);
    ctx.restore();
    // Polygon-in-progress
    if (tool === "polygon" && polygonPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#22c55e";
      ctx.fillStyle = "rgba(34,197,94,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      polygonPoints.forEach((pt, i) => {
        const x = (pt.x / imgSize.w) * rect.width;
        const y = (pt.y / imgSize.h) * rect.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (cursor) {
        const cx = (cursor.x / imgSize.w) * rect.width;
        const cy = (cursor.y / imgSize.h) * rect.height;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.fill();
      // Vertex dots
      polygonPoints.forEach((pt) => {
        const x = (pt.x / imgSize.w) * rect.width;
        const y = (pt.y / imgSize.h) * rect.height;
        ctx.fillStyle = "#22c55e";
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  };

  // Re-render overlay any time the polygon list or tool changes.
  useEffect(() => { redrawOverlay(); }, [polygonPoints, tool]);

  // Periodically refresh overlay while painting so the tinted preview tracks.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const loop = () => { redrawOverlay(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const save = async () => {
    const mask = maskCanvasRef.current;
    if (!mask || !imageUrl) return;
    // Convert green-on-transparent into pure-alpha mask: keep alpha channel only.
    const tmp = document.createElement("canvas");
    tmp.width = mask.width; tmp.height = mask.height;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.drawImage(mask, 0, 0);
    // Replace RGB with white wherever alpha > 0; this gives a clean white-on-transparent PNG.
    const data = tctx.getImageData(0, 0, tmp.width, tmp.height);
    let painted = 0;
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i + 3] > 8) {
        data.data[i] = 255;
        data.data[i + 1] = 255;
        data.data[i + 2] = 255;
        data.data[i + 3] = 255;
        painted++;
      } else {
        data.data[i + 3] = 0;
      }
    }
    if (painted < 50) {
      alert("Paint or lasso the part first.");
      return;
    }
    tctx.putImageData(data, 0, 0);
    const dataUrl = tmp.toDataURL("image/png");
    await onSave(dataUrl, imageUrl);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1600px,95vw)] w-[95vw] h-[92vh] max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MousePointer2 className="h-4 w-4 text-fuchsia-400" /> Mark the part
          </DialogTitle>
          <DialogDescription>
            Paint over <span className="text-foreground font-medium">only the aftermarket part itself</span>. Skip the bumper, grille, hands and
            anything that belongs to the car. The cleaner the mask, the cleaner the resulting reference, fit and 3D mesh.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
          <Button size="sm" variant={tool === "brush" ? "default" : "outline"} onClick={() => setTool("brush")}>
            <Brush className="h-3.5 w-3.5 mr-1" /> Brush
          </Button>
          <Button size="sm" variant={tool === "polygon" ? "default" : "outline"} onClick={() => { setTool("polygon"); setPolygonPoints([]); }}>
            <Hexagon className="h-3.5 w-3.5 mr-1" /> Lasso
          </Button>
          <Button size="sm" variant={tool === "eraser" ? "default" : "outline"} onClick={() => setTool("eraser")}>
            <Eraser className="h-3.5 w-3.5 mr-1" /> Eraser
          </Button>
          <div className="flex items-center gap-2 ml-3 min-w-[180px]">
            <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">Size</span>
            <Slider value={[brushSize]} min={5} max={300} step={1} onValueChange={(v) => setBrushSize(v[0])} className="w-32" />
            <span className="text-[11px] tabular-nums w-8">{brushSize}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={undo} disabled={!history.length}>
              <Undo2 className="h-3.5 w-3.5 mr-1" /> Undo
            </Button>
            <Button size="sm" variant="outline" onClick={clearMask}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
          {tool === "polygon" && (
            <div className="basis-full text-[11px] text-muted-foreground">
              Click to add vertices · double-click to close and fill the lasso.
            </div>
          )}
        </div>

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden grid place-items-center bg-surface-0 rounded-md border border-border">
          {imageUrl && (
            <div className="relative max-w-full max-h-full" style={{ touchAction: "none" }}>
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Source"
                onLoad={onImageLoad}
                className="block max-w-full select-none"
                style={{ maxHeight: "calc(92vh - 240px)", userSelect: "none", pointerEvents: "none" }}
                draggable={false}
              />
              {/* Hidden full-resolution mask canvas */}
              <canvas ref={maskCanvasRef} className="hidden" />
              {/* Visible overlay that captures pointer events */}
              <canvas
                ref={overlayCanvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                onDoubleClick={onDoubleClick}
                className="absolute inset-0 cursor-crosshair"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="hero" onClick={save} disabled={saving || !imageUrl}>
            {saving ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Building reference…</> : <><Save className="h-4 w-4 mr-1" /> Use this mask</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
