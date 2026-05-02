/**
 * Library card preview that mounts a live, interactive 3D mesh viewer when the
 * tile scrolls into view and unmounts when it leaves. Falls back to the static
 * thumbnail (if any) before the viewer mounts so the grid never flashes empty.
 *
 * Why lazy-mount: each viewer creates a WebGL context, and browsers cap those
 * around ~16. Lazy mounting keeps the page responsive even with 40+ cards.
 */
import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { PartMeshViewer } from "@/components/PartMeshViewer";

interface Props {
  meshUrl?: string | null;
  meshMime?: string | null;
  thumbnailUrl?: string | null;
  alt: string;
}

export function LiveMeshTile({ meshUrl, meshMime, thumbnailUrl, alt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  const url = (meshUrl ?? "").toLowerCase().split("?")[0];
  const mime = (meshMime ?? "").toLowerCase();
  const isMesh =
    !!meshUrl &&
    (mime.includes("gltf") || mime.includes("glb") || mime.includes("stl") ||
      url.endsWith(".glb") || url.endsWith(".gltf") || url.endsWith(".stl"));

  useEffect(() => {
    const el = ref.current;
    if (!el || !isMesh) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isMesh]);

  return (
    <div ref={ref} className="absolute inset-0">
      {isMesh && inView ? (
        <PartMeshViewer url={meshUrl!} className="absolute inset-0 h-full w-full" />
      ) : thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : isMesh ? (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin opacity-60" />
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <ImageOff className="h-6 w-6" />
        </div>
      )}
    </div>
  );
}
