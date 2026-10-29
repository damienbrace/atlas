"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { MONTHS } from "@/lib/format";
import { parseDay, shortDay } from "@/lib/life/days";
import { findIssues } from "@/lib/money/checks";
import { findHabits } from "@/lib/money/habits";
import {
  biggestPurchases,
  categoryChanges,
  categoryCosts,
  earlierSpans,
  nextPay,
  periodSpan,
  safeToSpend,
  savingsRate,
  weekdaySpending,
  weeksSoFar,
  type DaySpan,
} from "@/lib/money/insights";
import { merchantName } from "@/lib/money/merchant";
import { PERIODS, periodRange, weekStart, type PeriodId, type Range } from "@/lib/money/periods";
import { findRecurring } from "@/lib/money/recurring";
import { expandSplits } from "@/lib/money/split";
import { auditSubscriptions } from "@/lib/money/subscriptions";
import { money, type MoneyFlag, type Rule, type Transaction } from "@/lib/money/types";
import { weeklySummary } from "@/lib/money/weekly";
import { Habits, Subscriptions } from "./insights";
import type { UpStatus } from "./up-connect";

// Money → Insights. Right now: what's safe to spend until payday and the week against a
// usual one. For the period picked: what's changed, the savings rate, what each category
// costs, habits, the busiest days and the biggest purchases. Then subscriptions and the
// weekly message Hermes sends. All worked out here from the transactions; anything left out
// of the totals stays out. The period lives in the address, so Back from Money keeps it.

interface InsightsPageProps {
  transactions: Transaction[];
  up: UpStatus | null;
  flags: MoneyFlag[];
  leftChecks: string[];
  rules: Rule[];
  categories: string[];
  ownerName: string;
  today: string;
}

const DEFAULT_PERIOD: PeriodId = "3m";
const PERIOD_IDS = new Set<string>([...PERIODS.map((p) => p.id), "custom"]);
const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const card = "rounded-2xl border border-line bg-panel p-4 md:p-5";
const chip = (on: boolean) =>
  `h-9 shrink-0 rounded-lg border px-3 text-[13.5px] transition-colors ${
    on ? "border-ink/50 bg-white/[0.08] text-ink" : "border-line-strong text-ink-soft hover:border-faint"
  }`;
const dateInput = "h-9 rounded-lg border border-line-strong bg-transparent px-2 text-[13.5px] text-ink [color-scheme:dark]";
const whole = (cents: number) => money(cents, { whole: true });

function dayLabel(day: string, withYear: boolean) {
  const d = parseDay(day);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ""}`;
}

/** "1 Aug to 29 Oct", with years when it crosses one. */
function spanText(span: DaySpan) {
  if (span.from === span.to) return dayLabel(span.from, false);
  const years = span.from.slice(0, 4) !== span.to.slice(0, 4);
  return `${dayLabel(span.from, years)} to ${dayLabel(span.to, years)}`;
}

/** What the period is compared with, for `count` earlier spans. */
function earlierWords(id: PeriodId, count: number, days: number) {
  const one = count === 1;
  switch (id) {
    case "week":
      return `vs the same days of ${one ? "last week" : `the last ${count} weeks`}`;
    case "last-week":
      return `vs ${one ? "the week" : `the ${count} weeks`} before`;
    case "month":
      return `vs the same days of ${one ? "last month" : `the last ${count} months`}`;
    case "last-month":
      return `vs ${one ? "the month" : `the ${count} months`} before`;
    case "3m":
      return one ? "vs the 3 months before" : `vs the ${count} three-month spans before`;
    case "12m":
      return one ? "vs the 12 months before" : `vs the ${count} twelve-month spans before`;
    case "fy":
      return `vs this time ${one ? "last FY" : `in the last ${count} FYs`}`;
    default:
      return one ? `vs the ${days} days before` : `vs the ${count} spans of ${days} days before`;
  }
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[17px] font-bold tracking-tight">{title}</h3>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const sectionLabel = "px-1 text-[13px] font-semibold tracking-wide text-muted uppercase";

/** One measure per row, so one colour; the value is always written out too. */
function Bar({ label, value, cents, max }: { label: string; value: string; cents: number; max: number }) {
  return (
    <div className="grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-[7px]">
      <span className="truncate text-[14px] text-ink">{label}</span>
      <span className="h-3" aria-hidden="true">
        {cents > 0 && max > 0 && <span className="block h-full rounded-r-[4px] bg-blue" style={{ width: `${Math.max((cents / max) * 100, 1.5)}%` }} />}
      </span>
      <span className="text-right text-[14px] tabular-nums text-ink">{value}</span>
    </div>
  );
}

const COST_MEASURES = [
  { id: "total", label: "Total" },
  { id: "week", label: "A week" },
  { id: "year", label: "A year" },
] as const;
type CostMeasure = (typeof COST_MEASURES)[number]["id"];

const DAY_NAMES: Record<string, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays" };
const monthName = (day: string) => MONTHS[parseDay(day).getMonth()];
const percent = (rate: number | null) => (rate === null ? "–" : `${Math.round(rate * 100)}%`);

export function InsightsPage({ transactions, up, flags, leftChecks, rules, categories, ownerName, today }: InsightsPageProps) {
  const router = useRouter();
  const showMerchant = (name: string) => router.push(`/money?merchant=${encodeURIComponent(name)}`);

  // Read from the address as it is now (?period=12m, or ?period=custom&from=…&to=…), not the
  // server's first render, so coming Back restores the period last picked.
  const address = useSearchParams();
  const [period, setPeriod] = useState<PeriodId>(() => {
    const id = address.get("period");
    return id && PERIOD_IDS.has(id) ? (id as PeriodId) : DEFAULT_PERIOD;
  });
  const [custom, setCustom] = useState<Range>(() => {
    const from = address.get("from");
    const to = address.get("to");
    return { from: isDay(from) ? from : periodRange("month", today, { from: null, to: null }).from, to: isDay(to) ? to : today };
  });
  const [costMeasure, setCostMeasure] = useState<CostMeasure>("total");

  /** Picks a period and keeps it in the address (without a trip to the server). */
  function choose(next: PeriodId, dates = custom) {
    setPeriod(next);
    setCustom(dates);
    const params = new URLSearchParams();
    if (next !== DEFAULT_PERIOD) params.set("period", next);
    if (next === "custom") {
      if (dates.from) params.set("from", dates.from);
      if (dates.to) params.set("to", dates.to);
    }
    const query = params.toString();
    window.history.replaceState(null, "", `/money/insights${query ? `?${query}` : ""}`);
  }

  // Everything that doesn't depend on the period.
  const base = useMemo(() => {
    const counted = transactions.filter((t) => !t.excluded);
    const parts = expandSplits(counted);
    const recurring = findRecurring(counted, today);
    const accounts = up?.accounts ?? [];
    const pay = nextPay(counted, today);
    const openFlags = flags.filter((f) => transactions.some((t) => t.merchantKey === f.merchantKey && t.category === f.currentCategory && !t.splits)).length;
    const openChecks = openFlags + findIssues(transactions, rules, categories, ownerName, new Set(leftChecks)).length;
    return {
      counted,
      parts,
      earliest: parts.reduce((min, t) => (t.day < min ? t.day : min), today),
      saverNames: new Set(accounts.filter((a) => a.type === "SAVER").map((a) => a.name)),
      pay,
      safe: pay ? safeToSpend(accounts, recurring, pay.nextDay, today) : null,
      week: weeksSoFar(parts, weekStart(today), today),
      subscriptions: auditSubscriptions(counted, recurring, today),
      message: weeklySummary({ transactions, accounts, recurring, today, openChecks }),
    };
  }, [transactions, up, flags, leftChecks, rules, categories, ownerName, today]);

  // The period's cards.
  const picked = useMemo(() => {
    const { counted, parts, earliest, saverNames } = base;
    const span = periodSpan(periodRange(period, today, custom), parts, today);
    if (span.days === 0) return { span, empty: true as const };
    const earlier = earlierSpans(period, today, custom, earliest);
    return {
      span,
      empty: false as const,
      earlier,
      changes: categoryChanges(parts, span, earlier).slice(0, 8),
      savings: savingsRate(parts, counted, saverNames, span, today),
      costs: categoryCosts(parts, span).slice(0, 12),
      habits: findHabits(counted, span.to, span.from),
      weekdays: weekdaySpending(parts, span),
      biggest: biggestPurchases(counted, span),
    };
  }, [base, period, custom, today]);

  const { pay, safe, week, subscriptions, message } = base;
  const { span } = picked;
  const weekMax = Math.max(...week.rows.map((r) => r.spentCents), 0);

  return (
    <div className="h-full overflow-y-auto p-3 pb-[calc(var(--mobile-nav,84px)+16px)] scroll-thin md:pb-3 lg:p-5">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
        <header className="px-1">
          <Link href="/money" className="-ml-1.5 inline-flex h-8 items-center gap-1 rounded-lg pr-2 text-[14px] text-muted hover:text-ink">
            <ChevronLeft className="size-4" /> Money
          </Link>
          <h1 className="text-[30px] leading-tight font-bold tracking-tight md:text-[34px]">Insights</h1>
          <p className="mt-1 text-[15px] text-muted">Worked out from your transactions. Anything left out of the totals stays out.</p>
        </header>

        <h2 className={sectionLabel}>Right now</h2>
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <Card title="Safe to spend" note={pay ? `until ${shortDay(pay.nextDay)}` : undefined}>
            {!pay ? (
              <p className="mt-2 text-[14px] text-muted">Atlas hasn&apos;t spotted a regular pay yet.</p>
            ) : !safe ? (
              <p className="mt-2 text-[14px] text-muted">Connect Up on the Money page to see this.</p>
            ) : (
              <>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[30px] leading-tight font-semibold tracking-tight tabular-nums ${safe.safeCents < 0 ? "text-red" : ""}`}>
                    {whole(safe.safeCents)}
                  </span>
                  <span className="text-[15px] text-muted">
                    about {whole(Math.max(safe.perDayCents, 0))} a day for {safe.days} day{safe.days === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="mt-1 text-[13.5px] text-muted">
                  Spending {money(safe.balanceCents)}
                  {safe.bills.length > 0 && `, less ${money(safe.billsCents)} of bills before then (${safe.bills.map((b) => b.name).join(", ")})`}.
                </p>
                <p className="mt-1 text-[13px] text-faint">
                  Pay: {pay.name} {money(pay.typicalCents)} every {pay.everyDays === 7 ? "week" : pay.everyDays === 14 ? "fortnight" : "month"}, next{" "}
                  {shortDay(pay.nextDay)}.
                </p>
              </>
            )}
          </Card>

          <Card title="Your week so far" note={`${week.days} day${week.days === 1 ? "" : "s"} in`}>
            <p className="mt-2 text-[15px] text-ink-soft">
              Spent <span className="font-semibold text-ink tabular-nums">{whole(week.rows[0]?.spentCents ?? 0)}</span>
              {week.usualCents !== null && (
                <>
                  {" "}
                  · usually <span className="tabular-nums">{whole(week.usualCents)}</span> by now
                </>
              )}
            </p>
            <div className="mt-2 flex flex-col">
              {week.rows.map((r, i) => (
                <Bar key={r.from} label={i === 0 ? "This week" : `Week of ${dayLabel(r.from, false)}`} value={whole(r.spentCents)} cents={r.spentCents} max={weekMax} />
              ))}
            </div>
          </Card>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          <h2 className={sectionLabel}>
            For the period{" "}
            <span className="font-normal tracking-normal normal-case">
              · {span.days > 0 ? `${spanText(span)}, ${span.days} day${span.days === 1 ? "" : "s"}` : "no transactions in these dates"}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
              {PERIODS.map((p) => (
                <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => choose(p.id)} className={chip(period === p.id)}>
                  {p.label}
                </button>
              ))}
              <button type="button" aria-pressed={period === "custom"} onClick={() => choose("custom")} className={chip(period === "custom")}>
                Dates…
              </button>
            </div>
            {period === "custom" && (
              <span className="flex items-center gap-1.5 text-[13.5px] text-muted">
                <input
                  type="date"
                  aria-label="From"
                  value={custom.from ?? ""}
                  onChange={(e) => choose("custom", { ...custom, from: e.target.value || null })}
                  className={dateInput}
                />
                to
                <input type="date" aria-label="To" value={custom.to ?? ""} onChange={(e) => choose("custom", { ...custom, to: e.target.value || null })} className={dateInput} />
              </span>
            )}
          </div>
        </div>

        {picked.empty ? (
          <p className={`${card} text-[14px] text-muted`}>There are no transactions in these dates. Pick another period.</p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              <Card title="What's changed" note={picked.earlier.length ? earlierWords(period, picked.earlier.length, span.days) : undefined}>
                {picked.earlier.length === 0 ? (
                  <p className="mt-2 text-[14px] text-muted">
                    {period === "all" ? "Pick a shorter period to compare it with before." : "There isn't enough history before these dates to compare yet."}
                  </p>
                ) : picked.changes.length === 0 ? (
                  <p className="mt-2 text-[14px] text-muted">Nothing much: each category is close to usual.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-line">
                    {picked.changes.map((c) => (
                      <li key={c.category} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{c.category}</span>
                          <span className="block text-[12.5px] text-muted tabular-nums">
                            {whole(c.nowCents)}, usually {whole(c.usualCents)}
                          </span>
                        </span>
                        <span className={`shrink-0 tabular-nums ${c.changeCents > 0 ? "text-red" : "text-green"}`}>{money(c.changeCents, { whole: true, sign: true })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Savings rate" note="share of money in that's left over">
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[30px] leading-tight font-semibold tracking-tight tabular-nums ${(picked.savings.total.rate ?? 0) < 0 ? "text-red" : ""}`}>
                    {percent(picked.savings.total.rate)}
                  </span>
                  <span className="text-[14px] text-muted tabular-nums">
                    in {whole(picked.savings.total.incomeCents)} · spent {whole(picked.savings.total.spentCents)} · left{" "}
                    {money(picked.savings.total.leftOverCents, { whole: true, sign: true })}
                  </span>
                </p>
                {picked.savings.total.intoSaversCents !== 0 && (
                  <p className="mt-0.5 text-[13px] text-muted tabular-nums">Savers {money(picked.savings.total.intoSaversCents, { whole: true, sign: true })} in these dates.</p>
                )}
                {picked.savings.months.length > 1 && (
                  <ul className="mt-2 divide-y divide-line border-t border-line">
                    {picked.savings.months.map((m) => (
                      <li key={m.month} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-2">
                        <span className="text-[14px] text-ink">
                          {monthName(m.month)}
                          {m.month.slice(0, 4) !== today.slice(0, 4) && <span className="text-muted"> {m.month.slice(2, 4)}</span>}
                          {m.soFar && <span className="block text-[11.5px] text-faint">so far</span>}
                        </span>
                        <span className="min-w-0 text-[12.5px] text-muted tabular-nums">
                          in {whole(m.incomeCents)} · left {money(m.leftOverCents, { whole: true, sign: true })}
                          {m.intoSaversCents !== 0 && ` · savers ${money(m.intoSaversCents, { whole: true, sign: true })}`}
                        </span>
                        <span className={`text-right text-[15px] font-semibold tabular-nums ${m.rate !== null && m.rate < 0 ? "text-red" : "text-ink"}`}>{percent(m.rate)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <BusiestDays weekdays={picked.weekdays} />
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <section aria-label="What things cost" className={card}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h3 className="text-[17px] font-bold tracking-tight">What things cost</h3>
                  <div role="group" aria-label="Show" className="flex gap-1">
                    {COST_MEASURES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={costMeasure === m.id}
                        onClick={() => setCostMeasure(m.id)}
                        className={`${chip(costMeasure === m.id)} h-8 px-2.5 text-[13px]`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {costMeasure === "total" ? "Spent in these dates." : `At the rate of these dates, ${costMeasure === "week" ? "a week" : "over a year"}.`}
                </p>
                {picked.costs.length === 0 ? (
                  <p className="mt-2 text-[14px] text-muted">No spending in these dates.</p>
                ) : (
                  <div className="mt-2 flex flex-col">
                    {picked.costs.map((r) => {
                      const measure = (c: (typeof picked.costs)[number]) => (costMeasure === "total" ? c.totalCents : costMeasure === "week" ? c.perWeekCents : c.perYearCents);
                      return <Bar key={r.category} label={r.category} value={whole(measure(r))} cents={measure(r)} max={measure(picked.costs[0])} />;
                    })}
                  </div>
                )}
              </section>

              <Habits habits={picked.habits} note={spanText(span)} onPick={showMerchant} />

              <Card title="Biggest purchases" note={spanText(span)}>
                {picked.biggest.length === 0 ? (
                  <p className="mt-2 text-[14px] text-muted">No purchases in these dates.</p>
                ) : (
                  <ul className="mt-1.5">
                    {picked.biggest.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => showMerchant(merchantName(t))}
                          className="-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-white/[0.03]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[14.5px] text-ink">{merchantName(t)}</span>
                            <span className="block truncate text-[12.5px] text-muted">
                              {shortDay(t.day)}
                              {t.category && ` · ${t.category}`}
                            </span>
                          </span>
                          <span className="text-[14.5px] text-ink tabular-nums">{money(-t.amountCents)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}

        <h2 className={`${sectionLabel} mt-2`}>Ongoing</h2>
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <Subscriptions audit={subscriptions} onPick={showMerchant} />
          <Card title="Weekly message" note="what Hermes sends on Sundays">
            <div className="mt-3 rounded-xl border border-line bg-card p-3.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
              <p className="font-semibold text-ink">{message.title}</p>
              {message.text.split("\n").slice(1).join("\n").trim()}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function BusiestDays({ weekdays }: { weekdays: { day: string; averageCents: number }[] }) {
  const max = Math.max(...weekdays.map((d) => d.averageCents), 0);
  const busiest = weekdays.reduce((a, b) => (b.averageCents > a.averageCents ? b : a), weekdays[0]);
  return (
    <Card title="Busiest days" note="average spend a day">
      {busiest && busiest.averageCents > 0 && (
        <p className="mt-2 text-[14px] text-muted">
          {DAY_NAMES[busiest.day]} are your biggest, about <span className="text-ink tabular-nums">{whole(busiest.averageCents)}</span>.
        </p>
      )}
      <div className="mt-3 flex h-28 items-end gap-2" aria-hidden="true">
        {weekdays.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${whole(d.averageCents)}`}>
            <span className="text-[11px] text-muted tabular-nums">{whole(d.averageCents)}</span>
            <span className="block w-full max-w-8 rounded-t-[4px] bg-blue" style={{ height: `${max ? Math.max((d.averageCents / max) * 70, 2) : 2}%` }} />
            <span className="text-[11px] text-faint">{d.day}</span>
          </div>
        ))}
      </div>
      <p className="sr-only">{weekdays.map((d) => `${d.day} ${whole(d.averageCents)}`).join(", ")}</p>
    </Card>
  );
}
