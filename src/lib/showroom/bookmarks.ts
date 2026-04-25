/**
 * Camera bookmarks — saved viewpoints for the Showroom.
 *
 * Stored in localStorage scoped to the project so each build can have its own
 * curated angles. Bookmarks capture the camera position and the orbit target
 * (so re-applying restores both framing and pivot).
 */
import { useCallback, useEffect, useState } from "react";

export interface CameraBookmark {
  id: string;
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  /** ms timestamp for ordering. */
  created_at: number;
}

const KEY = (projectId: string) => `apex.showroom.bookmarks.${projectId}`;

function read(projectId: string): CameraBookmark[] {
  try {
    const raw = localStorage.getItem(KEY(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CameraBookmark[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(projectId: string, bookmarks: CameraBookmark[]) {
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify(bookmarks));
  } catch {
    // ignore quota errors
  }
}

export function useCameraBookmarks(projectId: string | undefined | null) {
  const [bookmarks, setBookmarks] = useState<CameraBookmark[]>([]);

  useEffect(() => {
    if (!projectId) {
      setBookmarks([]);
      return;
    }
    setBookmarks(read(projectId));
  }, [projectId]);

  const add = useCallback(
    (b: Omit<CameraBookmark, "id" | "created_at">) => {
      if (!projectId) return null;
      const next: CameraBookmark = {
        ...b,
        id: crypto.randomUUID(),
        created_at: Date.now(),
      };
      const list = [...read(projectId), next];
      write(projectId, list);
      setBookmarks(list);
      return next;
    },
    [projectId],
  );

  const remove = useCallback(
    (id: string) => {
      if (!projectId) return;
      const list = read(projectId).filter((b) => b.id !== id);
      write(projectId, list);
      setBookmarks(list);
    },
    [projectId],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      if (!projectId) return;
      const list = read(projectId).map((b) => (b.id === id ? { ...b, name } : b));
      write(projectId, list);
      setBookmarks(list);
    },
    [projectId],
  );

  return { bookmarks, add, remove, rename };
}
