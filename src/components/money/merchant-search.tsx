"use client";

import { Search, X } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { merchantName } from "@/lib/money/merchant";
import { money, type Transaction } from "@/lib/money/types";

// The transaction search. Focusing it lists the businesses in the period, busiest
// first, and typing narrows them; picking one shows just that business. Typing
// without picking still searches every description.

interface Business {
  name: string;
  count: number;
  outCents: number;
  inCents: number;
}

/** Plenty to scroll through; the rest are a few more letters away. */
const MAX_SHOWN = 60;

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-ink">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

interface MerchantSearchProps {
  /** Transactions the suggestions come from (the period, with the other filters applied). */
  transactions: Transaction[];
  query: string;
  merchant: string | null;
  onQuery: (query: string) => void;
  /** Sets (or clears) the business and clears the typed text, in one go. */
  onMerchant: (name: string | null) => void;
}

export function MerchantSearch({ transactions, query, merchant, onQuery, onMerchant }: MerchantSearchProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  // Grouped by name, so every Woolworths (whatever the suburb) is one business.
  const businesses = useMemo(() => {
    const byName = new Map<string, Business>();
    for (const t of transactions) {
      const name = merchantName(t);
      const b = byName.get(name) ?? { name, count: 0, outCents: 0, inCents: 0 };
      b.count += 1;
      if (t.amountCents < 0) b.outCents -= t.amountCents;
      else b.inCents += t.amountCents;
      byName.set(name, b);
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [transactions]);

  const q = query.trim().toLowerCase();
  // Names that start with what's typed come first; otherwise busiest first.
  const matches = (
    q
      ? businesses
          .filter((b) => b.name.toLowerCase().includes(q))
          .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
      : businesses
  ).slice(0, MAX_SHOWN);
  const showList = open && matches.length > 0;

  // One update: the parent clears the typed text along with setting the business.
  function pick(b: Business) {
    onMerchant(b.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (showList && active >= 0) {
        e.preventDefault();
        pick(matches[active]);
      } else setOpen(false);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else onQuery("");
    }
  }

  return (
    <div className="relative min-w-0 flex-1 basis-56" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-2.5 focus-within:border-ink/40">
        <Search className="size-4 shrink-0 text-faint" />
        {merchant && (
          <button
            type="button"
            onClick={() => onMerchant(null)}
            title="Show every business"
            className="flex max-w-[60%] shrink-0 items-center gap-1 rounded-md bg-white/[0.08] py-0.5 pr-1 pl-2 text-[13px] text-ink hover:bg-white/[0.12]"
          >
            <span className="truncate">{merchant}</span>
            <X className="size-3.5 shrink-0" />
            <span className="sr-only">, show every business</span>
          </button>
        )}
        <input
          role="combobox"
          aria-label="Search transactions"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={merchant ? "Search within" : "Search businesses"}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => onQuery("")} className="text-faint hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Businesses"
          className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-line-strong bg-raised p-1 shadow-2xl shadow-black/50 scroll-thin"
        >
          {matches.map((b, i) => (
            <li
              key={b.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keep focus in the box so picking doesn't close the list first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(b)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-[14px] text-ink-soft ${
                i === active ? "bg-white/[0.07] text-ink" : ""
              }`}
            >
              <span className="min-w-0 truncate">
                <Highlight text={b.name} query={q} />
              </span>
              <span className="shrink-0 text-[12.5px] text-muted tabular-nums">
                {b.count} · {b.outCents > 0 ? money(b.outCents, { whole: true }) : money(b.inCents, { whole: true, sign: true })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
