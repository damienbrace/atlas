import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/life/settings";
import type { CsvRow } from "./csv";
import { merchantKey } from "./merchant";
import { DEFAULT_CATEGORIES, TRANSFERS, type Rule, type SortedBy, type Transaction, type Upload } from "./types";

// Money's storage. Sorting works in layers: my own picks ('me') and moves the bank's file
// marked as between my accounts ('bank') beat rules, and rules beat Atlas's read of the
// merchant. `resort` recomputes everything else.

interface TransactionRow {
  id: string;
  account: string;
  day: string;
  amount_cents: number;
  description: string;
  merchant_key: string;
  merchant: string | null;
  category: string | null;
  sorted_by: string | null;
}

const isSortedBy = (v: string | null): v is SortedBy => v === "atlas" || v === "rule" || v === "me" || v === "bank";

const toTransaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  account: r.account,
  day: r.day,
  amountCents: r.amount_cents,
  description: r.description,
  merchantKey: r.merchant_key,
  merchant: r.merchant,
  category: r.category,
  sortedBy: isSortedBy(r.sorted_by) ? r.sorted_by : null,
});

/** Plenty for years of personal spending; the page filters it in the browser. */
const MAX_LOADED = 25_000;

export async function listTransactions() {
  const rows = await sql<TransactionRow[]>`
    SELECT t.id, t.account, t.day, t.amount_cents, t.description, t.merchant_key, m.name AS merchant, t.category, t.sorted_by
    FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
    ORDER BY t.day DESC, t.created_at DESC, t.id LIMIT ${MAX_LOADED}`;
  return rows.map(toTransaction);
}

export async function listRules(): Promise<Rule[]> {
  const rows = await sql<{ id: string; pattern: string; category: string; amount_cents: number | null }[]>`
    SELECT id, pattern, category, amount_cents FROM money_rules ORDER BY created_at DESC`;
  return rows.map((r) => ({ id: r.id, pattern: r.pattern, category: r.category, amountCents: r.amount_cents }));
}

export async function listUploads(): Promise<Upload[]> {
  const rows = await sql<{ id: string; file_name: string; account: string; rows: number; added: number; created_at: number }[]>`
    SELECT * FROM money_imports ORDER BY created_at DESC LIMIT 50`;
  return rows.map((r) => ({ id: r.id, fileName: r.file_name, account: r.account, rows: r.rows, added: r.added, createdAt: r.created_at }));
}

// ---- Categories ---------------------------------------------------------------

const CATEGORIES_KEY = "money.categories";

export const getCategories = () => getSetting<string[]>(CATEGORIES_KEY, DEFAULT_CATEGORIES);

export async function addCategories(names: string[]) {
  const current = await getCategories();
  const known = new Set(current.map((c) => c.toLowerCase()));
  const fresh = names.filter((n) => !known.has(n.toLowerCase()));
  if (fresh.length === 0) return current;
  // New ones go before Income, Transfers and Other, which read best last.
  const tail = current.findIndex((c) => c === "Income");
  const next = tail === -1 ? [...current, ...fresh] : [...current.slice(0, tail), ...fresh, ...current.slice(tail)];
  await setSetting(CATEGORIES_KEY, next);
  return next;
}

// ---- Uploads ----------------------------------------------------------------------

export async function startUpload(fileName: string, account: string, rows: number) {
  const id = randomUUID();
  await sql`INSERT INTO money_imports (id, file_name, account, rows, added, created_at) VALUES (${id}, ${fileName}, ${account}, ${rows}, 0, ${Date.now()})`;
  return id;
}

/** Same transaction, same id: re-uploading an overlapping CSV skips what's already here. */
function transactionId(account: string, row: CsvRow) {
  return createHash("sha256").update(`${account}|${row.day}|${row.amountCents}|${row.description}|${row.seq}`).digest("hex").slice(0, 32);
}

/** Adds a chunk of an upload's rows (each in its own account if the file named one); returns how many were new. */
export async function addTransactions(uploadId: string, account: string, rows: CsvRow[]) {
  const records = rows.map((r) => ({
    id: transactionId(r.account ?? account, r),
    account: r.account ?? account,
    day: r.day,
    amount_cents: r.amountCents,
    description: r.description,
    merchant_key: merchantKey(r.description),
    balance_cents: r.balanceCents,
    transfer: r.transfer,
  }));
  const added = await sql<{ id: string }[]>`
    INSERT INTO money_transactions (id, account, day, amount_cents, description, merchant_key, balance_cents, import_id, created_at, category, sorted_by)
    SELECT r.id, r.account, r.day, r.amount_cents, r.description, r.merchant_key, r.balance_cents, ${uploadId}, ${Date.now()},
      CASE WHEN r.transfer THEN ${TRANSFERS} END, CASE WHEN r.transfer THEN 'bank' END
    FROM jsonb_to_recordset(${sql.json(records)})
      AS r(id text, account text, day text, amount_cents bigint, description text, merchant_key text, balance_cents bigint, transfer boolean)
    ON CONFLICT (id) DO NOTHING
    RETURNING id`;
  if (added.length) await sql`UPDATE money_imports SET added = added + ${added.length} WHERE id = ${uploadId}`;
  return added.length;
}

/** Removes an upload and the transactions it added. */
export async function deleteUpload(id: string) {
  await sql`DELETE FROM money_transactions WHERE import_id = ${id}`;
  await sql`DELETE FROM money_imports WHERE id = ${id}`;
}

// ---- Sorting --------------------------------------------------------------------

/**
 * Re-sorts everything I haven't picked myself: the best matching rule (one with an
 * amount beats one without, then the longest pattern, then the newest), else Atlas's
 * read of the merchant, else unsorted.
 */
export async function resort() {
  await sql`
    WITH best AS (
      SELECT t.id,
        (SELECT r.category FROM money_rules r
          WHERE position(' ' || r.pattern || ' ' IN ' ' || t.merchant_key || ' ') > 0
            AND (r.amount_cents IS NULL OR r.amount_cents = abs(t.amount_cents))
          ORDER BY r.amount_cents IS NULL, length(r.pattern) DESC, r.created_at DESC LIMIT 1) AS rule_category,
        m.category AS atlas_category
      FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
      WHERE t.sorted_by IS DISTINCT FROM 'me' AND t.sorted_by IS DISTINCT FROM 'bank'
    ), picked AS (
      SELECT id, coalesce(rule_category, atlas_category) AS category,
        CASE WHEN rule_category IS NOT NULL THEN 'rule' WHEN atlas_category IS NOT NULL THEN 'atlas' END AS sorted_by
      FROM best
    )
    UPDATE money_transactions t SET category = p.category, sorted_by = p.sorted_by
    FROM picked p
    WHERE t.id = p.id AND (t.category IS DISTINCT FROM p.category OR t.sorted_by IS DISTINCT FROM p.sorted_by)`;
}

export interface UnsortedMerchant {
  key: string;
  count: number;
  /** The latest description, for Claude to read. */
  sample: string;
  typicalCents: number;
}

/** Merchants with unsorted transactions that Atlas hasn't read yet, most frequent first. */
export async function unsortedMerchants(limit: number) {
  return sql<UnsortedMerchant[]>`
    SELECT t.merchant_key AS key, count(*)::int AS count,
      (array_agg(t.description ORDER BY t.day DESC))[1] AS sample,
      (percentile_disc(0.5) WITHIN GROUP (ORDER BY t.amount_cents))::bigint AS "typicalCents"
    FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
    WHERE t.category IS NULL AND m.key IS NULL
    GROUP BY t.merchant_key ORDER BY count(*) DESC, t.merchant_key LIMIT ${limit}`;
}

export async function countUnsortedMerchants() {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT t.merchant_key)::int AS n
    FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
    WHERE t.category IS NULL AND m.key IS NULL`;
  return row.n;
}

/** Stores Atlas's read of merchants, then re-sorts. */
export async function saveMerchants(merchants: { key: string; name: string; category: string }[]) {
  if (merchants.length === 0) return;
  await sql`
    INSERT INTO money_merchants (key, name, category, created_at)
    SELECT m.key, m.name, m.category, ${Date.now()}
    FROM jsonb_to_recordset(${sql.json(merchants)}) AS m(key text, name text, category text)
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category`;
  await resort();
}

/** The merchants Atlas knows about, for turning an instruction into rules. */
export async function merchantSummary(limit: number) {
  return sql<{ key: string; name: string | null; count: number; category: string | null }[]>`
    SELECT t.merchant_key AS key, max(m.name) AS name, count(*)::int AS count, mode() WITHIN GROUP (ORDER BY t.category) AS category
    FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
    GROUP BY t.merchant_key ORDER BY count(*) DESC, t.merchant_key LIMIT ${limit}`;
}

/** The first and last day with transactions, and every account. */
export async function transactionSpan() {
  const [row] = await sql<{ first: string | null; last: string | null; accounts: string[] | null }[]>`
    SELECT min(day) AS first, max(day) AS last, array_agg(DISTINCT account ORDER BY account) AS accounts FROM money_transactions`;
  return { first: row?.first ?? null, last: row?.last ?? null, accounts: row?.accounts ?? [] };
}

/** My own pick for these transactions; null hands them back to rules and Atlas. */
export async function setCategory(ids: string[], category: string | null) {
  if (category === null) {
    await sql`UPDATE money_transactions SET category = NULL, sorted_by = NULL WHERE id IN (SELECT jsonb_array_elements_text(${sql.json(ids)}))`;
    await resort();
  } else {
    await sql`UPDATE money_transactions SET category = ${category}, sorted_by = 'me' WHERE id IN (SELECT jsonb_array_elements_text(${sql.json(ids)}))`;
  }
}

export async function addRules(rules: Omit<Rule, "id">[]) {
  const records = rules.map((r) => ({ id: randomUUID(), pattern: r.pattern, category: r.category, amount_cents: r.amountCents }));
  await sql`
    INSERT INTO money_rules (id, pattern, category, amount_cents, created_at)
    SELECT r.id, r.pattern, r.category, r.amount_cents, ${Date.now()}
    FROM jsonb_to_recordset(${sql.json(records)}) AS r(id text, pattern text, category text, amount_cents bigint)`;
  await resort();
  return records.map((r) => ({ id: r.id, pattern: r.pattern, category: r.category, amountCents: r.amount_cents }));
}

export async function deleteRule(id: string) {
  await sql`DELETE FROM money_rules WHERE id = ${id}`;
  await resort();
}
