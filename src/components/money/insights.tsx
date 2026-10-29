"use client";

import { shortDay } from "@/lib/life/days";
import type { Habit } from "@/lib/money/habits";
import type { Cadence } from "@/lib/money/recurring";
import type { auditSubscriptions } from "@/lib/money/subscriptions";
import { money } from "@/lib/money/types";

// Two insight cards: small habits that add up over a year, and what subscriptions cost
// (with the new ones, the ones that went up, and the ones doing the same job).

const card = "rounded-2xl border border-line bg-panel p-4 md:p-5";
const row = "-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-white/[0.03]";
/** Habits shown; the rest are a filter away. */
const SHOWN = 6;

function often(perWeek: number) {
  if (perWeek >= 1) return `${perWeek.toFixed(1).replace(/\.0$/, "")}× a week`;
  return `${((perWeek * 52) / 12).toFixed(1).replace(/\.0$/, "")}× a month`;
}

export function Habits({ habits, onPick }: { habits: Habit[]; onPick: (name: string) => void }) {
  if (habits.length === 0) return null;
  const shown = habits.slice(0, SHOWN);
  const together = shown.reduce((sum, h) => sum + h.yearCents, 0);
  return (
    <section aria-label="Small habits" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-tight">Small habits</h2>
        <p className="text-[13px] text-muted">last 90 days</p>
      </div>
      <p className="mt-1 text-[13.5px] text-muted">
        Together about <span className="font-semibold text-ink tabular-nums">{money(together, { whole: true })}</span> a year at this rate.
      </p>
      <ul className="mt-1.5">
        {shown.map((h) => (
          <li key={h.name}>
            <button type="button" onClick={() => onPick(h.name)} className={row} title={`Show ${h.name}'s payments`}>
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] text-ink">{h.name}</span>
                <span className="block text-[12.5px] text-muted">
                  {often(h.perWeek)} · usually {money(h.typicalCents)}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[14.5px] text-ink tabular-nums">{money(h.yearCents, { whole: true })}</span>
                <span className="block text-[12px] text-faint">a year</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CADENCE: Record<Cadence, string> = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

interface SubscriptionsProps {
  audit: ReturnType<typeof auditSubscriptions>;
  onPick: (name: string) => void;
}

export function Subscriptions({ audit, onPick }: SubscriptionsProps) {
  if (audit.subscriptions.length === 0) return null;
  return (
    <section aria-label="Subscriptions" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-[17px] font-bold tracking-tight">Subscriptions</h2>
        <p className="text-[13px] text-muted tabular-nums">
          <span className="font-semibold text-ink">{money(audit.monthlyCents, { whole: true })}</span> a month · {money(audit.yearCents, { whole: true })} a year
        </p>
      </div>
      {audit.overlaps.map((o) => (
        <p key={o.kind} className="mt-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13.5px] text-ink">
          {o.names.length} {o.kind}: {o.names.join(", ")}. {money(o.monthlyCents, { whole: true })} a month together.
        </p>
      ))}
      <ul className="mt-1.5">
        {audit.subscriptions.map((s) => (
          <li key={s.name}>
            <button type="button" onClick={() => onPick(s.name)} className={row} title={`Show ${s.name}'s payments`}>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5 text-[14.5px] text-ink">
                  <span className="truncate">{s.name}</span>
                  {s.isNew && <span className="shrink-0 rounded-full bg-blue/15 px-1.5 py-px text-[11px] text-blue">new</span>}
                  {s.rose && <span className="shrink-0 rounded-full bg-amber/15 px-1.5 py-px text-[11px] text-amber">price up</span>}
                </span>
                <span className="block text-[12.5px] text-muted">
                  {s.cadence && s.nextDay ? `${CADENCE[s.cadence]} · next about ${shortDay(s.nextDay)}` : `No set schedule · last ${shortDay(s.lastDay)}`}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[14.5px] text-ink tabular-nums">{money(s.monthlyCents)}</span>
                <span className="block text-[12px] text-faint">{s.cadence ? "a month" : "about a month"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
