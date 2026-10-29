import { addDays, parseDay } from "@/lib/life/days";
import type { AccountBalance } from "./accounts";
import { merchantName } from "./merchant";
import { inRange, kindOf, monthEnd, monthStart, periodRange, summarise, weekStart, type PeriodId, type Range } from "./periods";
import type { Recurring } from "./recurring";
import { INCOME, type Transaction } from "./types";

// The Insights page's numbers: when pay comes and what's safe to spend until then, the week
// against a usual one, and for whatever period is picked: what's changed, the savings rate,
// what each category costs, the busiest days and the biggest purchases. Everything takes
// transactions already counted in the totals (and split payments as their parts, where it
// adds up by category). Safe in the browser and on the server.

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / DAY_MS);
const earliestDay = (transactions: Transaction[], today: string) => transactions.reduce((min, t) => (t.day < min ? t.day : min), today);
const shiftYear = (day: string, years: number) => `${Number(day.slice(0, 4)) + years}${day.slice(4)}`;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Inclusive days, both ends known. */
export interface DaySpan {
  from: string;
  to: string;
}

// ---- The period picked -----------------------------------------------------------------------

/** A period's days, cut to the history there is and to today. `days` is 0 when nothing's left. */
export function periodSpan(range: Range, transactions: Transaction[], today: string): DaySpan & { days: number } {
  const earliest = earliestDay(transactions, today);
  const from = range.from && range.from > earliest ? range.from : earliest;
  const to = range.to && range.to < today ? range.to : today;
  return { from, to, days: Math.max(daysBetween(from, to) + 1, 0) };
}

/**
 * Up to `count` spans just before the period, each the same shape (the same days of earlier
 * weeks, months or years, or back-to-back spans as long), stopping where the history runs out.
 */
export function earlierSpans(id: PeriodId, today: string, custom: Range, earliest: string, count = 3): DaySpan[] {
  const range = periodRange(id, today, custom);
  const spans: DaySpan[] = [];
  for (let k = 1; k <= count; k++) {
    let span: DaySpan | null = null;
    if (id === "week") span = { from: weekStart(today, -k), to: addDays(today, -7 * k) };
    else if (id === "last-week") span = { from: weekStart(today, -1 - k), to: addDays(weekStart(today, -1 - k), 6) };
    else if (id === "month") {
      const from = monthStart(today, -k);
      const to = addDays(from, parseDay(today).getDate() - 1);
      span = { from, to: to > monthEnd(from) ? monthEnd(from) : to };
    } else if (id === "last-month") span = { from: monthStart(today, -1 - k), to: monthEnd(today, -1 - k) };
    else if (id === "fy") span = { from: shiftYear(range.from!, -k), to: shiftYear(today, -k) };
    else if (id !== "all" && range.from && range.to) {
      const length = daysBetween(range.from, range.to) + 1;
      span = { from: addDays(range.from, -length * k), to: addDays(range.from, -length * (k - 1) - 1) };
    }
    if (!span || span.from < earliest) break;
    spans.push(span);
  }
  return spans;
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

// ---- What's changed ------------------------------------------------------------------------------

/** Each category in the period against its average over the spans before, biggest moves first. */
export function categoryChanges(parts: Transaction[], span: DaySpan, earlier: DaySpan[], minChangeCents = 2000) {
  if (earlier.length === 0) return [];
  const now = summarise(parts.filter((t) => inRange(t.day, span))).byCategory;
  const before = earlier.map((r) => summarise(parts.filter((t) => inRange(t.day, r))).byCategory);
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

/** A month counts when this many of its days are in the period (or it's this month, so far). */
const MONTH_MIN_DAYS = 15;
const MAX_MONTHS = 12;

/**
 * Money in, spent, left over and into savers over the period, and the share of pay kept. Then
 * the same for each month mostly inside it (whole months, the latest 12).
 */
export function savingsRate(parts: Transaction[], counted: Transaction[], saverNames: Set<string>, span: DaySpan, today: string) {
  const over = (from: string, to: string) => {
    const s = summarise(parts.filter((t) => inRange(t.day, { from, to })));
    const intoSaversCents = counted.filter((t) => saverNames.has(t.account) && inRange(t.day, { from, to })).reduce((sum, t) => sum + t.amountCents, 0);
    return {
      incomeCents: s.incomeCents,
      spentCents: s.spentCents,
      leftOverCents: s.netCents,
      intoSaversCents,
      rate: s.incomeCents > 0 ? s.netCents / s.incomeCents : null,
    };
  };
  const months = [];
  for (let from = monthStart(span.from); from <= span.to; from = monthStart(from, 1)) {
    const end = monthEnd(from);
    const inside = daysBetween(from > span.from ? from : span.from, end < span.to ? end : span.to) + 1;
    const thisMonth = from === monthStart(today) && span.to === today;
    if (inside < MONTH_MIN_DAYS && !thisMonth) continue;
    months.push({ month: from, soFar: end > today, ...over(from, end < today ? end : today) });
  }
  return { total: over(span.from, span.to), months: months.slice(-MAX_MONTHS) };
}

// ---- What things cost --------------------------------------------------------------------------

/** Each category's spending over the period, and what that comes to a week and a year at this rate. */
export function categoryCosts(parts: Transaction[], span: DaySpan & { days: number }) {
  const days = Math.max(span.days, 1);
  const byCategory = summarise(parts.filter((t) => inRange(t.day, span))).byCategory;
  return [...byCategory.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([category, totalCents]) => ({
      category: category ?? "Not sorted",
      totalCents,
      perWeekCents: Math.round((totalCents / days) * 7),
      perYearCents: Math.round((totalCents / days) * 365),
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

// ---- Busiest days ------------------------------------------------------------------------------

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Average spending on each day of the week over the period. */
export function weekdaySpending(parts: Transaction[], span: DaySpan) {
  const totals = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (let d = span.from; d <= span.to; d = addDays(d, 1)) counts[(parseDay(d).getDay() + 6) % 7]++;
  for (const t of parts) {
    if (!inRange(t.day, span) || kindOf(t) !== "spend") continue;
    totals[(parseDay(t.day).getDay() + 6) % 7] -= t.amountCents;
  }
  return WEEKDAYS.map((day, i) => ({ day, averageCents: counts[i] ? Math.round(totals[i] / counts[i]) : 0 }));
}

// ---- Biggest purchases ---------------------------------------------------------------------------

export function biggestPurchases(counted: Transaction[], span: DaySpan, count = 8) {
  return counted
    .filter((t) => inRange(t.day, span) && t.amountCents < 0 && kindOf(t) === "spend")
    .sort((a, b) => a.amountCents - b.amountCents)
    .slice(0, count);
}
