"use client";

import { ChevronRight, EyeOff, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { saveBriefHidden } from "@/app/(app)/brief/actions";
import { iconButtonClass } from "@/components/icon-button";
import { Menu } from "@/components/menu";
import { useToast } from "@/components/toast";
import { BRIEF_SECTIONS, type BriefSection } from "@/lib/brief-sections";
import { summarySentence } from "@/lib/brief-summary";

// Show and hide parts of the Brief. The choice is saved on the PC, so every device shares it.

interface LayoutState {
  hidden: Set<BriefSection>;
  setShown: (id: BriefSection, shown: boolean) => void;
}

const LayoutContext = createContext<LayoutState | null>(null);

function useLayout() {
  const layout = useContext(LayoutContext);
  if (!layout) throw new Error("Brief layout pieces must sit inside <BriefLayout>");
  return layout;
}

const labelFor = (id: BriefSection) => BRIEF_SECTIONS.find((s) => s.id === id)!.label;

export function BriefLayout({ initialHidden, children }: { initialHidden: BriefSection[]; children: ReactNode }) {
  const toast = useToast();
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  // Latest value for handlers that run later (Undo in a toast).
  const latest = useRef(hidden);

  function apply(next: Set<BriefSection>) {
    latest.current = next;
    setHidden(next);
  }

  function setShown(id: BriefSection, shown: boolean) {
    const before = latest.current;
    const next = new Set(before);
    if (shown) next.delete(id);
    else next.add(id);
    apply(next);
    void saveBriefHidden([...next])
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => {
        apply(before);
        toast({ message: "Couldn't save that layout change" });
      });
    if (!shown) toast({ message: `${labelFor(id)} hidden`, onAction: () => setShown(id, true) });
  }

  return <LayoutContext.Provider value={{ hidden, setShown }}>{children}</LayoutContext.Provider>;
}

/** Renders its children only while that part of the Brief is shown. */
export function Show({ id, children }: { id: BriefSection; children: ReactNode }) {
  return useLayout().hidden.has(id) ? null : children;
}

/** A hint for when every part of the Brief is hidden. */
export function NothingShown() {
  const { hidden } = useLayout();
  if (hidden.size < BRIEF_SECTIONS.length) return null;
  return (
    <p className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-[15px] text-muted">
      Everything on the Brief is hidden. Use <span className="text-ink">Customise</span> above to bring parts back.
    </p>
  );
}

/** One button with a tick list of every part of the Brief. */
export function CustomiseButton() {
  const { hidden, setShown } = useLayout();
  return (
    <Menu
      label="Customise the Brief"
      heading="Show on the Brief"
      trigger={
        <>
          <SlidersHorizontal className="size-[18px]" strokeWidth={1.75} />
          <span className="hidden sm:inline">Customise</span>
          {hidden.size > 0 && <span className="text-muted tabular-nums">· {hidden.size} hidden</span>}
        </>
      }
      triggerClassName="flex h-10 items-center gap-2 rounded-full border border-line-strong px-4 text-[14px] text-ink-soft hover:border-faint hover:text-ink"
      items={BRIEF_SECTIONS.map((s) => ({
        label: s.label,
        checked: !hidden.has(s.id),
        onSelect: () => setShown(s.id, hidden.has(s.id)),
      }))}
    />
  );
}

export function HideButton({ id }: { id: BriefSection }) {
  const { setShown } = useLayout();
  return (
    <button type="button" onClick={() => setShown(id, false)} aria-label={`Hide ${labelFor(id)}`} title={`Hide ${labelFor(id)}`} className={`${iconButtonClass} size-8`}>
      <EyeOff className="size-[17px]" strokeWidth={1.75} />
    </button>
  );
}

/**
 * A Brief card: title, Open link and Hide button. `icon` is an element, not a component:
 * the server page can hand rendered elements to this client component, but not functions.
 */
export function Card({ id, title, icon, href, children }: { id: BriefSection; title: string; icon: ReactNode; href: string; children: ReactNode }) {
  return (
    <Show id={id}>
      <section aria-label={title} className="rounded-2xl border border-line bg-panel p-4 md:p-5">
        <header className="mb-3 flex items-center justify-between gap-2 px-1">
          <h2 className="flex items-center gap-2.5 text-[18px] font-bold tracking-tight">
            {icon}
            {title}
          </h2>
          <span className="flex items-center gap-1">
            <Link href={href} className="flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-[13px] text-muted hover:text-ink">
              Open <ChevronRight className="size-4" />
            </Link>
            <HideButton id={id} />
          </span>
        </header>
        {children}
      </section>
    </Show>
  );
}

/** Atlas's one-line summary, rebuilt from whichever parts are showing. */
export function Summary({ parts }: { parts: { section: BriefSection; text: string }[] }) {
  const { hidden } = useLayout();
  const sentence = summarySentence(parts.filter((p) => !hidden.has(p.section)).map((p) => p.text));
  return <p className="min-w-0 flex-1 text-[16.5px] leading-relaxed">{sentence}</p>;
}
