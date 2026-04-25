/**
 * Project thumbnail uploader — captures the canonical 3/4 view and stores
 * it in the public `project-thumbnails` bucket so it can be referenced
 * without a signed URL (lists, share previews, OG cards).
 */
import { supabase } from "@/integrations/supabase/client";

export const THUMBNAIL_BUCKET = "project-thumbnails";

/** Upload a PNG/JPEG blob and update the project's thumbnail_url. Returns the public URL. */
export async function saveProjectThumbnail(
  userId: string,
  projectId: string,
  blob: Blob,
): Promise<string> {
  const ext = blob.type.includes("jpeg") ? "jpg" : "png";
  const path = `${userId}/${projectId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(THUMBNAIL_BUCKET)
    .upload(path, blob, {
      cacheControl: "300",
      upsert: true,
      contentType: blob.type || "image/png",
    });
  if (upErr) throw upErr;

  // Public URL (bucket is public).
  const { data: pub } = supabase.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);
  // Append cache-buster so list views see the new image.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: updErr } = await supabase
    .from("projects")
    .update({ thumbnail_url: url })
    .eq("id", projectId);
  if (updErr) throw updErr;

  return url;
}

/** Render a single hi-quality frame from a WebGL canvas as JPEG (smaller than PNG for thumbs). */
export async function canvasToThumbBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      quality,
    );
  });
}
