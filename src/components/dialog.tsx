"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Modal on the native <dialog>: focus trapping, Esc to close and a backdrop come built in. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(460px,calc(100vw-32px))] rounded-2xl border border-line-strong bg-raised p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      {open && <div className="p-6">{children}</div>}
    </dialog>
  );
}
