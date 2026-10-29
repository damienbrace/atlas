import "server-only";
import { reviewSorting, sortMerchants } from "@/lib/ai/claude";
import { seal, unseal } from "@/lib/auth/seal";
import { env } from "@/lib/env";
import {
  addFlags,
  countUnsortedMerchants,
  deleteUpRows,
  flagKeys,
  getCategories,
  getReviewedAt,
  getUpConnection,
  latestDay,
  listRules,
  resort,
  reviewGroups,
  saveMerchants,
  saveUpRows,
  setReviewedAt,
  setUpConnection,
  staleHeld,
  unsortedMerchants,
  type UpConnection,
} from "./db";
import { cleanDescription } from "./merchant";
import * as up from "./up";
import { toRow, type UpAccount, type UpRow } from "./up-map";

// Money's jobs, shared by the page's buttons, Up's webhook and the early-morning job. The
// callers check who's asking; these just do the work.

/** Merchants per Claude request when sorting. */
const SORT_BATCH = 80;
/** Lines of payments per Claude request when Atlas reviews the sorting. */
const REVIEW_BATCH = 150;
const DAY_MS = 86_400_000;

// ---- Atlas ------------------------------------------------------------------------------

/** One round of Atlas sorting merchants it hasn't read; call again while `remaining` > 0. */
export async function sortRound() {
  const [batch, categories] = await Promise.all([unsortedMerchants(SORT_BATCH), getCategories()]);
  if (batch.length === 0) return { sorted: 0, remaining: 0 };
  const sorted = await sortMerchants(
    batch.map((m) => ({ ...m, sample: cleanDescription(m.sample) })),
    categories,
  );
  await saveMerchants(sorted);
  return { sorted: sorted.length, remaining: await countUnsortedMerchants() };
}

/**
 * Atlas reads how payments are sorted and flags the ones that look wrong. "new" covers only
 * what's arrived or changed since the last review; "all" is everything. A flag raised
 * before, fixed or left, isn't raised again.
 */
export async function review(scope: "new" | "all") {
  const startedAt = Date.now();
  const since = scope === "new" ? await getReviewedAt() : null;
  // Never reviewed: start counting from now rather than reading everything unasked.
  if (scope === "new" && since === null) {
    await setReviewedAt(startedAt);
    return { checked: 0, flagged: 0 };
  }
  const [groups, categories, rules, raised] = await Promise.all([reviewGroups(since), getCategories(), listRules(), flagKeys()]);
  if (groups.length > 0) {
    const lines = groups.map((g) => ({ ...g, samples: g.samples.map((s) => cleanDescription(s).slice(0, 80)) }));
    const batches = Array.from({ length: Math.ceil(lines.length / REVIEW_BATCH) }, (_, i) => lines.slice(i * REVIEW_BATCH, (i + 1) * REVIEW_BATCH));
    const ruleText = rules.map((r) => `${r.pattern} → ${r.category}`);
    const found = (await Promise.all(batches.map((b) => reviewSorting(b, categories, ruleText)))).flat();
    const fresh = found.filter((f) => !raised.has(`${f.key}|${f.currentCategory}|${f.category}`));
    await addFlags(fresh.map((f) => ({ merchantKey: f.key, currentCategory: f.currentCategory, category: f.category, reason: f.reason })));
    await setReviewedAt(startedAt);
    return { checked: groups.length, flagged: fresh.length };
  }
  await setReviewedAt(startedAt);
  return { checked: 0, flagged: 0 };
}

// ---- Up Bank -------------------------------------------------------------------------------

export class UpNotConnected extends Error {}

async function connection() {
  const c = await getUpConnection();
  const token = c ? unseal<string>(c.token) : null;
  // Sealed with an old SESSION_SECRET reads as nothing: it needs connecting again.
  if (!c || !token) throw new UpNotConnected("Up isn't connected");
  return { c, token };
}

const accountList = (list: UpAccount[]): UpConnection["accounts"] =>
  list.map((a) => ({ id: a.id, name: a.attributes.displayName, type: a.attributes.accountType, balanceCents: a.attributes.balance.valueInBaseUnits }));

/** Where a first sync starts: a few days before the CSVs end, so the overlap gets matched up; else two years back. */
async function firstSince() {
  const day = await latestDay();
  return day ? Date.parse(`${day}T00:00:00Z`) - 5 * DAY_MS : Date.now() - 730 * DAY_MS;
}

/**
 * Brings in everything Up has created since the last sync (with a few days' overlap, so
 * payments that settled since are updated). Stops early when it runs out of time and
 * carries on from the same place next time.
 */
export async function syncUp(budgetMs: number) {
  const startedAt = Date.now();
  const { c, token } = await connection();
  try {
    const accounts = accountList(await up.accounts(token));
    const names = new Map(accounts.map((a) => [a.id, a.name]));
    const since = c.lastSyncAt ? c.lastSyncAt - 3 * DAY_MS : await firstSince();
    const seen = new Set<string>();
    const totals = { added: 0, linked: 0, updated: 0 };
    let done = true;
    for await (const page of up.transactionPages(token, new Date(since).toISOString())) {
      const rows = page.flatMap((t): UpRow[] => {
        const name = names.get(t.relationships.account.data.id);
        const row = name ? toRow(t, name) : null;
        if (row) seen.add(row.upId);
        return row ? [row] : [];
      });
      const saved = await saveUpRows(rows);
      totals.added += saved.added;
      totals.linked += saved.linked;
      totals.updated += saved.updated;
      if (Date.now() - startedAt > budgetMs) {
        done = false;
        break;
      }
    }
    // Held payments Up no longer lists were cancelled, or replaced when they settled. Only
    // looked for a day inside the window, so a time-zone edge can't remove a real one.
    if (done) await deleteUpRows(await staleHeld(new Date(since + DAY_MS).toISOString().slice(0, 10), seen));
    await resort();
    await setUpConnection({ ...c, accounts, lastSyncAt: done ? startedAt : c.lastSyncAt, error: null });
    return { ...totals, done };
  } catch (error) {
    const message = error instanceof up.UpError && error.status === 401 ? "Up stopped accepting the token. Connect again with a new one." : "Couldn't reach Up last time.";
    await setUpConnection({ ...c, error: message });
    throw error;
  }
}

/** One of Up's webhook events: a transaction created, settled or deleted. */
export async function upEvent(type: string, transactionId: string) {
  const { c, token } = await connection();
  if (type === "TRANSACTION_DELETED") {
    await deleteUpRows([transactionId]);
    return;
  }
  const t = await up.transaction(token, transactionId);
  let accounts = c.accounts;
  if (!accounts.some((a) => a.id === t.relationships.account.data.id)) {
    accounts = accountList(await up.accounts(token));
    await setUpConnection({ ...c, accounts });
  }
  const name = accounts.find((a) => a.id === t.relationships.account.data.id)?.name;
  const row = name ? toRow(t, name) : null;
  if (!row) return;
  await saveUpRows([row]);
  await resort();
  // A merchant Atlas hasn't read: sort it now rather than leave it unsorted until morning.
  if ((await countUnsortedMerchants()) > 0) await sortRound();
}

/**
 * Connects Up with a personal access token: checks it, asks Up to call Atlas on every new
 * transaction (when Atlas has a public https address), and does a first sync.
 */
export async function connectUp(token: string) {
  await up.ping(token);
  const old = await getUpConnection();
  const oldToken = old ? unseal<string>(old.token) : null;
  if (old?.webhookId && oldToken) await up.deleteWebhook(oldToken, old.webhookId).catch(() => {});
  const webhook = env.appUrl.startsWith("https://") ? await up.createWebhook(token, `${env.appUrl}/api/up/webhook`) : null;
  await setUpConnection({
    token: seal(token),
    webhookId: webhook?.id ?? null,
    webhookSecret: webhook ? seal(webhook.secret) : null,
    connectedAt: Date.now(),
    lastSyncAt: null,
    accounts: [],
    error: null,
  });
  return { live: webhook !== null, ...(await syncUp(40_000)) };
}

/** Stops Up calling Atlas and forgets the token. Transactions already synced stay. */
export async function disconnectUp() {
  const c = await getUpConnection();
  const token = c ? unseal<string>(c.token) : null;
  if (c?.webhookId && token) await up.deleteWebhook(token, c.webhookId).catch(() => {});
  await setUpConnection(null);
}

/** After new transactions arrive: sort the merchants Atlas hasn't read, then check what's new. */
export async function sortAndCheck() {
  for (let round = 0; round < 10; round++) {
    const { remaining, sorted } = await sortRound();
    if (remaining === 0 || sorted === 0) break;
  }
  return review("new");
}

/** The early-morning job: catch up with Up, sort what's new, then check it. */
export async function morningMoney(budgetMs: number) {
  // Sorting and checking still run if Up can't be reached; the page shows why.
  if (await getUpConnection()) await syncUp(budgetMs).catch((error) => console.error("Up sync failed", error));
  await sortAndCheck();
}
