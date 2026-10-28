import { MONTHS } from "@/lib/format";
import { addDays, parseDay } from "@/lib/life/days";
import { INCOME, TRANSFERS, type Transaction } from "./types";

// Date ranges for the period picker, and the totals worked out over them.
// Safe in the browser and on the server.

export type PeriodId = "week" | "last-week" | "month" | "last-month" | "3m" | "12m" | "fy" | "all" | "custom";

export const PERIODS: { id: Exclude<PeriodId, "custom">; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "last-week", label: "Last week" },
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "3m", label: "3 months" },
  { id: "12m", label: "12 months" },
  { id: "fy", label: "This FY" },
  { id: "all", label: "All" },
];

/** Inclusive day keys; null is open-ended. */
export interface Range {
  from: string | null;
  to: string | null;
}

export const inRange = (day: string, r: Range) => (!r.from || day >= r.from) && (!r.to || day <= r.to);

const pad = (n: number) => String(n).padStart(2, "0");
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** First day of the month `offset` months from `day`'s month. */
export function monthStart(day: string, offset = 0) {
  const d = parseDay(day);
  return key(new Date(d.getFullYear(), d.getMonth() + offset, 1));
}

export function monthEnd(day: string, offset = 0) {
  const d = parseDay(day);
  return key(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0));
}

/** "Oct 2026" */
export function monthLabel(day: string) {
  const d = parseDay(day);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The Monday of `day`'s week, `offset` weeks on. Weeks run Monday to Sunday. */
export function weekStart(day: string, offset = 0) {
  return addDays(day, -((parseDay(day).getDay() + 6) % 7) + offset * 7);
}

/** "Week of 20 Oct" */
export function weekLabel(monday: string) {
  const d = parseDay(monday);
  return `Week of ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Australian financial year: 1 July to 30 June. */
function fyStart(day: string) {
  const d = parseDay(day);
  return `${d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1}-07-01`;
}

const shiftYear = (day: string, years: number) => `${Number(day.slice(0, 4)) + years}${day.slice(4)}`;
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

export function periodRange(id: PeriodId, today: string, custom: Range): Range {
  switch (id) {
    case "week":
      return { from: weekStart(today), to: today };
    case "last-week":
      return { from: weekStart(today, -1), to: addDays(weekStart(today), -1) };
    case "month":
      return { from: monthStart(today), to: today };
    case "last-month":
      return { from: monthStart(today, -1), to: monthEnd(today, -1) };
    case "3m":
      return { from: addDays(today, -89), to: today };
    case "12m":
      return { from: addDays(today, -364), to: today };
    case "fy":
      return { from: fyStart(today), to: today };
    case "custom":
      return custom;
    case "all":
      return { from: null, to: null };
  }
}

/** The span to compare against, like for like. Null when there's nothing fair to compare. */
export function previousRange(id: PeriodId, today: string, custom: Range): { range: Range; label: string } | null {
  switch (id) {
    case "week":
      return { range: { from: weekStart(today, -1), to: addDays(today, -7) }, label: "this time last week" };
    case "last-week":
      return { range: { from: weekStart(today, -2), to: addDays(weekStart(today, -1), -1) }, label: "the week before" };
    case "month": {
      // Month to date against the same days of last month.
      const from = monthStart(today, -1);
      const to = addDays(from, Math.min(parseDay(today).getDate() - 1, daysBetween(from, monthEnd(today, -1))));
      return { range: { from, to }, label: "this time last month" };
    }
    case "last-month":
      return { range: { from: monthStart(today, -2), to: monthEnd(today, -2) }, label: MONTHS[parseDay(monthStart(today, -2)).getMonth()] };
    case "3m":
      return { range: { from: addDays(today, -179), to: addDays(today, -90) }, label: "the 3 months before" };
    case "12m":
      return { range: { from: addDays(today, -729), to: addDays(today, -365) }, label: "the 12 months before" };
    case "fy":
      return { range: { from: shiftYear(fyStart(today), -1), to: shiftYear(today, -1) }, label: "this time last FY" };
    case "custom": {
      if (!custom.from || !custom.to) return null;
      const length = daysBetween(custom.from, custom.to) + 1;
      return { range: { from: addDays(custom.from, -length), to: addDays(custom.from, -1) }, label: `the ${length} days before` };
    }
    case "all":
      return null;
  }
}

// ---- Totals ------------------------------------------------------------------------

/**
 * How a transaction counts. Transfers are neither spending nor income. Unsorted money
 * in counts as income until it's sorted; a refund (money in, sorted to a shop's
 * category) lowers that category's spending.
 */
export function kindOf(t: Transaction): "spend" | "income" | "transfer" {
  if (t.category === TRANSFERS) return "transfer";
  if (t.category === INCOME || (t.category === null && t.amountCents > 0)) return "income";
  return "spend";
}

export interface Summary {
  spentCents: number;
  incomeCents: number;
  netCents: number;
  /** Spending per category, with unsorted spending under null. */
  byCategory: Map<string | null, number>;
}

export function summarise(transactions: Transaction[]): Summary {
  let spent = 0;
  let income = 0;
  const byCategory = new Map<string | null, number>();
  for (const t of transactions) {
    const kind = kindOf(t);
    if (kind === "income") income += t.amountCents;
    if (kind !== "spend") continue;
    spent -= t.amountCents;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) - t.amountCents);
  }
  return { spentCents: spent, incomeCents: income, netCents: income - spent, byCategory };
}

/** One bar of the spending chart: a month or a week, both ends inclusive. */
export interface Bucket {
  from: string;
  to: string;
  cents: number;
}

/** Spending per month for the 12 months ending with `lastMonth`'s month, oldest first. */
export function monthlySpending(transactions: Transaction[], lastMonth: string): Bucket[] {
  const months = Array.from({ length: 12 }, (_, i) => monthStart(lastMonth, i - 11));
  const totals = new Map(months.map((m) => [m.slice(0, 7), 0]));
  for (const t of transactions) {
    const month = t.day.slice(0, 7);
    if (totals.has(month) && kindOf(t) === "spend") totals.set(month, totals.get(month)! - t.amountCents);
  }
  return months.map((m) => ({ from: m, to: monthEnd(m), cents: totals.get(m.slice(0, 7))! }));
}

/** Spending per week for the 12 weeks ending with `lastWeek`'s week, oldest first. */
export function weeklySpending(transactions: Transaction[], lastWeek: string): Bucket[] {
  const weeks = Array.from({ length: 12 }, (_, i) => weekStart(lastWeek, i - 11));
  const totals = new Map(weeks.map((w) => [w, 0]));
  for (const t of transactions) {
    const week = weekStart(t.day);
    if (totals.has(week) && kindOf(t) === "spend") totals.set(week, totals.get(week)! - t.amountCents);
  }
  return weeks.map((w) => ({ from: w, to: addDays(w, 6), cents: totals.get(w)! }));
}
