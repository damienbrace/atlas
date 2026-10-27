"use client";

import { TrendingUp } from "lucide-react";
import { shortDay } from "@/lib/life/days";
import type { Recurring } from "@/lib/money/recurring";
import { money } from "@/lib/money/types";

// Subscriptions, bills and memberships, found from charges that repeat on a schedule.

const CADENCE_LABEL: Record<Recurring["cadence"], string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const SHOWN = 10;

export function Repeats({ items, onPick }: { items: Recurring[]; onPick: (r: Recurring) => void }) {
  const perMonth = items.reduce((sum, r) => sum + r.monthlyCents, 0);
  return (
    <section aria-label="Repeat charges" className="rounded-2xl border border-line bg-panel p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-tight">Repeat charges</h2>
        {items.length > 0 && <p className="text-[13px] text-muted tabular-nums">about {money(perMonth, { whole: true })} a month</p>}
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">Subscriptions and bills show up here once a few months of charges are uploaded.</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {items.slice(0, SHOWN).map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onPick(r)}
                title="Show these charges"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.04]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] text-ink">{r.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {CADENCE_LABEL[r.cadence]} · next about {shortDay(r.nextDay)}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-[14.5px] tabular-nums">{money(r.lastCents)}</span>
                  {r.rose && (
                    <span className="flex items-center justify-end gap-1 text-[12px] text-amber">
                      <TrendingUp className="size-3" /> up from {money(r.typicalCents)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length > SHOWN && <p className="mt-1 px-2 text-[12.5px] text-faint">and {items.length - SHOWN} more</p>}
    </section>
  );
}
