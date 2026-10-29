"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { MONTHS } from "@/lib/format";
import { parseDay, shortDay } from "@/lib/life/days";
import { findIssues } from "@/lib/money/checks";
import { findHabits } from "@/lib/money/habits";
import { biggestPurchases, categoryChanges, monthlySavings, nextPay, safeToSpend, weekdaySpending, weeksSoFar, yearCosts } from "@/lib/money/insights";
import { merchantName } from "@/lib/money/merchant";
import { weekStart } from "@/lib/money/periods";
import { findRecurring } from "@/lib/money/recurring";
import { expandSplits } from "@/lib/money/split";
import { auditSubscriptions } from "@/lib/money/subscriptions";
import { money, type MoneyFlag, type Rule, type Transaction } from "@/lib/money/types";
import { weeklySummary } from "@/lib/money/weekly";
import { Habits, Subscriptions } from "./insights";
import type { UpStatus } from "./up-connect";

// Money → Insights: what's safe to spend until payday, the week against a usual one, what's
// changed, the savings rate, habits, subscriptions, what each category costs a year, the
// busiest days, the biggest purchases, and the weekly message Hermes sends. All worked out
// here from the transactions; anything left out of the totals stays out.

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

const card = "rounded-2xl border border-line bg-panel p-4 md:p-5";
const whole = (cents: number) => money(cents, { whole: true });

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

/** One measure per row, so one colour; the value is always written out too. */
function Bar({ label, value, cents, max, onClick }: { label: string; value: string; cents: number; max: number; onClick?: () => void }) {
  const inner = (
    <>
      <span className="truncate text-[14px] text-ink">{label}</span>
      <span className="h-3" aria-hidden="true">
        {cents > 0 && max > 0 && <span className="block h-full rounded-r-[4px] bg-blue" style={{ width: `${Math.max((cents / max) * 100, 1.5)}%` }} />}
      </span>
      <span className="text-right text-[14px] tabular-nums text-ink">{value}</span>
    </>
  );
  const grid = "grid w-full grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-[7px] text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${grid} hover:bg-white/[0.04]`}>
      {inner}
    </button>
  ) : (
    <div className={grid}>{inner}</div>
  );
}

const monthName = (day: string) => MONTHS[parseDay(day).getMonth()];

export function InsightsPage({ transactions, up, flags, leftChecks, rules, categories, ownerName, today }: InsightsPageProps) {
  const router = useRouter();
  const showMerchant = (name: string) => router.push(`/money?merchant=${encodeURIComponent(name)}`);

  const all = useMemo(() => {
    const counted = transactions.filter((t) => !t.excluded);
    const parts = expandSplits(counted);
    const recurring = findRecurring(counted, today);
    const accounts = up?.accounts ?? [];
    const pay = nextPay(counted, today);
    const openFlags = flags.filter((f) => transactions.some((t) => t.merchantKey === f.merchantKey && t.category === f.currentCategory && !t.splits)).length;
    const openChecks = openFlags + findIssues(transactions, rules, categories, ownerName, new Set(leftChecks)).length;
    return {
      pay,
      safe: pay ? safeToSpend(accounts, recurring, pay.nextDay, today) : null,
      week: weeksSoFar(parts, weekStart(today), today),
      changes: categoryChanges(parts, today).slice(0, 8),
      savings: monthlySavings(parts, counted, new Set(accounts.filter((a) => a.type === "SAVER").map((a) => a.name)), today),
      habits: findHabits(counted, today),
      subscriptions: auditSubscriptions(counted, recurring, today),
      year: yearCosts(parts, today),
      weekdays: weekdaySpending(parts, today),
      biggest: biggestPurchases(counted, today),
      message: weeklySummary({ transactions, accounts, recurring, today, openChecks }),
      hasUp: accounts.length > 0,
    };
  }, [transactions, up, flags, leftChecks, rules, categories, ownerName, today]);

  const { pay, safe, week, changes, savings, habits, subscriptions, year, weekdays, biggest, message } = all;
  const weekMax = Math.max(...week.rows.map((r) => r.spentCents), 0);
  const yearMax = year.rows[0]?.totalCents ?? 0;
  const dayMax = Math.max(...weekdays.map((d) => d.averageCents), 0);
  const busiest = weekdays.reduce((a, b) => (b.averageCents > a.averageCents ? b : a), weekdays[0]);
  const dayNames: Record<string, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays" };

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

        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
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
                    {safe.bills.length > 0 &&
                      `, less ${money(safe.billsCents)} of bills before then (${safe.bills.map((b) => b.name).join(", ")})`}
                    .
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
                  <Bar key={r.from} label={i === 0 ? "This week" : `Week of ${parseDay(r.from).getDate()} ${monthName(r.from)}`} value={whole(r.spentCents)} cents={r.spentCents} max={weekMax} />
                ))}
              </div>
            </Card>

            <Card title="What's changed" note="this month vs your usual">
              {changes.length === 0 ? (
                <p className="mt-2 text-[14px] text-muted">Nothing much: each category is close to usual.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {changes.map((c) => (
                    <li key={c.category} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{c.category}</span>
                        <span className="block text-[12.5px] text-muted tabular-nums">
                          {whole(c.nowCents)} so far, usually {whole(c.usualCents)}
                        </span>
                      </span>
                      <span className={`shrink-0 tabular-nums ${c.changeCents > 0 ? "text-red" : "text-green"}`}>{money(c.changeCents, { whole: true, sign: true })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Savings rate" note="share of money in that's left over">
              <ul className="mt-2 divide-y divide-line">
                {savings.map((m) => (
                  <li key={m.month} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 py-2">
                    <span className="text-[14px] text-ink">
                      {monthName(m.month)}
                      {m.soFar && <span className="block text-[11.5px] text-faint">so far</span>}
                    </span>
                    <span className="min-w-0 text-[12.5px] text-muted tabular-nums">
                      in {whole(m.incomeCents)} · left {money(m.leftOverCents, { whole: true, sign: true })}
                      {m.intoSaversCents !== 0 && ` · savers ${money(m.intoSaversCents, { whole: true, sign: true })}`}
                    </span>
                    <span className={`text-right text-[15px] font-semibold tabular-nums ${m.rate !== null && m.rate < 0 ? "text-red" : "text-ink"}`}>
                      {m.rate === null ? "–" : `${Math.round(m.rate * 100)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Busiest days" note="average spend, last 90 days">
              {busiest && busiest.averageCents > 0 && (
                <p className="mt-2 text-[14px] text-muted">
                  {dayNames[busiest.day]} are your biggest, about <span className="text-ink tabular-nums">{whole(busiest.averageCents)}</span>.
                </p>
              )}
              <div className="mt-3 flex h-28 items-end gap-2" aria-hidden="true">
                {weekdays.map((d) => (
                  <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${whole(d.averageCents)}`}>
                    <span className="text-[11px] text-muted tabular-nums">{whole(d.averageCents)}</span>
                    <span className="block w-full max-w-8 rounded-t-[4px] bg-blue" style={{ height: `${dayMax ? Math.max((d.averageCents / dayMax) * 70, 2) : 2}%` }} />
                    <span className="text-[11px] text-faint">{d.day}</span>
                  </div>
                ))}
              </div>
              <p className="sr-only">{weekdays.map((d) => `${d.day} ${whole(d.averageCents)}`).join(", ")}</p>
            </Card>

            <Card title="What things cost a year" note={`this FY, from ${shortDay(year.from)}`}>
              <div className="mt-2 flex flex-col">
                {year.rows.slice(0, 12).map((r) => (
                  <Bar key={r.category} label={r.category} value={`${whole(r.totalCents)} · ${whole(r.perWeekCents)}/wk`} cents={r.totalCents} max={yearMax} />
                ))}
              </div>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Habits habits={habits} onPick={showMerchant} />
            <Subscriptions audit={subscriptions} onPick={showMerchant} />

            <Card title="Biggest purchases" note="last 90 days">
              <ul className="mt-1.5">
                {biggest.map((t) => (
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
            </Card>

            <Card title="Weekly message" note="what Hermes sends on Sundays">
              <div className="mt-3 rounded-xl border border-line bg-card p-3.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                <p className="font-semibold text-ink">{message.title}</p>
                {message.text.split("\n").slice(1).join("\n").trim()}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
