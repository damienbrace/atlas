"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "unsaved" | "saving" | "error";

const RETRY_MS = 4000;

/**
 * Saves edits shortly after typing stops, one save per key (e.g. per day or note),
 * retries failures, and flushes when the page is hidden or the component goes away.
 */
export function useAutosave<T>(save: (key: string, value: T) => Promise<boolean>, delay = 800) {
  const [state, setState] = useState<SaveState>("saved");
  const pending = useRef(new Map<string, T>());
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(async function flushNow(): Promise<void> {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const items = [...pending.current];
    pending.current.clear();
    if (items.length === 0) return;

    setState("saving");
    const failed: [string, T][] = [];
    for (const [key, value] of items) {
      const ok = await saveRef.current(key, value).catch(() => false);
      if (!ok) failed.push([key, value]);
    }
    // Keep newer edits made while saving; requeue only what failed.
    for (const [key, value] of failed) if (!pending.current.has(key)) pending.current.set(key, value);
    if (failed.length > 0) {
      setState("error");
      timer.current = window.setTimeout(() => void flushNow(), RETRY_MS);
    } else {
      setState(pending.current.size > 0 ? "unsaved" : "saved");
    }
  }, []);

  const queue = useCallback(
    (key: string, value: T) => {
      pending.current.set(key, value);
      setState("unsaved");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delay);
    },
    [flush, delay],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  return { state, queue, flush };
}

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Editing…",
  saving: "Saving…",
  error: "Not saved yet, retrying…",
};
