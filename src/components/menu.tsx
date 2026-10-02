"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  checked?: boolean;
  danger?: boolean;
}

interface MenuProps {
  /** Accessible name and tooltip for the trigger. */
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  items: MenuItem[];
  heading?: string;
  align?: "start" | "end";
}

export function Menu({ label, trigger, triggerClassName, items, heading, align = "end" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      options[(index + step + options.length) % options.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`absolute top-full z-40 mt-2 min-w-48 rounded-xl border border-line-strong bg-raised p-1.5 shadow-2xl shadow-black/50 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {heading && <p className="px-3 pt-1.5 pb-1 text-xs font-medium text-muted">{heading}</p>}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={`flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-white/5 focus-visible:bg-white/8 ${
                item.danger ? "text-red" : "text-ink"
              }`}
            >
              {item.label}
              {item.checked && <Check className="size-4 text-teal" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
