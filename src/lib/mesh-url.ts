/**
 * Resolve an `stl_path` from the `geometries` bucket into a signed URL,
 * with a small in-memory cache so re-renders don't re-sign on every frame.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, { url: string; exp: number }>();
const TTL_S = 55 * 60; // 55 min

export function useSignedMeshUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = cache.get(path);
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.exp > now + 60) {
      setUrl(cached.url);
      return;
    }
    (async () => {
      const { data, error } = await supabase.storage
        .from("geometries")
        .createSignedUrl(path, TTL_S);
      if (cancelled) return;
      if (error || !data) {
        setError(error?.message ?? "Failed to sign URL");
        setUrl(null);
        return;
      }
      cache.set(path, { url: data.signedUrl, exp: now + TTL_S });
      setUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return { url, error };
}

export function meshExtension(path: string | null | undefined): "stl" | "obj" | null {
  if (!path) return null;
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "stl" || ext === "obj") return ext;
  return null;
}
