import { addDays, parseDay } from "@/lib/life/days";
import type { AccountBalance } from "./accounts";
import { merchantName } from "./merchant";
import { inRange, kindOf, monthEnd, monthStart, periodRange, summarise } from "./periods";
import type { Recurring } from "./recurring";
import { INCOME, type Transaction } from "./types";

// The Insights page's numbers: when pay comes and what's safe to spend until then, what's
// changed this month, the savings rate, what each category costs a year, the busiest days
// and the biggest purchases. Everything takes transactions already counted in the totals
// (and split payments as their parts, where it adds up by category). Safe in the browser
// and on the server.

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
const earliestDay = (transactions: Transaction[], today: string) => transactions.reduce((min, t) => (t.day < min ? t.day : min), today);

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---- Pay day and what's safe to spend ------------------------------------------------------

/** Schedules pay can come on, as the typical gap in days. */
const PAY_GAPS: { days: number; min: number; max: number }[] = [
  { days: 7, min: 6, max: 8 },
  { days: 14, min: 13, max: 16 },
  { days: 30, min: 26, max: 35 },
];

/** The biggest regular money in (my drawings come weekly), and when it's next due. */
export function nextPay(transactions: Transaction[], today: string) {
  const from = addDays(today, -120);
  const bySource = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.category !== INCOME || t.amountCents <= 0 || t.day < from || t.day > today) continue;
    const name = merchantName(t);
    bySource.set(name, [...(bySource.get(name) ?? []), t]);
  }
  let best: { name: string; typicalCents: number; everyDays: number; lastDay: string; perMonth: number } | null = null;
  for (const [name, list] of bySource) {
    if (list.length < 3) continue;
    const days = list.map((t) => t.day).sort();
    const gap = median(days.slice(1).map((d, i) => daysBetween(days[i], d)));
    const schedule = PAY_GAPS.find((g) => gap >= g.min && gap <= g.max);
    if (!schedule) continue;
    const typicalCents = median(list.map((t) => t.amountCents));
    const perMonth = (typicalCents * 30) / schedule.days;
    if (!best || perMonth > best.perMonth) best = { name, typicalCents, everyDays: schedule.days, lastDay: days.at(-1)!, perMonth };
  }
  if (!best) return null;
  let nextDay = addDays(best.lastDay, best.everyDays);
  while (nextDay < today) nextDay = addDays(nextDay, best.everyDays);
  return { name: best.name, typicalCents: best.typicalCents, everyDays: best.everyDays, nextDay };
}

/** My own Spending, less the repeat bills due before pay comes in, spread over the days until then. */
export function safeToSpend(accounts: AccountBalance[], recurring: Recurring[], payDay: string, today: string) {
  const spending = accounts.filter((a) => a.type === "TRANSACTIONAL" && !a.joint && !/^2up\b/i.test(a.name));
  if (spending.length === 0) return null;
  const balanceCents = spending.reduce((sum, a) => sum + a.balanceCents, 0);
  const bills = recurring.filter((r) => r.nextDay >= today && r.nextDay < payDay).sort((a, b) => a.nextDay.localeCompare(b.nextDay));
  const billsCents = bills.reduce((sum, r) => sum + r.typicalCents, 0);
  const days = Math.max(daysBetween(today, payDay), 1);
  const safeCents = balanceCents - billsCents;
  return { balanceCents, bills, billsCents, safeCents, days, perDayCents: Math.floor(safeCents / days) };
}

// ---- This week against usual -----------------------------------------------------------------

/** Spending for the same days of each week: this week so far, then up to 8 weeks before, newest first. */
export function weeksSoFar(parts: Transaction[], weekFrom: string, today: string, weeks = 8) {
  const days = daysBetween(weekFrom, today) + 1;
  const earliest = earliestDay(parts, today);
  const rows: { from: string; spentCents: number }[] = [];
  for (let i = 0; i <= weeks; i++) {
    const from = addDays(weekFrom, -7 * i);
    if (i > 0 && from < earliest) break;
    rows.push({ from, spentCents: summarise(parts.filter((t) => inRange(t.day, { from, to: addDays(from, days - 1) }))).spentCents });
  }
  const past = rows.slice(1).map((r) => r.spentCents);
  return { days, rows, usualCents: past.length ? median(past) : null };
}

// ---- What's changed this month ---------------------------------------------------------------

/** Each category this month so far against the same days of the last 3 months, biggest moves first. */
export function categoryChanges(parts: Transaction[], today: string, minChangeCents = 2000) {
  const dayOfMonth = parseDay(today).getDate();
  const earliest = earliestDay(parts, today);
  const now = summarise(parts.filter((t) => inRange(t.day, { from: monthStart(today), to: today }))).byCategory;
  const before: Map<string | null, number>[] = [];
  for (let k = 1; k <= 3; k++) {
    const from = monthStart(today, -k);
    if (from < earliest) break;
    const end = addDays(from, dayOfMonth - 1);
    const to = end > monthEnd(from) ? monthEnd(from) : end;
    before.push(summarise(parts.filter((t) => inRange(t.day, { from, to }))).byCategory);
  }
  if (before.length === 0) return [];
  const categories = new Set([...now.keys(), ...before.flatMap((m) => [...m.keys()])]);
  return [...categories]
    .map((category) => {
      const nowCents = now.get(category) ?? 0;
      const usualCents = Math.round(before.reduce((sum, m) => sum + (m.get(category) ?? 0), 0) / before.length);
      return { category: category ?? "Not sorted", nowCents, usualCents, changeCents: nowCents - usualCents };
    })
    .filter((c) => Math.abs(c.changeCents) >= minChangeCents)
    .sort((a, b) => Math.abs(b.changeCents) - Math.abs(a.changeCents));
}

// ---- Savings rate ------------------------------------------------------------------------------

/** The last few months: money in, spent, left over, what went into savers, and the share of pay kept. */
export function monthlySavings(parts: Transaction[], counted: Transaction[], saverNames: Set<string>, today: string, months = 6) {
  const earliest = earliestDay(parts, today);
  const rows = [];
  for (let k = months - 1; k >= 0; k--) {
    const from = monthStart(today, -k);
    if (monthEnd(from) < earliest) continue;
    const to = k === 0 ? today : monthEnd(from);
    const s = summarise(parts.filter((t) => inRange(t.day, { from, to })));
    const intoSaversCents = counted.filter((t) => saverNames.has(t.account) && inRange(t.day, { from, to })).reduce((sum, t) => sum + t.amountCents, 0);
    rows.push({
      month: from,
      soFar: k === 0,
      incomeCents: s.incomeCents,
      spentCents: s.spentCents,
      leftOverCents: s.netCents,
      intoSaversCents,
      rate: s.incomeCents > 0 ? s.netCents / s.incomeCents : null,
    });
  }
  return rows;
}

// ---- What things cost a year -----------------------------------------------------------------

/** Each category's spending this financial year, and what that is a week. */
export function yearCosts(parts: Transaction[], today: string) {
  const from = periodRange("fy", today, { from: null, to: null }).from!;
  const start = earliestDay(parts, today) > from ? earliestDay(parts, today) : from;
  const weeks = (daysBetween(start, today) + 1) / 7;
  const byCategory = summarise(parts.filter((t) => inRange(t.day, { from, to: today }))).byCategory;
  return {
    from,
    rows: [...byCategory.entries()]
      .filter(([, cents]) => cents > 0)
      .map(([category, totalCents]) => ({ category: category ?? "Not sorted", totalCents, perWeekCents: Math.round(totalCents / Math.max(weeks, 1)) }))
      .sort((a, b) => b.totalCents - a.totalCents),
  };
}

// ---- Busiest days ------------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Average spending on each day of the week over the last 90 days (or the days there are). */
export function weekdaySpending(parts: Transaction[], today: string, windowDays = 90) {
  let from = addDays(today, -(windowDays - 1));
  const earliest = earliestDay(parts, today);
  if (earliest > from) from = earliest;
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (let d = from; d <= today; d = addDays(d, 1)) counts[(parseDay(d).getDay() + 6) % 7]++;
  for (const t of parts) {
    if (!inRange(t.day, { from, to: today }) || kindOf(t) !== "spend") continue;
    totals[(parseDay(t.day).getDay() + 6) % 7] -= t.amountCents;
  }
  return WEEKDAYS.map((day, i) => ({ day, averageCents: counts[i] ? Math.round(totals[i] / counts[i]) : 0 }));
}

// ---- Biggest purchases ---------------------------------------------------------------------------

export function biggestPurchases(counted: Transaction[], today: string, windowDays = 90, count = 8) {
  const from = addDays(today, -(windowDays - 1));
  return counted
    .filter((t) => t.day >= from && t.day <= today && t.amountCents < 0 && kindOf(t) === "spend")
    .sort((a, b) => a.amountCents - b.amountCents)
    .slice(0, count);
}
