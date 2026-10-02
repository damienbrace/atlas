"use client";

import { Ellipsis, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ALL_SECTIONS, SECTIONS, SETTINGS, type Section } from "@/lib/nav";
import { CaptureButton } from "./capture/voice-capture";
import { Sparkle } from "./sparkle";

function NavLink({ section, active }: { section: Section; active: boolean }) {
  const Icon = section.icon;
  return (
    <Link
      href={`/${section.slug}`}
      aria-current={active ? "page" : undefined}
      title={section.label}
      className={`relative flex h-12 shrink-0 items-center gap-3.5 rounded-xl px-3.5 text-[15px] transition-colors lg:px-4 ${
        active ? "bg-active text-ink" : "text-ink-soft hover:bg-white/[0.04] hover:text-ink"
      }`}
    >
      {active && <span aria-hidden="true" className="absolute inset-y-2 -left-2 w-[3px] rounded-full bg-teal" />}
      <Icon className={`size-[22px] shrink-0 ${active ? "text-teal" : ""}`} strokeWidth={active ? 2 : 1.6} />
      <span className="hidden lg:inline">{section.label}</span>
    </Link>
  );
}

const isActive = (pathname: string, s: Section) => pathname === `/${s.slug}` || pathname.startsWith(`/${s.slug}/`);

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="hidden w-[76px] shrink-0 flex-col bg-sidebar px-3 py-6 md:flex lg:w-[176px]">
      <Link href="/brief" className="mb-7 flex items-center gap-2.5 px-2.5">
        <Sparkle className="size-7" glow />
        <span className="hidden text-[26px] font-bold tracking-tight lg:inline">Atlas</span>
      </Link>
      <div className="-mx-2 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-2 [scrollbar-width:none]">
        {SECTIONS.map((s) => (
          <NavLink key={s.slug} section={s} active={isActive(pathname, s)} />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1.5 border-t border-line pt-4">
        <CaptureButton variant="sidebar" />
        <NavLink section={SETTINGS} active={isActive(pathname, SETTINGS)} />
      </div>
    </nav>
  );
}

const MOBILE_TABS = ["brief", "inbox"];
const MOBILE_TABS_RIGHT = ["calendar"];

function MobileTab({ section, active }: { section: Section; active: boolean }) {
  const Icon = section.icon;
  return (
    <Link
      href={`/${section.slug}`}
      aria-current={active ? "page" : undefined}
      className={`flex w-16 flex-col items-center gap-1 rounded-lg py-1 text-[11px] ${active ? "text-teal" : "text-muted"}`}
    >
      <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.6} />
      {section.label}
    </Link>
  );
}

/** Phone bottom bar: Brief, Inbox, the mic, Calendar, and More for everything else. */
export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const tab = (slug: string) => SECTIONS.find((s) => s.slug === slug)!;
  const inMore = ALL_SECTIONS.filter((s) => ![...MOBILE_TABS, ...MOBILE_TABS_RIGHT].includes(s.slug));
  const moreActive = inMore.some((s) => isActive(pathname, s));

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setMoreOpen(false)}>
          <nav
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] grid grid-cols-3 gap-2 rounded-2xl border border-line-strong bg-raised p-3 shadow-2xl"
          >
            {inMore.map((s) => {
              const Icon = s.icon;
              const active = isActive(pathname, s);
              return (
                <Link
                  key={s.slug}
                  href={`/${s.slug}`}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-1.5 rounded-xl py-3 text-[12.5px] ${active ? "bg-active text-teal" : "text-ink-soft"}`}
                >
                  <Icon className="size-[22px]" strokeWidth={1.75} />
                  {s.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-sidebar/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {MOBILE_TABS.map((slug) => (
            <MobileTab key={slug} section={tab(slug)} active={isActive(pathname, tab(slug))} />
          ))}
          <CaptureButton variant="mobile" />
          {MOBILE_TABS_RIGHT.map((slug) => (
            <MobileTab key={slug} section={tab(slug)} active={isActive(pathname, tab(slug))} />
          ))}
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
            className={`flex w-16 flex-col items-center gap-1 rounded-lg py-1 text-[11px] ${moreActive || moreOpen ? "text-teal" : "text-muted"}`}
          >
            {moreOpen ? <X className="size-[22px]" strokeWidth={1.75} /> : <Ellipsis className="size-[22px]" strokeWidth={1.75} />}
            More
          </button>
        </div>
      </nav>
    </>
  );
}
