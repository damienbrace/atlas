import { describe, OWN_ACCOUNT_TYPES } from "./csv";

// Up Bank's API, shaped into Atlas's transactions. Descriptions are built the way Up's CSV
// export reads (the payee, then your message or the bank's text), so a payment synced from
// the API gets the same merchant key, rules and Atlas read as it would from a CSV.
// Safe in the browser and on the server.

export interface UpMoney {
  currencyCode: string;
  value: string;
  valueInBaseUnits: number;
}

export interface UpTransaction {
  id: string;
  attributes: {
    status: "HELD" | "SETTLED";
    rawText: string | null;
    description: string;
    message: string | null;
    amount: UpMoney;
    createdAt: string;
    transactionType?: string | null;
  };
  relationships: {
    account: { data: { id: string } };
    transferAccount?: { data: { id: string } | null };
  };
}

export interface UpAccount {
  id: string;
  attributes: { displayName: string; accountType: string; ownershipType?: string; balance: UpMoney };
}

export interface UpRow {
  upId: string;
  account: string;
  day: string;
  amountCents: number;
  description: string;
  status: "HELD" | "SETTLED";
  /** A move between my own Up accounts: a saver, a round-up. */
  transfer: boolean;
}

/** A row already in Atlas, for matching what Up sends against. */
export interface KnownRow {
  id: string;
  account: string;
  day: string;
  amountCents: number;
  upId: string | null;
}

const tidy = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

export function toRow(t: UpTransaction, accountName: string): UpRow | null {
  const a = t.attributes;
  const day = a.createdAt?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(a.amount?.valueInBaseUnits)) return null;
  // Your message says what a payment was for ("Damo Board"); a card purchase has the bank's text instead.
  const description = describe(tidy(a.message) || tidy(a.rawText), tidy(a.description)).slice(0, 300);
  if (!description) return null;
  return {
    upId: t.id,
    account: accountName,
    day,
    amountCents: a.amount.valueInBaseUnits,
    description,
    status: a.status === "HELD" ? "HELD" : "SETTLED",
    transfer: Boolean(t.relationships.transferAccount?.data) || OWN_ACCOUNT_TYPES.test(tidy(a.transactionType)),
  };
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

/**
 * What to do with each row from Up: update the row it already synced to, claim a CSV row
 * for the same payment (same account and amount, the same day or one either side, not
 * yet claimed), or add it as new.
 */
export function planUpRows(rows: UpRow[], known: KnownRow[]) {
  const byUpId = new Map(known.filter((k) => k.upId).map((k) => [k.upId!, k]));
  const unclaimed = known.filter((k) => !k.upId);
  const claimed = new Set<string>();
  const update: { id: string; row: UpRow }[] = [];
  const link: { id: string; row: UpRow }[] = [];
  const add: UpRow[] = [];
  for (const row of rows) {
    const synced = byUpId.get(row.upId);
    if (synced) {
      update.push({ id: synced.id, row });
      continue;
    }
    const fits = (k: KnownRow, gap: number) =>
      !claimed.has(k.id) && k.account === row.account && k.amountCents === row.amountCents && Math.abs(dayNumber(k.day) - dayNumber(row.day)) <= gap;
    const match = unclaimed.find((k) => fits(k, 0)) ?? unclaimed.find((k) => fits(k, 1));
    if (match) {
      claimed.add(match.id);
      link.push({ id: match.id, row });
    } else add.push(row);
  }
  return { update, link, add };
}
