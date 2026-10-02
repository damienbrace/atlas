"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type ShowToast = (toast: Omit<Toast, "id">) => void;

const ToastContext = createContext<ShowToast | null>(null);

const VISIBLE_MS = 5000;

/** One toast at a time, Gmail-style: a new one replaces the old. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((t) => setToast({ ...t, id: ++nextId.current }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
        {toast && (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex animate-toast-in items-center gap-4 rounded-xl border border-line-strong bg-raised py-2.5 pr-2 pl-4 text-sm text-ink shadow-2xl shadow-black/60"
          >
            <span>{toast.message}</span>
            {toast.onAction && (
              <button
                type="button"
                onClick={() => {
                  toast.onAction?.();
                  setToast(null);
                }}
                className="rounded-md px-2 py-1 font-semibold text-teal hover:bg-teal/10"
              >
                {toast.actionLabel ?? "Undo"}
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={() => setToast(null)}
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
