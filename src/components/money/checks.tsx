"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Sparkle } from "@/components/sparkle";
import type { Issue } from "@/lib/money/checks";
import type { MoneyFlag } from "@/lib/money/types";

// "Things to check": the page's own checks (free, always up to date) and Atlas's review of
// the sorting, each with a fix. "Leave it" is remembered, so nothing nags twice.

/** Items shown before "Show more". */
const FIRST = 5;

export interface FlagItem {
  flag: MoneyFlag;
  /** Its payments still in the flagged category. */
  ids: string[];
  example: string;
}

interface ItemProps {
  title: string;
  detail: string;
  fixLabel: string;
  byAtlas: boolean;
  onFix: () => void;
  onShow: () => void;
  onLeave: () => void;
}

function Item({ title, detail, fixLabel, byAtlas, onFix, onShow, onLeave }: ItemProps) {
  return (
    <li className="flex gap-3 py-3">
      {byAtlas ? <Sparkle className="mt-0.5 size-4" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />}
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{detail}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={onFix} className="h-8 rounded-lg bg-ink px-3 text-[13px] font-semibold text-canvas hover:opacity-90">
            {fixLabel}
          </button>
          <button type="button" onClick={onShow} className="h-8 rounded-lg border border-line-strong px-3 text-[13px] text-ink-soft hover:border-faint hover:text-ink">
            Show
          </button>
          <button type="button" onClick={onLeave} className="h-8 rounded-lg px-3 text-[13px] text-muted hover:bg-white/[0.04] hover:text-ink">
            Leave it
          </button>
        </div>
      </div>
    </li>
  );
}

interface ThingsToCheckProps {
  issues: Issue[];
  flags: FlagItem[];
  /** The review Atlas is running, if any. */
  reviewing: "new" | "all" | null;
  /** "today", "yesterday", "3 days ago"; null if Atlas has never checked. */
  checked: string | null;
  onFix: (issue: Issue) => void;
  onFixFlag: (flag: MoneyFlag) => void;
  onLeave: (id: string) => void;
  onShow: (title: string, ids: string[]) => void;
  onCheckAll: () => void;
}

export function ThingsToCheck({ issues, flags, reviewing, checked, onFix, onFixFlag, onLeave, onShow, onCheckAll }: ThingsToCheckProps) {
  const [all, setAll] = useState(false);
  const items = [
    ...flags.map(({ flag, ids, example }) => ({
      key: `flag:${flag.id}`,
      props: {
        title: `“${example}” is in ${flag.currentCategory}`,
        detail: flag.reason,
        fixLabel: `Move to ${flag.category}`,
        byAtlas: true,
        onFix: () => onFixFlag(flag),
        onShow: () => onShow(example, ids),
        onLeave: () => onLeave(`flag:${flag.id}`),
      },
    })),
    ...issues.map((issue) => ({
      key: issue.id,
      props: {
        title: issue.title,
        detail: issue.detail,
        fixLabel: issue.fix.label,
        byAtlas: false,
        onFix: () => onFix(issue),
        onShow: () => onShow(issue.title, issue.ids),
        onLeave: () => onLeave(issue.id),
      },
    })),
  ];
  const shown = all ? items : items.slice(0, FIRST);

  return (
    <section
      aria-label="Things to check"
      className={`rounded-2xl border border-line bg-panel p-4 md:p-5 ${items.length ? "border-l-[3px] border-l-amber" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
          Things to check
          {items.length > 0 && (
            <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[12.5px] font-semibold text-amber tabular-nums">{items.length}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={onCheckAll}
          disabled={reviewing !== null}
          title="Atlas reads every payment for mistakes (about 5¢)"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-teal/50 px-2.5 text-[13px] text-ink hover:bg-teal/10 disabled:opacity-50"
        >
          <Sparkle className={`size-3.5 ${reviewing ? "animate-shimmer" : ""}`} />
          {reviewing === "all" ? "Checking everything…" : "Check everything"}
        </button>
      </div>

      <p role="status" className="mt-1 flex items-center gap-1.5 text-[13.5px] text-muted">
        {reviewing === "new" ? (
          <>
            <Sparkle className="size-3.5 animate-shimmer" /> Atlas is checking the new payments…
          </>
        ) : items.length === 0 && reviewing === null ? (
          <>
            <CircleCheck className="size-4 text-green" /> Nothing looks off.
          </>
        ) : null}
      </p>
      <p className="mt-1 text-[12.5px] text-faint">
        Atlas checks new payments after each upload{checked ? ` and last checked ${checked}` : ""}. Checking everything costs about 5¢.
      </p>

      {items.length > 0 && (
        <ul className="mt-1 divide-y divide-line">
          {shown.map((item) => (
            <Item key={item.key} {...item.props} />
          ))}
        </ul>
      )}
      {items.length > FIRST && (
        <button type="button" onClick={() => setAll((on) => !on)} className="mt-1 h-8 rounded-lg px-2 text-[13px] text-ink-soft hover:text-ink">
          {all ? "Show fewer" : `Show ${items.length - FIRST} more`}
        </button>
      )}
    </section>
  );
}
