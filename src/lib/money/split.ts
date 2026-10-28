import type { SplitPart, Transaction } from "./types";

// Split payments: one bank transaction shared across categories ("Money owed" is 60%
// Groceries, 40% Eating out). The list shows the payment once; totals, charts and Ask
// Atlas count each part in its own category. Safe in the browser and on the server.

/** Each split payment becomes one transaction per part, for adding up by category. */
export function expandSplits(transactions: Transaction[]): Transaction[] {
  if (!transactions.some((t) => t.splits)) return transactions;
  return transactions.flatMap((t) =>
    t.splits
      ? t.splits.map((p, i) => ({ ...t, id: `${t.id}:${i}`, splitOf: t.id, category: p.category, amountCents: p.cents, splits: null }))
      : [t],
  );
}

/** The payment a transaction (or a part of one) belongs to. */
export const paymentId = (t: Transaction) => t.splitOf ?? t.id;

/** How much of a payment is in `category`: all of it unless it's split. */
export function amountIn(t: Transaction, category: string | null) {
  if (!t.splits || category === null) return t.amountCents;
  return t.splits.filter((p) => p.category === category).reduce((sum, p) => sum + p.cents, 0);
}

/**
 * Splits `amountCents` by shares that add up to 1, to the cent: rounding is settled on the
 * last part, so the parts always add up exactly.
 */
export function splitByShares(amountCents: number, shares: { category: string; share: number }[]): SplitPart[] {
  const parts = shares.map((s) => ({ category: s.category, cents: Math.round(amountCents * s.share) }));
  const rest = amountCents - parts.reduce((sum, p) => sum + p.cents, 0);
  parts[parts.length - 1].cents += rest;
  return parts;
}

/** "Groceries 60% · Eating out 40%" */
export function describeSplit(t: Transaction) {
  return (t.splits ?? []).map((p) => `${p.category} ${Math.round((p.cents / t.amountCents) * 100)}%`).join(" · ");
}
