"use client";

import { Check } from "lucide-react";
import { useRef, useState, type HTMLAttributes, type PointerEvent } from "react";

// A task row you can swipe right to tick off, on a touch screen. It follows the finger;
// let go past the line and it slides away, short of it and it springs back. A mouse
// never swipes: on a computer rows are clicked and board cards dragged.

/** Sideways travel before a touch counts as a swipe rather than a tap. */
const START_PX = 10;
/** How far across the row a swipe has to go to tick it off. */
const DONE_SHARE = 0.35;

interface SwipeRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Off for tasks that are already done. */
  enabled: boolean;
  onSwipe: () => void;
  /** Gives the moving row a solid background while it's swiped, so it covers the green behind. */
  backdrop?: string;
  draggable?: boolean;
}

export function SwipeRow({ enabled, onSwipe, backdrop = "", className = "", children, ...rest }: SwipeRowProps) {
  const start = useRef<{ x: number; y: number; id: number; width: number } | null>(null);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [held, setHeld] = useState(false);
  const [width, setWidth] = useState(0);
  const past = width > 0 && dx > width * DONE_SHARE;

  function down(e: PointerEvent<HTMLDivElement>) {
    swiped.current = false;
    if (!enabled || e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, width: e.currentTarget.offsetWidth };
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const x = e.clientX - s.x;
    if (!held) {
      // Mostly up or down is a scroll; the browser takes that (touch-action: pan-y).
      if (x < START_PX || Math.abs(e.clientY - s.y) > Math.abs(x)) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // The pointer already went away; the swipe still works while the finger stays on the row.
      }
      setWidth(s.width);
      setHeld(true);
    }
    const next = Math.max(0, x);
    if (next > s.width * DONE_SHARE && dx <= s.width * DONE_SHARE) navigator.vibrate?.(8);
    setDx(next);
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    if (!held) return;
    swiped.current = true;
    setHeld(false);
    if (!past) return setDx(0);
    setDx(s.width);
    setTimeout(() => {
      onSwipe();
      setDx(0);
    }, 180);
  }

  function cancel() {
    start.current = null;
    setHeld(false);
    setDx(0);
  }

  return (
    <li className={`relative rounded-xl ${dx > 0 ? "overflow-hidden" : ""}`}>
      {dx > 0 && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center gap-2 rounded-xl pl-4 text-[14px] font-semibold text-green transition-colors ${
            past ? "bg-green/25" : "bg-green/10"
          }`}
        >
          <Check className="size-5" strokeWidth={3} /> Done
        </div>
      )}
      <div
        {...rest}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        // A finished swipe isn't also a tap on whatever was under the finger.
        onClickCapture={(e) => {
          if (!swiped.current) return;
          swiped.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: held ? "none" : "transform 180ms ease-out" }}
        className={`relative ${enabled ? "touch-pan-y" : ""} ${dx > 0 ? backdrop : ""} ${className}`}
      >
        {children}
      </div>
    </li>
  );
}
