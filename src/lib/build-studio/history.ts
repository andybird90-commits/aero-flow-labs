/**
 * In-memory undo/redo stack for Build Studio operations.
 *
 * Each entry is a fully-formed inverse pair (`undo` / `redo`) that calls back
 * into the existing repo mutations. We keep this client-only so it survives
 * across reorders without needing a server-side audit trail.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface HistoryEntry {
  /** Short human label (used for toasts, e.g. "Move part"). */
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

const MAX_HISTORY = 50;

export function useHistory() {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [, force] = useState(0);
  const tick = useCallback(() => force((n) => n + 1), []);

  const push = useCallback(
    (entry: HistoryEntry) => {
      undoStack.current.push(entry);
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
      redoStack.current = [];
      tick();
    },
    [tick],
  );

  const undo = useCallback(async () => {
    const entry = undoStack.current.pop();
    if (!entry) return null;
    await entry.undo();
    redoStack.current.push(entry);
    tick();
    return entry;
  }, [tick]);

  const redo = useCallback(async () => {
    const entry = redoStack.current.pop();
    if (!entry) return null;
    await entry.redo();
    undoStack.current.push(entry);
    tick();
    return entry;
  }, [tick]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    tick();
  }, [tick]);

  return {
    push,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}

/** Wire ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y to a history instance. */
export function useHistoryShortcuts(opts: {
  undo: () => void;
  redo: () => void;
  enabled?: boolean;
}) {
  const { undo, redo, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas/contenteditable.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, enabled]);
}