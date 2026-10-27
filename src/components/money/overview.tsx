"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { MONTHS } from "@/lib/format";
import { parseDay } from "@/lib/life/days";
import { monthLabel, type Summary } from "@/lib/money/periods";
import { compactMoney, money } from "@/lib/money/types";

// The top of the Money page: three totals, spending by category and spending by month.
// One measure per chart, so one colour and no legend; values are always in text too.

export const UNSORTED = "__unsorted";

const card = "rounded-2xl border border-line bg-panel";

// ---- Totals ---------------------------------------------------------------------------

function Change({ now, before, label, upIsGood }: { now: number; before: number; label: string; upIsGood: boolean }) {
  if (before === 0) return <p className="mt-1.5 text-[13px] text-faint">Nothing to compare with {label}</p>;
  const change = (now - before) / Math.abs(before);
  const flat = Math.abs(change) < 0.005;
  const good = flat ? null : change > 0 === upIsGood;
  const Arrow = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={`mt-1.5 flex items-center gap-1 text-[13px] ${good === null ? "text-muted" : good ? "text-green" : "text-red"}`}>
      {!flat && <Arrow className="size-3.5 shrink-0" />}
      <span>
        {flat ? "Same as" : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more than" : "less than"}`} {label}
      </span>
    </p>
  );
}

export function Totals({ now, before, compareLabel }: { now: Summary; before: Summary | null; compareLabel: string }) {
  const tiles = [
    { label: "Spent", value: money(now.spentCents, { whole: true }), now: now.spentCents, before: before?.spentCents, upIsGood: false },
    { label: "Money in", value: money(now.incomeCents, { whole: true }), now: now.incomeCents, before: before?.incomeCents, upIsGood: true },
    {
      label: "Left over",
      value: money(now.netCents, { whole: true, sign: true }),
      now: now.netCents,
      before: before?.netCents,
      upIsGood: true,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map((t, i) => (
        <section key={t.label} className={`${card} px-4 py-3.5 md:px-5 md:py-4 ${i === 2 ? "col-span-2 md:col-span-1" : ""}`}>
          <h2 className="text-[13.5px] text-muted">{t.label}</h2>
          <p className={`mt-1 text-[26px] leading-tight font-semibold tracking-tight md:text-[30px] ${t.label === "Left over" && t.now < 0 ? "text-red" : ""}`}>
            {t.value}
          </p>
          {before && t.before !== undefined && <Change now={t.now} before={t.before} label={compareLabel} upIsGood={t.upIsGood} />}
        </section>
      ))}
    </div>
  );
}

// ---- By category ------------------------------------------------------------------------

interface CategoryBarsProps {
  summary: Summary;
  selected: string | null;
  onSelect: (category: string | null) => void;
}

export function CategoryBars({ summary, selected, onSelect }: CategoryBarsProps) {
  const rows = [...summary.byCategory.entries()]
    .map(([category, cents]) => ({ id: category ?? UNSORTED, label: category ?? "Not sorted yet", cents: Math.max(cents, 0) }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const max = rows[0]?.cents ?? 0;
  const total = rows.reduce((sum, r) => sum + r.cents, 0);

  return (
    <section aria-label="Spending by category" className={`${card} p-4 md:p-5`}>
      <h2 className="text-[17px] font-bold tracking-tight">Spending by category</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">No spending in this period.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {rows.map((r) => {
            const on = selected === r.id;
            const dim = selected !== null && !on;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(on ? null : r.id)}
                  title={`${r.label}: ${money(r.cents)} (${Math.round((r.cents / total) * 100)}%)`}
                  className={`group grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-[7px] text-left transition-colors hover:bg-white/[0.04] ${
                    on ? "bg-white/[0.06]" : ""
                  }`}
                >
                  <span className={`truncate text-[14px] ${r.id === UNSORTED ? "text-muted italic" : dim ? "text-muted" : "text-ink"}`}>{r.label}</span>
                  <span className="h-3.5" aria-hidden="true">
                    <span
                      className={`block h-full rounded-r-[4px] transition-opacity ${r.id === UNSORTED ? "bg-faint" : "bg-blue"} ${dim ? "opacity-35" : ""}`}
                      style={{ width: `${Math.max((r.cents / max) * 100, 1.5)}%` }}
                    />
                  </span>
                  <span className={`text-right text-[14px] tabular-nums ${dim ? "text-muted" : "text-ink"}`}>{money(r.cents, { whole: true })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---- By month ----------------------------------------------------------------------------

interface MonthlyProps {
  months: { month: string; cents: number }[];
  today: string;
  title: string;
  /** Picks a month as the period. */
  onPick: (month: string) => void;
}

const CHART_HEIGHT = 150;

/** Rounds the top of the scale up to a tidy number, so gridlines land on round amounts. */
function niceMax(cents: number) {
  if (cents <= 0) return 10_000;
  const magnitude = 10 ** Math.floor(Math.log10(cents));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= cents)!;
  return step * magnitude;
}

export function MonthlyChart({ months, today, title, onPick }: MonthlyProps) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(...months.map((m) => m.cents)));
  const current = today.slice(0, 7);
  const shown = hover !== null ? months[hover] : null;

  return (
    <section aria-label={title} className={`${card} p-4 md:p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        <p className="text-[13px] text-muted tabular-nums" aria-live="polite">
          {shown
            ? `${monthLabel(shown.month)}${shown.month.slice(0, 7) === current ? " so far" : ""}: ${money(shown.cents, { whole: true })}`
            : "Tap a month to see it"}
        </p>
      </div>

      <div className="relative mt-4 grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
        {/* Gridlines at 0, half and the top of the scale. */}
        <div className="relative" style={{ height: CHART_HEIGHT }} aria-hidden="true">
          {[1, 0.5, 0].map((f) => (
            <span key={f} className="absolute right-0 -translate-y-1/2 text-[11px] text-faint tabular-nums" style={{ top: (1 - f) * CHART_HEIGHT }}>
              {compactMoney(top * f)}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height: CHART_HEIGHT }}>
          {[1, 0.5, 0].map((f) => (
            <span key={f} aria-hidden="true" className="absolute inset-x-0 h-px bg-line" style={{ top: (1 - f) * CHART_HEIGHT }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {months.map((m, i) => {
              const partial = m.month.slice(0, 7) === current;
              return (
                <button
                  key={m.month}
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => onPick(m.month)}
                  aria-label={`${monthLabel(m.month)}${partial ? " so far" : ""}: ${money(m.cents, { whole: true })}. Show this month.`}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center rounded-t-md outline-none hover:bg-white/[0.03] focus-visible:bg-white/[0.05]"
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] ${partial ? "bg-blue/45" : "bg-blue"} ${hover !== null && hover !== i ? "opacity-50" : ""}`}
                    style={{ height: `${Math.max((Math.max(m.cents, 0) / top) * 100, m.cents > 0 ? 1 : 0)}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div />
        <div aria-hidden="true" className="flex gap-[2px]">
          {months.map((m) => (
            <span key={m.month} className="min-w-0 flex-1 truncate text-center text-[11px] text-faint">
              {MONTHS[parseDay(m.month).getMonth()].charAt(0)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
