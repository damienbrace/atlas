"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { MONTHS } from "@/lib/format";
import { parseDay, shortDay } from "@/lib/life/days";
import type { AccountBalance } from "@/lib/money/accounts";
import { merchantName } from "@/lib/money/merchant";
import { buildReview, lastMonth, monthOptions, yearOptions, type ReviewChoice } from "@/lib/money/review";
import { money, type Transaction } from "@/lib/money/types";

// Money → Month and Year in Review: how a month or a year went, against the ones before.
// The choice lives in the address (?month=2026-09, ?year=12m), so Back keeps it and the
// link in the monthly Telegram message opens the right one.

interface ReviewPageProps {
  transactions: Transaction[];
  accounts: AccountBalance[];
  today: string;
}

const card = "rounded-2xl border border-line bg-panel p-4 md:p-5";
const chip = (on: boolean) =>
  `h-9 shrink-0 rounded-lg border px-3 text-[13.5px] transition-colors ${
    on ? "border-ink/50 bg-white/[0.08] text-ink" : "border-line-strong text-ink-soft hover:border-faint"
  }`;
const whole = (cents: number) => money(cents, { whole: true });
const signed = (cents: number) => money(cents, { whole: true, sign: true });
/** "$950", "$3.2k" */
function compact(cents: number) {
  const dollars = Math.round(cents / 100);
  return Math.abs(dollars) < 1000 ? whole(cents) : `${dollars < 0 ? "−" : ""}$${(Math.abs(dollars) / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
const monthName = (day: string) => MONTHS[parseDay(day).getMonth()];

/** "1 Sep to 30 Sep", or "30 Oct 2025 to 29 Oct 2026" when it crosses a year. */
function spanText(from: string, to: string) {
  const years = from.slice(0, 4) !== to.slice(0, 4);
  const label = (day: string) => `${parseDay(day).getDate()} ${monthName(day)}${years ? ` ${day.slice(0, 4)}` : ""}`;
  return `${label(from)} to ${label(to)}`;
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-card px-3.5 py-3">
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className={`mt-0.5 truncate text-[22px] leading-tight font-semibold tracking-tight tabular-nums ${tone === "bad" ? "text-red" : tone === "good" ? "text-green" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[12.5px] leading-snug break-words text-muted">{sub}</p>}
    </div>
  );
}

/** "74% more" against usual, coloured for spending (more is the bad way). */
function change(now: number, usual: number) {
  if (usual <= 0) return null;
  const pct = Math.round(((now - usual) / usual) * 100);
  if (Math.abs(pct) < 5) return { text: "about the same", tone: undefined };
  return { text: `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"}`, tone: pct > 0 ? ("bad" as const) : ("good" as const) };
}

export function ReviewPage({ transactions, accounts, today }: ReviewPageProps) {
  const router = useRouter();
  const address = useSearchParams();
  const earliest = useMemo(() => transactions.reduce((min, t) => (t.day < min ? t.day : min), today), [transactions, today]);
  const months = useMemo(() => monthOptions(earliest, today), [earliest, today]);
  const years = useMemo(() => yearOptions(earliest, today), [earliest, today]);

  const [choice, setChoice] = useState<ReviewChoice>(() => {
    const month = address.get("month");
    const year = address.get("year");
    if (year && years.some((o) => o.id === year)) return { kind: "year", id: year };
    if (month && months.some((o) => o.id === month)) return { kind: "month", id: month };
    // Last month, unless the history doesn't reach back that far.
    return { kind: "month", id: months.some((o) => o.id === lastMonth(today)) ? lastMonth(today) : months[0].id };
  });

  /** Shows another month or year and keeps it in the address (without a trip to the server). */
  function choose(next: ReviewChoice) {
    setChoice(next);
    window.history.replaceState(null, "", `/money/review?${next.kind}=${next.id}`);
  }

  const r = useMemo(() => buildReview({ transactions, accounts, today, choice }), [transactions, accounts, today, choice]);
  const showMerchant = (name: string) => router.push(`/money?merchant=${encodeURIComponent(name)}`);
  const options = choice.kind === "month" ? months : years;
  const empty = r.spentCents === 0 && r.incomeCents === 0;
  const spentChange = r.usual ? change(r.spentCents, r.usual.spentCents) : null;
  const categoryMax = r.categories[0]?.cents ?? 0;
  const monthMax = Math.max(...r.months.map((m) => m.spentCents), 0);
  const dayCount = `${r.span.days} day${r.span.days === 1 ? "" : "s"}`;

  return (
    <div className="h-full overflow-y-auto p-3 pb-[calc(var(--mobile-nav,84px)+16px)] scroll-thin md:pb-3 lg:p-5">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
        <header className="px-1">
          <Link href="/money/insights" className="-ml-1.5 inline-flex h-8 items-center gap-1 rounded-lg pr-2 text-[14px] text-muted hover:text-ink">
            <ChevronLeft className="size-4" /> Insights
          </Link>
          <h1 className="text-[30px] leading-tight font-bold tracking-tight md:text-[34px]">
            {r.title}
            {r.soFar && <span className="text-muted"> so far</span>}
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {spanText(r.span.from, r.span.to)} · {dayCount}
            {r.partial && " (your history starts here)"}
            {r.comparedWith ? ` · compared with ${r.comparedWith}` : ""}
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2 px-1">
          <div role="group" aria-label="Review" className="flex gap-1.5">
            <button type="button" aria-pressed={choice.kind === "month"} onClick={() => choose({ kind: "month", id: choice.kind === "month" ? choice.id : months.find((o) => o.id === lastMonth(today))?.id ?? months[0].id })} className={chip(choice.kind === "month")}>
              Month
            </button>
            <button type="button" aria-pressed={choice.kind === "year"} onClick={() => choose({ kind: "year", id: choice.kind === "year" ? choice.id : "12m" })} className={chip(choice.kind === "year")}>
              Year
            </button>
          </div>
          <select
            aria-label={choice.kind === "month" ? "Month" : "Year"}
            value={choice.id}
            onChange={(e) => choose({ kind: choice.kind, id: e.target.value })}
            className="h-9 min-w-0 rounded-lg border border-line-strong bg-transparent px-2.5 text-[13.5px] text-ink [color-scheme:dark]"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {empty ? (
          <p className={`${card} text-[14px] text-muted`}>There are no transactions in these dates.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Stat label="Spent" value={whole(r.spentCents)} sub={r.usual ? `usually ${whole(r.usual.spentCents)}${spentChange ? ` · ${spentChange.text}` : ""}` : undefined} tone={spentChange?.tone} />
              <Stat label="Money in" value={whole(r.incomeCents)} sub={r.usual ? `usually ${whole(r.usual.incomeCents)}` : undefined} />
              <Stat label="Left over" value={signed(r.leftOverCents)} sub={r.usual ? `usually ${signed(r.usual.leftOverCents)}` : undefined} tone={r.leftOverCents < 0 ? "bad" : undefined} />
              <Stat label="Kept" value={r.rate === null ? "–" : `${Math.round(r.rate * 100)}%`} sub="of money in" tone={r.rate !== null && r.rate < 0 ? "bad" : undefined} />
            </div>

            <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Where it went" note={r.usual ? "and what's usual" : undefined}>
                  <ul className="mt-2 flex flex-col">
                    {r.categories.map((c) => (
                      <li key={c.category} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 px-0.5 py-[7px]">
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] text-ink">{c.category}</span>
                          {c.usualCents !== null && <span className="block truncate text-[11.5px] text-faint tabular-nums">usually {whole(c.usualCents)}</span>}
                        </span>
                        <span className="h-3" aria-hidden="true">
                          <span className="block h-full rounded-r-[4px] bg-blue" style={{ width: `${Math.max((c.cents / categoryMax) * 100, 1.5)}%` }} />
                        </span>
                        <span className="text-right text-[14px] text-ink tabular-nums">
                          {whole(c.cents)} <span className="text-[12px] text-muted">{Math.round(c.share * 100)}%</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>

                {(r.up.length > 0 || r.down.length > 0) && (
                  <Card title="What changed" note={r.comparedWith ? `vs ${r.comparedWith}` : undefined}>
                    <ul className="mt-2 divide-y divide-line">
                      {[...r.up, ...r.down].map((c) => (
                        <li key={c.category} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{c.category}</span>
                            <span className="block text-[12.5px] text-muted tabular-nums">
                              {whole(c.nowCents)}, usually {whole(c.usualCents)}
                            </span>
                          </span>
                          <span className={`shrink-0 tabular-nums ${c.changeCents > 0 ? "text-red" : "text-green"}`}>{signed(c.changeCents)}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {r.months.length > 1 && (
                  <Card title="Month by month" note="spending">
                    {r.priciestMonth && r.bestMonth && (
                      <p className="mt-2 text-[14px] text-muted">
                        Priciest: <span className="text-ink">{monthName(r.priciestMonth.month)}</span> {whole(r.priciestMonth.spentCents)} · most left over:{" "}
                        <span className="text-ink">{monthName(r.bestMonth.month)}</span> {signed(r.bestMonth.leftOverCents)}
                      </p>
                    )}
                    <div className="mt-3 flex h-36 items-end gap-1.5" aria-hidden="true">
                      {r.months.map((m) => (
                        <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${monthName(m.month)}: ${whole(m.spentCents)}${m.whole ? "" : " (part month)"}`}>
                          <span className="text-[10px] text-muted tabular-nums">{compact(m.spentCents)}</span>
                          <span className={`block w-full max-w-8 rounded-t-[4px] bg-blue ${m.whole ? "" : "opacity-45"}`} style={{ height: `${monthMax ? Math.max((m.spentCents / monthMax) * 70, 2) : 2}%` }} />
                          <span className="text-[10.5px] text-faint">{monthName(m.month)}</span>
                        </div>
                      ))}
                    </div>
                    {r.months.some((m) => !m.whole) && <p className="mt-2 text-[12px] text-faint">Lighter bars are part months.</p>}
                    <p className="sr-only">{r.months.map((m) => `${monthName(m.month)} ${whole(m.spentCents)}`).join(", ")}</p>
                  </Card>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Standouts">
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    {r.biggest && <Stat label="Biggest purchase" value={money(-r.biggest.amountCents, { whole: true })} sub={`${merchantName(r.biggest)} · ${shortDay(r.biggest.day)}`} />}
                    {r.biggestDay && <Stat label="Biggest day" value={whole(r.biggestDay.cents)} sub={shortDay(r.biggestDay.day)} />}
                    <Stat label="No-spend days" value={String(r.noSpendDays)} sub={`of ${dayCount}`} />
                    {r.busiest && <Stat label="Busiest days" value={r.busiest.day} sub={`about ${whole(r.busiest.averageCents)} a day`} />}
                    {r.mostVisited && <Stat label="Most visits" value={`${r.mostVisited.visits}×`} sub={r.mostVisited.name} />}
                    <Stat label="Purchases" value={r.purchases.toLocaleString("en-AU")} sub={`at ${r.places} place${r.places === 1 ? "" : "s"}`} />
                  </div>
                </Card>

                {r.businesses.length > 0 && (
                  <Card title="Top places">
                    <ul className="mt-1.5">
                      {r.businesses.map((b) => (
                        <li key={b.name}>
                          <button
                            type="button"
                            onClick={() => showMerchant(b.name)}
                            className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.03]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[14.5px] text-ink">{b.name}</span>
                              <span className="block text-[12.5px] text-muted">
                                {b.visits} visit{b.visits === 1 ? "" : "s"}
                              </span>
                            </span>
                            <span className="text-[14.5px] text-ink tabular-nums">{whole(b.cents)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <Card title="Savers and subscriptions">
                  <ul className="mt-2 divide-y divide-line text-[14px]">
                    {r.savedCents !== null && (
                      <li className="flex items-baseline justify-between gap-3 py-2">
                        <span className="text-ink">Into savers</span>
                        <span className="text-right tabular-nums">
                          {signed(r.savedCents)}
                          {r.roundUpCents > 0 && <span className="block text-[12.5px] text-muted">{money(r.roundUpCents)} from round-ups</span>}
                        </span>
                      </li>
                    )}
                    <li className="flex items-baseline justify-between gap-3 py-2">
                      <span className="text-ink">Subscriptions</span>
                      <span className="tabular-nums">{whole(r.subscriptions.monthlyCents)} a month</span>
                    </li>
                    {r.subscriptions.fresh.length > 0 && (
                      <li className="flex items-baseline justify-between gap-3 py-2">
                        <span className="shrink-0 text-ink">New</span>
                        <span className="min-w-0 text-right text-muted">{r.subscriptions.fresh.join(", ")}</span>
                      </li>
                    )}
                    {r.subscriptions.rose.length > 0 && (
                      <li className="flex items-baseline justify-between gap-3 py-2">
                        <span className="shrink-0 text-ink">Gone up</span>
                        <span className="min-w-0 text-right text-muted">{r.subscriptions.rose.join(", ")}</span>
                      </li>
                    )}
                  </ul>
                </Card>

                {r.habits.length > 0 && (
                  <Card title="Small habits">
                    <ul className="mt-1.5">
                      {r.habits.map((h) => (
                        <li key={h.name}>
                          <button
                            type="button"
                            onClick={() => showMerchant(h.name)}
                            className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.03]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[14.5px] text-ink">{h.name}</span>
                              <span className="block text-[12.5px] text-muted">
                                {h.visits} times · usually {money(h.typicalCents)}
                              </span>
                            </span>
                            <span className="text-[14.5px] text-ink tabular-nums">{whole(h.spentCents)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
