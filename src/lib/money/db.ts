import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { deleteSetting, getSetting, setSetting } from "@/lib/life/settings";
import type { CsvRow } from "./csv";
import { planUpRows, type KnownRow, type UpRow } from "./up-map";
import { addDays } from "@/lib/life/days";
import { merchantKey } from "./merchant";
import { DEFAULT_CATEGORIES, TRANSFERS, type MoneyFlag, type Rule, type SortedBy, type SplitPart, type Transaction, type Upload } from "./types";

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
  splits: SplitPart[] | null;
  atlas_category: string | null;
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
  splits: r.splits,
  atlasCategory: r.atlas_category,
});

/** Plenty for years of personal spending; the page filters it in the browser. */
const MAX_LOADED = 25_000;

export async function listTransactions() {
  const rows = await sql<TransactionRow[]>`
    SELECT t.id, t.account, t.day, t.amount_cents, t.description, t.merchant_key, m.name AS merchant, t.category, t.sorted_by, t.splits, m.category AS atlas_category
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

/**
 * Adds a chunk of an upload's rows (each in its own account if the file named one); returns
 * how many were new. A row Up's sync already brought in (same account, day and amount) is skipped.
 */
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
    WHERE NOT EXISTS (
      SELECT 1 FROM money_transactions e
      WHERE e.up_id IS NOT NULL AND e.account = r.account AND e.day = r.day AND e.amount_cents = r.amount_cents)
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
    await sql`UPDATE money_transactions SET category = NULL, sorted_by = NULL, splits = NULL WHERE id IN (SELECT jsonb_array_elements_text(${sql.json(ids)}))`;
    await resort();
  } else {
    await sql`UPDATE money_transactions SET category = ${category}, sorted_by = 'me', splits = NULL WHERE id IN (SELECT jsonb_array_elements_text(${sql.json(ids)}))`;
  }
}

export async function transactionAmounts(ids: string[]) {
  return sql<{ id: string; amount_cents: number }[]>`
    SELECT id, amount_cents FROM money_transactions WHERE id IN (SELECT jsonb_array_elements_text(${sql.json(ids)}))`;
}

/**
 * Splits payments across categories, as my own pick. `category` is the biggest part's.
 * Parts are typed inline because sql.json won't take an interface (no index signature).
 */
export async function setSplits(items: { id: string; category: string; splits: { category: string; cents: number }[] }[]) {
  await sql`
    UPDATE money_transactions t SET category = d.category, sorted_by = 'me', splits = d.splits
    FROM jsonb_to_recordset(${sql.json(items)}) AS d(id text, category text, splits jsonb)
    WHERE t.id = d.id`;
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

// ---- Checking ---------------------------------------------------------------------------

const LEFT_KEY = "money.checksLeft";
const REVIEWED_KEY = "money.reviewedAt";
/** "Leave it" answers kept; old ones drop off. */
const MAX_LEFT = 500;

/** Things to check I've said to leave. */
export const getLeftChecks = () => getSetting<string[]>(LEFT_KEY, []);

export async function leaveCheck(id: string) {
  const left = await getLeftChecks();
  if (!left.includes(id)) await setSetting(LEFT_KEY, [...left, id].slice(-MAX_LEFT));
}

/** When Atlas last reviewed the sorting (ms), or null if it never has. */
export const getReviewedAt = () => getSetting<number | null>(REVIEWED_KEY, null);
export const setReviewedAt = (at: number) => setSetting(REVIEWED_KEY, at);

export interface ReviewGroup {
  key: string;
  name: string | null;
  category: string;
  sortedBy: string;
  count: number;
  totalCents: number;
  samples: string[];
}

/**
 * Payments for Atlas to review, one line per merchant and category. With `since`, only
 * what's new or changed since: new transactions, merchants Atlas first read, and anything
 * a newer rule sorted. Moves the bank marked as transfers are left out.
 */
export async function reviewGroups(since: number | null) {
  return sql<ReviewGroup[]>`
    SELECT t.merchant_key AS key, max(m.name) AS name, t.category, t.sorted_by AS "sortedBy", count(*)::int AS count,
      sum(t.amount_cents)::bigint AS "totalCents", (array_agg(DISTINCT t.description))[1:3] AS samples
    FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
    WHERE t.category IS NOT NULL AND t.sorted_by IS DISTINCT FROM 'bank' AND t.splits IS NULL
      AND (${since}::bigint IS NULL OR t.created_at > ${since} OR m.created_at > ${since}
        OR EXISTS (SELECT 1 FROM money_rules r WHERE r.created_at > ${since}
          AND position(' ' || r.pattern || ' ' IN ' ' || t.merchant_key || ' ') > 0))
    GROUP BY t.merchant_key, t.category, t.sorted_by
    ORDER BY t.category, t.merchant_key`;
}

/** Open flags, for the page. */
export async function listFlags(): Promise<MoneyFlag[]> {
  const rows = await sql<{ id: string; merchant_key: string; current_category: string; category: string; reason: string }[]>`
    SELECT id, merchant_key, current_category, category, reason FROM money_flags WHERE status = 'open' ORDER BY created_at`;
  return rows.map((r) => ({ id: r.id, merchantKey: r.merchant_key, currentCategory: r.current_category, category: r.category, reason: r.reason }));
}

/** Every flag ever raised, open or not, so a review doesn't raise the same one again. */
export async function flagKeys() {
  const rows = await sql<{ merchant_key: string; current_category: string; category: string }[]>`
    SELECT merchant_key, current_category, category FROM money_flags`;
  return new Set(rows.map((r) => `${r.merchant_key}|${r.current_category}|${r.category}`));
}

export async function addFlags(flags: Omit<MoneyFlag, "id">[]) {
  if (flags.length === 0) return;
  const records = flags.map((f) => ({ id: randomUUID(), key: f.merchantKey, current: f.currentCategory, category: f.category, reason: f.reason }));
  await sql`
    INSERT INTO money_flags (id, merchant_key, current_category, category, reason, created_at)
    SELECT f.id, f.key, f.current, f.category, f.reason, ${Date.now()}
    FROM jsonb_to_recordset(${sql.json(records)}) AS f(id text, key text, current text, category text, reason text)`;
}

export async function getFlag(id: string) {
  const [row] = await sql<{ merchant_key: string; current_category: string; category: string }[]>`
    SELECT merchant_key, current_category, category FROM money_flags WHERE id = ${id} AND status = 'open'`;
  return row ?? null;
}

export async function setFlagStatus(id: string, status: "open" | "fixed" | "left") {
  await sql`UPDATE money_flags SET status = ${status} WHERE id = ${id}`;
}

/** A merchant's payments still in a category, with who put them there. */
export async function paymentsIn(key: string, category: string) {
  return sql<{ id: string; sorted_by: string | null; name: string | null }[]>`
    SELECT t.id, t.sorted_by, m.name FROM money_transactions t LEFT JOIN money_merchants m ON m.key = t.merchant_key
    WHERE t.merchant_key = ${key} AND t.category = ${category} AND t.sorted_by IS DISTINCT FROM 'bank' AND t.splits IS NULL`;
}

/** Merchants to read again, shaped like unsortedMerchants. */
export async function merchantsByKey(keys: string[]) {
  return sql<UnsortedMerchant[]>`
    SELECT t.merchant_key AS key, count(*)::int AS count,
      (array_agg(t.description ORDER BY t.day DESC))[1] AS sample,
      (percentile_disc(0.5) WITHIN GROUP (ORDER BY t.amount_cents))::bigint AS "typicalCents"
    FROM money_transactions t
    WHERE t.merchant_key IN (SELECT jsonb_array_elements_text(${sql.json(keys)}))
    GROUP BY t.merchant_key`;
}

// ---- Up Bank ------------------------------------------------------------------------------

const UP_KEY = "money.up";
/** The upload every synced transaction belongs to; removing it removes them all. */
const UP_IMPORT = "00000000-0000-4000-8000-000000000001";

/** How Atlas is connected to Up. The token and webhook secret are sealed with SESSION_SECRET. */
export interface UpConnection {
  token: string;
  webhookId: string | null;
  webhookSecret: string | null;
  connectedAt: number;
  lastSyncAt: number | null;
  accounts: { id: string; name: string; type: string; balanceCents: number }[];
  /** Why the last sync failed, for the page. */
  error: string | null;
}

export const getUpConnection = () => getSetting<UpConnection | null>(UP_KEY, null);
/** Null forgets the connection. */
export const setUpConnection = (connection: UpConnection | null) => (connection ? setSetting(UP_KEY, connection) : deleteSetting(UP_KEY));

/** What the page may know: never the token or the secret. */
export async function getUpStatus() {
  const c = await getUpConnection();
  if (!c) return null;
  return { live: c.webhookId !== null, lastSyncAt: c.lastSyncAt, accounts: c.accounts.map((a) => ({ name: a.name, type: a.type, balanceCents: a.balanceCents })), error: c.error };
}

/** The latest day there are transactions for, or null. */
export async function latestDay() {
  const [row] = await sql<{ day: string | null }[]>`SELECT max(day) AS day FROM money_transactions`;
  return row?.day ?? null;
}

const upTransactionId = (upId: string) => createHash("sha256").update(`up|${upId}`).digest("hex").slice(0, 32);

/**
 * Saves a page of Up's transactions: updates what's already synced (a held payment that's
 * settled), claims the CSV row for the same payment, or adds it. Then re-sort.
 */
export async function saveUpRows(rows: UpRow[]) {
  if (rows.length === 0) return { added: 0, linked: 0, updated: 0 };
  const days = rows.map((r) => r.day).sort();
  const accounts = [...new Set(rows.map((r) => r.account))];
  const known = await sql<KnownRow[]>`
    SELECT id, account, day, amount_cents AS "amountCents", up_id AS "upId" FROM money_transactions
    WHERE (day BETWEEN ${addDays(days[0], -1)} AND ${addDays(days.at(-1)!, 1)} AND account IN ${sql(accounts)})
       OR up_id IN ${sql(rows.map((r) => r.upId))}`;
  const { update, link, add } = planUpRows(rows, known);

  await sql`
    INSERT INTO money_imports (id, file_name, account, rows, added, created_at)
    VALUES (${UP_IMPORT}, 'Up Bank (synced)', 'Up', 0, 0, ${Date.now()}) ON CONFLICT (id) DO NOTHING`;
  if (update.length) {
    // A changed amount (a held payment settling for less) can't keep an old split.
    await sql`
      UPDATE money_transactions t SET amount_cents = d.amount, status = d.status,
        splits = CASE WHEN t.amount_cents = d.amount THEN t.splits END
      FROM jsonb_to_recordset(${sql.json(update.map((u) => ({ id: u.id, amount: u.row.amountCents, status: u.row.status })))})
        AS d(id text, amount bigint, status text)
      WHERE t.id = d.id`;
  }
  if (link.length) {
    await sql`
      UPDATE money_transactions t SET up_id = d.up_id, status = d.status
      FROM jsonb_to_recordset(${sql.json(link.map((l) => ({ id: l.id, up_id: l.row.upId, status: l.row.status })))}) AS d(id text, up_id text, status text)
      WHERE t.id = d.id`;
  }
  let added = 0;
  if (add.length) {
    const records = add.map((r) => ({
      id: upTransactionId(r.upId),
      up_id: r.upId,
      account: r.account,
      day: r.day,
      amount_cents: r.amountCents,
      description: r.description,
      merchant_key: merchantKey(r.description),
      status: r.status,
      transfer: r.transfer,
    }));
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO money_transactions (id, up_id, account, day, amount_cents, description, merchant_key, status, import_id, created_at, category, sorted_by)
      SELECT r.id, r.up_id, r.account, r.day, r.amount_cents, r.description, r.merchant_key, r.status, ${UP_IMPORT}, ${Date.now()},
        CASE WHEN r.transfer THEN ${TRANSFERS} END, CASE WHEN r.transfer THEN 'bank' END
      FROM jsonb_to_recordset(${sql.json(records)})
        AS r(id text, up_id text, account text, day text, amount_cents bigint, description text, merchant_key text, status text, transfer boolean)
      ON CONFLICT DO NOTHING
      RETURNING id`;
    added = inserted.length;
  }
  await sql`
    UPDATE money_imports SET rows = c.n, added = c.n
    FROM (SELECT count(*)::int AS n FROM money_transactions WHERE import_id = ${UP_IMPORT}) c WHERE id = ${UP_IMPORT}`;
  return { added, linked: link.length, updated: update.length };
}

export async function deleteUpRows(upIds: string[]) {
  if (upIds.length) await sql`DELETE FROM money_transactions WHERE up_id IN ${sql(upIds)}`;
}

/** Held payments from `fromDay` on that Up no longer lists: cancelled, or replaced when they settled. */
export async function staleHeld(fromDay: string, seen: Set<string>) {
  const rows = await sql<{ up_id: string }[]>`SELECT up_id FROM money_transactions WHERE status = 'HELD' AND up_id IS NOT NULL AND day >= ${fromDay}`;
  return rows.map((r) => r.up_id).filter((id) => !seen.has(id));
}

// ---- Undo -----------------------------------------------------------------------------------

/** Takes back a "Leave it". */
export async function unleaveCheck(id: string) {
  const left = await getLeftChecks();
  if (left.includes(id)) await setSetting(LEFT_KEY, left.filter((l) => l !== id));
}

/** Puts transactions' sorting back as given, then re-sorts whatever's left to rules and Atlas. */
export async function restoreRows(items: { id: string; category: string | null; sorted_by: string | null; splits: { category: string; cents: number }[] | null }[]) {
  if (items.length === 0) return;
  await sql`
    UPDATE money_transactions t SET category = d.category, sorted_by = d.sorted_by, splits = d.splits
    FROM jsonb_to_recordset(${sql.json(items)}) AS d(id text, category text, sorted_by text, splits jsonb)
    WHERE t.id = d.id`;
  await resort();
}
