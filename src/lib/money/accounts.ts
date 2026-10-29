import { addDays } from "@/lib/life/days";
import { inRange, type Range } from "./periods";
import type { Recurring } from "./recurring";
import type { Transaction } from "./types";

// What Up's accounts add to the Money page: balances, what went into each saver (and how
// much of that was round-ups), what's still pending, and what my own Spending has left once
// the repeat bills due this week come out (a joint 2Up account isn't counted for that).
// Safe in the browser and on the server.

export interface AccountBalance {
  name: string;
  /** TRANSACTIONAL (Spending), SAVER or HOME_LOAN. */
  type: string;
  balanceCents: number;
  /** Shared with someone (Up's 2Up). */
  joint?: boolean;
}

/** Up says which accounts are joint; before it has, a 2Up account's name gives it away. */
const isJoint = (a: AccountBalance) => a.joint === true || /^2up\b/i.test(a.name);

/** Days ahead that count as "this week" for bills. */
const BILL_DAYS = 7;
const ROUND_UP = /^round ?up$/i;

export function accountInsights(accounts: AccountBalance[], transactions: Transaction[], range: Range, recurring: Recurring[], today: string) {
  const spending = accounts.filter((a) => a.type === "TRANSACTIONAL");
  const savers = accounts.filter((a) => a.type === "SAVER");
  const others = accounts.filter((a) => a.type !== "TRANSACTIONAL" && a.type !== "SAVER");
  const saverNames = new Set(savers.map((s) => s.name));
  const spendingNames = new Set(spending.map((a) => a.name));

  // Into each saver over the period, net of anything taken back out.
  const added = new Map<string, number>();
  let roundUpCents = 0;
  for (const t of transactions) {
    if (!saverNames.has(t.account) || !inRange(t.day, range)) continue;
    added.set(t.account, (added.get(t.account) ?? 0) + t.amountCents);
    if (ROUND_UP.test(t.description)) roundUpCents += t.amountCents;
  }

  // Up's balance already takes held payments off; this is just how much of it is pending.
  const pending = new Map<string, number>();
  for (const t of transactions) {
    if (t.status === "HELD" && spendingNames.has(t.account)) pending.set(t.account, (pending.get(t.account) ?? 0) + t.amountCents);
  }

  const billsBy = addDays(today, BILL_DAYS);
  const bills = recurring.filter((r) => r.nextDay >= today && r.nextDay <= billsBy).sort((a, b) => a.nextDay.localeCompare(b.nextDay));
  const billsCents = bills.reduce((sum, r) => sum + r.typicalCents, 0);
  const spendingCents = spending.filter((a) => !isJoint(a)).reduce((sum, a) => sum + a.balanceCents, 0);

  return {
    // Mine first, then joint ones.
    spending: spending
      .map((a) => ({ ...a, joint: isJoint(a), pendingCents: pending.get(a.name) ?? 0 }))
      .sort((a, b) => Number(a.joint) - Number(b.joint)),
    savers: savers.map((s) => ({ ...s, addedCents: added.get(s.name) ?? 0 })).sort((a, b) => b.balanceCents - a.balanceCents),
    others,
    totalCents: accounts.reduce((sum, a) => sum + a.balanceCents, 0),
    savedCents: [...added.values()].reduce((sum, n) => sum + n, 0),
    roundUpCents,
    bills,
    billsBy,
    billsCents,
    afterBillsCents: spendingCents - billsCents,
  };
}
