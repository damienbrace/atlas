import { addDays, parseDay } from "@/lib/life/days";
import { titleCase } from "./merchant";
import { TRANSFERS, type Transaction } from "./types";

// Finds charges that repeat on a schedule (subscriptions, bills, memberships) from the
// transactions alone. Safe in the browser and on the server.

export type Cadence = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

const CADENCES: { id: Cadence; days: number; min: number; max: number; perMonth: number }[] = [
  { id: "weekly", days: 7, min: 6, max: 8, perMonth: 52 / 12 },
  { id: "fortnightly", days: 14, min: 13, max: 16, perMonth: 26 / 12 },
  { id: "monthly", days: 30, min: 26, max: 35, perMonth: 1 },
  { id: "quarterly", days: 91, min: 84, max: 98, perMonth: 1 / 3 },
  { id: "yearly", days: 365, min: 350, max: 380, perMonth: 1 / 12 },
];

/** Categories whose repeat charges count even when the amount moves around. */
const BILL_CATEGORIES = new Set(["Bills & utilities", "Subscriptions"]);

export interface Recurring {
  key: string;
  name: string;
  category: string | null;
  cadence: Cadence;
  /** Usual charge, as a positive number of cents. */
  typicalCents: number;
  /** What it costs per month on average. */
  monthlyCents: number;
  lastDay: string;
  lastCents: number;
  nextDay: string;
  count: number;
  /** The latest charge is at least 5% above the usual one. */
  rose: boolean;
}

const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Share of values within `tolerance` (0.35 = ±35%) of `centre`. */
const shareNear = (values: number[], centre: number, tolerance: number) =>
  values.filter((v) => Math.abs(v - centre) <= centre * tolerance).length / values.length;

/** Repeat charges that still look active today, dearest per month first. */
export function findRecurring(transactions: Transaction[], today: string): Recurring[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amountCents >= 0 || t.category === TRANSFERS) continue;
    groups.set(t.merchantKey, [...(groups.get(t.merchantKey) ?? []), t]);
  }

  const found: Recurring[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const charges = [...list].sort((a, b) => a.day.localeCompare(b.day));
    const gaps = charges.slice(1).map((t, i) => daysBetween(charges[i].day, t.day));
    const cadence = CADENCES.find((c) => {
      const typicalGap = median(gaps);
      return typicalGap >= c.min && typicalGap <= c.max;
    });
    if (!cadence) continue;
    // Yearly needs two charges; everything else three, so a coincidence isn't a subscription.
    if (charges.length < (cadence.id === "yearly" ? 2 : 3)) continue;
    // Most gaps should fit the schedule (one missed or late payment is fine).
    if (gaps.filter((g) => g >= cadence.min && g <= cadence.max).length / gaps.length < 0.6) continue;

    const amounts = charges.map((t) => -t.amountCents);
    const typical = median(amounts);
    // Subscriptions charge the same each time; bills vary a little. Weekly groceries and
    // fuel repeat too, but they're shopping, not a commitment, so they don't count.
    const fixed = shareNear(amounts, typical, 0.05) >= 0.6;
    const bill = BILL_CATEGORIES.has(charges.at(-1)!.category ?? "") && shareNear(amounts, typical, 0.35) >= 0.6;
    if (typical < 100 || (!fixed && !bill)) continue;

    const last = charges.at(-1)!;
    // Stopped if it's well overdue.
    if (daysBetween(last.day, today) > cadence.max * 1.5) continue;

    const earlier = amounts.slice(0, -1);
    const lastCents = -last.amountCents;
    found.push({
      key,
      name: last.merchant ?? titleCase(key),
      category: last.category,
      cadence: cadence.id,
      typicalCents: typical,
      monthlyCents: Math.round(typical * cadence.perMonth),
      lastDay: last.day,
      lastCents,
      nextDay: addDays(last.day, cadence.days),
      count: charges.length,
      rose: earlier.length > 0 && lastCents >= median(earlier) * 1.05 && lastCents - median(earlier) >= 100,
    });
  }
  return found.sort((a, b) => b.monthlyCents - a.monthlyCents);
}
