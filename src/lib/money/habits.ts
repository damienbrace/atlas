import { addDays, parseDay } from "@/lib/life/days";
import { personMessage } from "./checks";
import { merchantName } from "./merchant";
import { kindOf } from "./periods";
import type { Transaction } from "./types";

// Small spends that happen often (coffee, takeaway, the bottle shop), with what they come to
// over a year at the rate of the last 90 days. The point is to make the drip visible.
// Safe in the browser and on the server.

/** Where habits live; groceries, bills and the like are needs, not habits. */
const HABIT_CATEGORIES = new Set(["Eating out", "Alcohol", "Entertainment", "Shopping", "Other"]);
const WINDOW_DAYS = 90;
const MIN_VISITS = 4;
/** A habit is a small spend: usually this much or less. */
const MAX_TYPICAL_CENTS = 4000;

export interface Habit {
  name: string;
  category: string;
  visits: number;
  perWeek: number;
  typicalCents: number;
  spentCents: number;
  /** At this rate, over a year. */
  yearCents: number;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

/** The habits of the last 90 days, dearest per year first. Payments to people don't count. */
export function findHabits(transactions: Transaction[], today: string): Habit[] {
  let from = addDays(today, -(WINDOW_DAYS - 1));
  // A shorter history is spread over the days it actually covers.
  const earliest = transactions.reduce((min, t) => (t.day < min ? t.day : min), today);
  if (earliest > from) from = earliest;
  const days = daysBetween(from, today) + 1;

  const byName = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.day < from || t.day > today || t.excluded || t.amountCents >= 0 || kindOf(t) !== "spend") continue;
    if (!HABIT_CATEGORIES.has(t.category ?? "") || personMessage(t) || /^transfer (to|from) /i.test(merchantName(t))) continue;
    const name = merchantName(t);
    byName.set(name, [...(byName.get(name) ?? []), t]);
  }

  const habits: Habit[] = [];
  for (const [name, group] of byName) {
    const amounts = group.map((t) => -t.amountCents);
    const typicalCents = median(amounts);
    if (group.length < MIN_VISITS || typicalCents > MAX_TYPICAL_CENTS) continue;
    const spentCents = amounts.reduce((sum, a) => sum + a, 0);
    habits.push({
      name,
      category: group[0].category!,
      visits: group.length,
      perWeek: (group.length / days) * 7,
      typicalCents,
      spentCents,
      yearCents: Math.round((spentCents / days) * 365),
    });
  }
  return habits.sort((a, b) => b.yearCents - a.yearCents);
}
