"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A designed email shown as its sender laid it out, on white like in Gmail.
 * Sandboxed: no scripts, no forms; links open in a new tab. Same-origin access
 * (scripts still off) lets Atlas size the frame to the email and scale down
 * fixed-width layouts to fit the pane.
 */
export function EmailFrame({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const [loaded, setLoaded] = useState(false);

  const timers = useRef<number[]>([]);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;
    const root = doc.documentElement;
    const body = doc.body;
    root.style.overflow = "hidden";
    // Let the email take its natural height; some pin html/body to 100% of the frame.
    root.style.height = "auto";
    body.style.height = "auto";
    body.style.minHeight = "0";
    body.style.transform = "";
    body.style.width = "";

    const natural = Math.max(body.scrollWidth, root.scrollWidth);
    const scale = Math.min(1, frame.clientWidth / natural);
    if (scale < 1) {
      // Fixed-width emails (often 600-700px) shrink to the pane, as Gmail does on narrow screens.
      body.style.boxSizing = "border-box";
      body.style.width = `${natural}px`;
      body.style.transformOrigin = "0 0";
      body.style.transform = `scale(${scale})`;
    }
    // Measure the email's body, not the document: a document's scroll height never
    // reports less than the frame's current height, and it already includes the scaling.
    const style = doc.defaultView?.getComputedStyle(body);
    const margins = style ? parseFloat(style.marginTop) + parseFloat(style.marginBottom) : 0;
    setHeight(Math.ceil((body.scrollHeight + margins) * scale) + 2);
  }, []);

  function onLoad() {
    setLoaded(true);
    fit();
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    // Late arrivals change the height: images still loading, web fonts, slow layout.
    for (const img of Array.from(doc.images)) {
      if (!img.complete) {
        img.addEventListener("load", fit, { once: true });
        img.addEventListener("error", fit, { once: true });
      }
    }
    void doc.fonts?.ready.then(fit);
    timers.current.push(...[300, 1200, 3000].map((ms) => window.setTimeout(fit, ms)));
  }

  // Refit when the pane changes width; stop pending refits when the email closes.
  useEffect(() => {
    const frame = frameRef.current;
    const pending = timers.current;
    if (!frame) return;
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => {
      observer.disconnect();
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, [fit]);

  return (
    // shrink-0: a clipped (overflow-hidden) flex child may otherwise squash to the pane's
    // height, cutting the email off instead of letting the pane scroll.
    <div className="relative mx-6 my-6 shrink-0 overflow-hidden rounded-xl bg-white">
      {!loaded && (
        <div role="status" className="absolute inset-0 flex flex-col gap-3 bg-white p-6">
          <span className="sr-only">Loading email</span>
          {[60, 90, 75, 40].map((w, i) => (
            <span key={i} className="h-3 animate-shimmer rounded-full bg-neutral-200" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      <iframe
        ref={frameRef}
        src={src}
        title={title}
        onLoad={onLoad}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        scrolling="no"
        style={{ height }}
        className="block w-full border-0"
      />
    </div>
  );
}
