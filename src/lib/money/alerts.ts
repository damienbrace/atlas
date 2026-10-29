import { addDays, parseDay, shortDay } from "@/lib/life/days";
import type { AccountBalance } from "./accounts";
import { personMessage } from "./checks";
import { nextPay, safeToSpend } from "./insights";
import { merchantName } from "./merchant";
import { kindOf } from "./periods";
import type { Recurring } from "./recurring";
import { auditSubscriptions } from "./subscriptions";
import { money, type Transaction } from "./types";

// Things worth a Telegram message as they happen: a charge much bigger than usual at a
// business, a big first charge somewhere new, what looks like being charged twice, a
// subscription or bill going up, a new subscription, and Spending running low before pay.
// Each has a key, so it's only ever sent once. Safe in the browser and on the server.

/** Only payments this recent raise an alert, so old history never floods in. */
export const RECENT_DAYS = 3;
/** Other payments at a business needed to know what's usual there… */
const MIN_HISTORY = 4;
/** …looked for over this many days. */
const HISTORY_DAYS = 180;
/** Much bigger than usual: this many times the usual charge… */
const UNUSUAL_TIMES = 3;
/** …and at least this much more. */
const UNUSUAL_EXTRA_CENTS = 5000;
/** A first ever charge somewhere this big. */
const NEW_BIG_CENTS = 30000;
/** The same amount at the same place within a day, at least this much. */
const DOUBLE_MIN_CENTS = 2000;
/** Bills move around, so one needs to rise this much (and $10) to count. */
const BILL_RISE = 1.2;
const BILL_RISE_CENTS = 1000;
/** Safe to spend under this before pay comes in. */
const LOW_CENTS = 10000;

export type AlertKind = "unusual" | "new-big" | "double" | "rise" | "new-subscription" | "low" | "review";

export interface MoneyAlert {
  /** The same thing always has the same key, so it's only sent once. */
  key: string;
  kind: AlertKind;
  day: string;
  text: string;
}

/** An alert as saved: when it was raised, and when Hermes took it (null until then). */
export interface StoredAlert extends MoneyAlert {
  createdAt: number;
  sentAt: number | null;
}

interface AlertInput {
  /** Transactions counted in the totals (anything left out stays quiet). */
  transactions: Transaction[];
  accounts: AccountBalance[];
  recurring: Recurring[];
  today: string;
}

/** Money spent at a business: not a transfer, and not a payment to a person. */
export const isPurchase = (t: Transaction) =>
  t.amountCents < 0 && kindOf(t) === "spend" && !personMessage(t) && !/^transfer (to|from) /i.test(merchantName(t));

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const daysApart = (a: string, b: string) => Math.abs(Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000));

export function findAlerts({ transactions, accounts, recurring, today }: AlertInput): MoneyAlert[] {
  const from = addDays(today, -(RECENT_DAYS - 1));
  const historyFrom = addDays(today, -HISTORY_DAYS);
  const purchases = transactions.filter((t) => isPurchase(t) && t.day <= today);
  const byKey = new Map<string, Transaction[]>();
  for (const t of purchases) byKey.set(t.merchantKey, [...(byKey.get(t.merchantKey) ?? []), t]);
  const recent = purchases.filter((t) => t.day >= from);
  const alerts: MoneyAlert[] = [];

  // Much bigger than usual at a business, or a big first charge somewhere new.
  for (const t of recent) {
    const cents = -t.amountCents;
    const others = (byKey.get(t.merchantKey) ?? []).filter((o) => o.id !== t.id);
    const name = merchantName(t);
    if (others.length === 0 && cents >= NEW_BIG_CENTS) {
      alerts.push({ key: `new-big:${t.id}`, kind: "new-big", day: t.day, text: `*Big first charge:* ${name} ${money(cents)} on ${shortDay(t.day)}. Atlas hasn't seen them before.` });
      continue;
    }
    const usual = others.filter((o) => o.day >= historyFrom).map((o) => -o.amountCents);
    if (usual.length < MIN_HISTORY) continue;
    const typical = median(usual);
    if (cents >= typical * UNUSUAL_TIMES && cents - typical >= UNUSUAL_EXTRA_CENTS) {
      alerts.push({ key: `unusual:${t.id}`, kind: "unusual", day: t.day, text: `*Unusual charge:* ${name} ${money(cents)} on ${shortDay(t.day)}, usually about ${money(typical, { whole: true })}.` });
    }
  }

  // The same amount at the same place within a day: maybe charged twice.
  const seen = new Set<string>();
  for (const t of recent) {
    if (-t.amountCents < DOUBLE_MIN_CENTS) continue;
    for (const o of byKey.get(t.merchantKey) ?? []) {
      if (o.id === t.id || o.amountCents !== t.amountCents || daysApart(o.day, t.day) > 1) continue;
      const [a, b] = [t, o].sort((x, y) => x.day.localeCompare(y.day) || x.id.localeCompare(y.id));
      const key = `double:${a.id}:${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const when = a.day === b.day ? `twice on ${shortDay(a.day)}` : `on ${shortDay(a.day)} and ${shortDay(b.day)}`;
      alerts.push({ key, kind: "double", day: b.day, text: `*Charged twice?* ${merchantName(t)} ${money(-t.amountCents)} ${when}.` });
    }
  }

  // A subscription or bill gone up. Bills move around, so they need a bigger jump.
  for (const r of recurring) {
    if (!r.rose || r.lastDay < from || r.lastDay > today) continue;
    if (r.category === "Bills & utilities" && (r.lastCents < r.typicalCents * BILL_RISE || r.lastCents - r.typicalCents < BILL_RISE_CENTS)) continue;
    alerts.push({ key: `rise:${r.key}:${r.lastDay}`, kind: "rise", day: r.lastDay, text: `*Price rise:* ${r.name} ${money(r.lastCents)}, usually ${money(r.typicalCents)}.` });
  }

  // A new subscription (a free trial turning into a charge, say).
  for (const s of auditSubscriptions(transactions, recurring, today).subscriptions) {
    if (s.firstDay < from) continue;
    const first = transactions.find((t) => t.day === s.firstDay && t.amountCents < 0 && merchantName(t) === s.name);
    alerts.push({
      key: `new-subscription:${s.name}`,
      kind: "new-subscription",
      day: s.firstDay,
      text: `*New subscription:* ${s.name}${first ? `, first charge ${money(-first.amountCents)}` : ""} on ${shortDay(s.firstDay)}.`,
    });
  }

  // Spending running low before pay comes in: once a pay cycle.
  const pay = nextPay(transactions, today);
  const safe = pay ? safeToSpend(accounts, recurring, pay.nextDay, today) : null;
  if (pay && safe && safe.safeCents < LOW_CENTS) {
    const bills = safe.billsCents > 0 ? `, with ${money(safe.billsCents)} of bills due before pay on ${shortDay(pay.nextDay)}` : ` until pay on ${shortDay(pay.nextDay)}`;
    alerts.push({
      key: `low:${pay.nextDay}`,
      kind: "low",
      day: today,
      text: `*Running low:* Spending ${money(safe.balanceCents)}${bills}. That leaves ${money(safe.safeCents)} for ${safe.days} day${safe.days === 1 ? "" : "s"}.`,
    });
  }

  return alerts.sort((a, b) => a.day.localeCompare(b.day));
}
