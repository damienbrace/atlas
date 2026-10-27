// Money: personal spending from bank CSV uploads. Safe in the browser and on the server.

export interface Transaction {
  id: string;
  account: string;
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** Negative is money out. */
  amountCents: number;
  /** As the bank wrote it. */
  description: string;
  merchantKey: string;
  /** Atlas's clean name for the merchant, when it has one. */
  merchant: string | null;
  category: string | null;
  sortedBy: SortedBy | null;
}

/** Who put a transaction in its category. "bank" is the export itself marking a move between my own accounts. */
export type SortedBy = "atlas" | "rule" | "me" | "bank";

/** Picks that rules and Atlas leave alone. */
export const isFixed = (sortedBy: SortedBy | null) => sortedBy === "me" || sortedBy === "bank";

export interface Rule {
  id: string;
  /** Normalised like a merchant key, e.g. "CALTEX". */
  pattern: string;
  category: string;
  /** Only this exact amount (either direction), when set. */
  amountCents: number | null;
}

export interface Upload {
  id: string;
  fileName: string;
  account: string;
  rows: number;
  added: number;
  createdAt: number;
}

/** A rule Atlas proposed from a plain-English instruction, waiting for Approve / Edit / Dismiss. */
export interface ProposedRule {
  pattern: string;
  category: string;
  amountCents: number | null;
  /** How many transactions it would sort, and a few of their merchants. */
  matches: number;
  examples: string[];
}

export const DEFAULT_CATEGORIES = [
  "Groceries",
  "Eating out",
  "Fuel",
  "Car",
  "Bills & utilities",
  "Subscriptions",
  "Shopping",
  "Home",
  "Health",
  "Entertainment",
  "Travel",
  "Gifts & donations",
  "Fees & interest",
  "Income",
  "Transfers",
  "Other",
];

/** Money coming in. Not spending. */
export const INCOME = "Income";
/** Moving money between my own accounts, paying off a card. Neither spending nor income. */
export const TRANSFERS = "Transfers";

export const MAX_CATEGORY = 40;

/** Rows per upload request; keeps each well under the 1MB Server Function limit. */
export const UPLOAD_CHUNK = 1000;

// Whole-dollar amounts read better in summaries; cents stay in the transaction list.
const groups = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** "$1,234.56", "−$12.50" (hand-rolled so server and browser render the same). */
export function money(cents: number, { sign = false, whole = false } = {}) {
  const abs = Math.abs(cents);
  const dollars = whole ? groups(Math.round(abs / 100)) : `${groups(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  const prefix = cents < 0 ? "−" : sign && cents > 0 ? "+" : "";
  return `${prefix}$${dollars}`;
}

/** Chart axis: "$950", "$1.2k", "$12k". */
export function compactMoney(cents: number) {
  const dollars = Math.abs(cents) / 100;
  if (dollars < 1000) return `$${Math.round(dollars)}`;
  const k = dollars / 1000;
  return `$${k < 10 ? k.toFixed(2).replace(/\.?0+$/, "") : Math.round(k)}k`;
}
