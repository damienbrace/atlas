"use server";

import { describeAiError, interpretMoneyInstruction, interpretMoneyQuestion, sortMerchants, type MoneyQuestionResult } from "@/lib/ai/claude";
import { after } from "next/server";
import { signedIn } from "@/lib/auth/session";
import { dayKey, isDayKey } from "@/lib/life/days";
import type { CsvRow } from "@/lib/money/csv";
import {
  addCategories,
  addRules,
  addTransactions,
  countUnsortedMerchants,
  deleteRule,
  deleteUpload,
  getCategories,
  getFlag,
  leaveCheck,
  listRules,
  merchantsByKey,
  merchantSummary,
  paymentsIn,
  resort,
  saveMerchants,
  setCategory,
  setFlagStatus,
  setSplits,
  startUpload,
  transactionAmounts,
  transactionSpan,
} from "@/lib/money/db";
import { connectUp as connect, disconnectUp as disconnect, review, sortAndCheck, sortRound, syncUp, UpNotConnected } from "@/lib/money/jobs";
import { cleanDescription, normalise, titleCase } from "@/lib/money/merchant";
import type { MoneyQuery } from "@/lib/money/question";
import { UpError } from "@/lib/money/up";
import { INCOME, MAX_CATEGORY, MAX_SPLITS, TRANSFERS, UPLOAD_CHUNK, type ProposedRule, type SplitPart } from "@/lib/money/types";

// Server Functions are public endpoints: check the session and validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
const isTransactionId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);

const MAX_ROWS = 50_000;
const MAX_AMOUNT = 100_000_000_00;
/** Merchants shown to Claude when it turns an instruction into rules, or a question into a query. */
const RULE_CONTEXT = 600;
/** Earlier questions sent along, so follow-ups make sense. */
const EARLIER_QUESTIONS = 3;

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.length <= max ? value.replace(/\s+/g, " ").trim() : null;

/** "50.00" or "$1,200" → cents; anything else → null. */
function toCents(text: string) {
  const dollars = text.replace(/[$,\s]/g, "");
  return /^\d+(\.\d{1,2})?$/.test(dollars) ? Math.round(parseFloat(dollars) * 100) : null;
}

function cleanRow(input: unknown): CsvRow | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const description = cleanText(r.description, 300);
  const amount = r.amountCents;
  const balance = r.balanceCents;
  if (!isDayKey(r.day) || !description) return null;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || Math.abs(amount) > MAX_AMOUNT) return null;
  if (balance !== null && (typeof balance !== "number" || !Number.isSafeInteger(balance) || Math.abs(balance) > MAX_AMOUNT)) return null;
  if (typeof r.seq !== "number" || !Number.isInteger(r.seq) || r.seq < 0 || r.seq > 999) return null;
  const account = r.account === null || r.account === undefined ? null : cleanText(r.account, 60);
  if (r.account && !account) return null;
  if (r.transfer !== undefined && typeof r.transfer !== "boolean") return null;
  return { day: r.day, amountCents: amount, description, balanceCents: balance as number | null, account, transfer: r.transfer === true, seq: r.seq };
}

async function isCategory(value: string) {
  return (await getCategories()).includes(value);
}

// ---- Uploading --------------------------------------------------------------------

export async function beginUpload(fileName: string, account: string, rows: number) {
  if (!(await signedIn())) return { ok: false as const };
  const name = cleanText(fileName, 200);
  const acct = cleanText(account, 60);
  if (!name || !acct || !Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) return { ok: false as const };
  return { ok: true as const, uploadId: await startUpload(name, acct, rows) };
}

export async function uploadChunk(uploadId: string, account: string, rows: unknown[]) {
  if (!(await signedIn())) return { ok: false as const };
  const acct = cleanText(account, 60);
  if (!isId(uploadId) || !acct || !Array.isArray(rows) || rows.length === 0 || rows.length > UPLOAD_CHUNK) return { ok: false as const };
  const clean = rows.map(cleanRow);
  if (clean.some((r) => r === null)) return { ok: false as const };
  return { ok: true as const, added: await addTransactions(uploadId, acct, clean as CsvRow[]) };
}

/** After the last chunk: sorts with rules and what Atlas already knows; says what's left for Claude. */
export async function finishUpload() {
  if (!(await signedIn())) return { ok: false as const };
  await resort();
  return { ok: true as const, newMerchants: await countUnsortedMerchants() };
}

export async function removeUpload(uploadId: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(uploadId)) return { ok: false as const };
  await deleteUpload(uploadId);
  return { ok: true as const };
}

// ---- Sorting ------------------------------------------------------------------------

/** One round of Atlas sorting merchants it hasn't seen; call again while `remaining` > 0. */
export async function sortWithAtlas(): Promise<{ ok: true; sorted: number; remaining: number } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  try {
    return { ok: true, ...(await sortRound()) };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}

/** Puts transactions in a category myself (or null to hand them back to rules and Atlas). */
export async function categorise(ids: string[], category: string | null) {
  if (!(await signedIn())) return { ok: false as const };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5000 || !ids.every(isTransactionId)) return { ok: false as const };
  if (category !== null && (typeof category !== "string" || !(await isCategory(category)))) return { ok: false as const };
  await setCategory(ids, category);
  return { ok: true as const };
}

/**
 * Splits payments across categories. Each payment's parts must be real categories, run the
 * same way as the payment, and add up to it exactly.
 */
export async function splitTransactions(items: { id: string; parts: SplitPart[] }[]) {
  if (!(await signedIn())) return { ok: false as const };
  if (!Array.isArray(items) || items.length === 0 || items.length > 500 || !items.every((i) => isTransactionId(i?.id))) return { ok: false as const };
  const [categories, amounts] = await Promise.all([getCategories(), transactionAmounts(items.map((i) => i.id))]);
  const amountOf = new Map(amounts.map((a) => [a.id, a.amount_cents]));
  const clean = [];
  for (const { id, parts } of items) {
    const amount = amountOf.get(id);
    if (amount === undefined || amount === 0 || !Array.isArray(parts) || parts.length < 2 || parts.length > MAX_SPLITS) return { ok: false as const };
    const splits: SplitPart[] = [];
    for (const p of parts) {
      if (!categories.includes(p?.category) || !Number.isSafeInteger(p?.cents) || p.cents === 0 || Math.sign(p.cents) !== Math.sign(amount)) return { ok: false as const };
      splits.push({ category: p.category, cents: p.cents });
    }
    if (splits.reduce((sum, p) => sum + p.cents, 0) !== amount) return { ok: false as const };
    const biggest = splits.reduce((a, b) => (Math.abs(b.cents) > Math.abs(a.cents) ? b : a));
    clean.push({ id, category: biggest.category, splits });
  }
  await setSplits(clean);
  return { ok: true as const };
}

export async function createCategory(name: string) {
  if (!(await signedIn())) return { ok: false as const };
  const clean = cleanText(name, MAX_CATEGORY);
  if (!clean) return { ok: false as const };
  return { ok: true as const, categories: await addCategories([clean]) };
}

// ---- Rules ------------------------------------------------------------------------------

/** Plain English in, proposed rules out. Nothing changes until they're approved. */
export async function askAtlasToSort(
  instruction: string,
): Promise<{ ok: true; reply: string; rules: Omit<ProposedRule, "matches" | "examples">[]; newCategories: string[] } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  const text = cleanText(instruction, 500);
  if (!text) return { ok: false, error: "Say how to sort, e.g. “Caltex and BP are fuel”." };
  const [categories, merchants] = await Promise.all([getCategories(), merchantSummary(RULE_CONTEXT)]);
  try {
    const result = await interpretMoneyInstruction(text, categories, merchants);
    const newCategories = result.new_categories
      .map((c) => c.trim())
      .filter((c) => c && c.length <= MAX_CATEGORY && !categories.some((k) => k.toLowerCase() === c.toLowerCase()))
      .slice(0, 3);
    const allowed = new Map([...categories, ...newCategories].map((c) => [c.toLowerCase(), c]));
    const rules = result.rules.flatMap((r) => {
      const pattern = normalise(r.words);
      const category = allowed.get(r.category.trim().toLowerCase());
      return pattern && category ? [{ pattern, category, amountCents: toCents(r.amount) }] : [];
    });
    return { ok: true, reply: result.reply.trim(), rules: rules.slice(0, 30), newCategories };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}

/** Saves approved rules (adding any new categories they use) and re-sorts. */
export async function approveRules(input: { pattern: string; category: string; amountCents: number | null }[], newCategories: string[] = []) {
  if (!(await signedIn())) return { ok: false as const };
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) return { ok: false as const };
  if (!Array.isArray(newCategories) || newCategories.length > 3 || !newCategories.every((c) => cleanText(c, MAX_CATEGORY))) return { ok: false as const };
  const categories = newCategories.length ? await addCategories(newCategories.map((c) => cleanText(c, MAX_CATEGORY)!)) : await getCategories();
  const rules = [];
  for (const r of input) {
    const pattern = typeof r?.pattern === "string" ? normalise(r.pattern) : "";
    const amount = r?.amountCents;
    if (!pattern || !categories.includes(r.category)) return { ok: false as const };
    if (amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT)) return { ok: false as const };
    rules.push({ pattern, category: r.category, amountCents: amount });
  }
  const saved = await addRules(rules);
  return { ok: true as const, rules: saved, categories };
}

export async function removeRule(id: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id)) return { ok: false as const };
  await deleteRule(id);
  return { ok: true as const, rules: await listRules() };
}

// ---- Questions ------------------------------------------------------------------------

/**
 * Claude's query, checked against what's really there. A category, business or account
 * it names that doesn't exist becomes a word to look for, so the answer never quietly
 * widens to everything.
 */
function toQuery(r: MoneyQuestionResult, question: string, categories: string[], merchants: string[], accounts: string[]): MoneyQuery {
  const words = new Set<string>();
  const pick = (values: string[], known: string[]) => {
    const byLower = new Map(known.map((k) => [k.toLowerCase(), k]));
    const found = new Set<string>();
    for (const value of values.slice(0, 20)) {
      const clean = cleanText(value, 80);
      if (!clean) continue;
      const match = byLower.get(clean.toLowerCase());
      if (match) found.add(match);
      else words.add(clean.toLowerCase());
    }
    return [...found];
  };
  const picked = { categories: pick(r.categories, categories), merchants: pick(r.merchants, merchants), accounts: pick(r.accounts, accounts) };
  for (const w of r.words.slice(0, 8)) {
    const clean = cleanText(w, 40);
    if (clean) words.add(clean.toLowerCase());
  }

  const span = (fromText: string, toText: string) => {
    const from = isDayKey(fromText.trim()) ? fromText.trim() : null;
    const to = isDayKey(toText.trim()) ? toText.trim() : null;
    return from && to && from > to ? { from: to, to: from } : { from, to };
  };
  const compare = span(r.compare_from, r.compare_to);
  let minCents = toCents(r.min_amount);
  let maxCents = toCents(r.max_amount);
  if (minCents !== null && maxCents !== null && minCents > maxCents) [minCents, maxCents] = [maxCents, minCents];

  // Transfers and income aren't spending, so "spending on Transfers" would always be nothing.
  const only = (category: string) => picked.categories.length > 0 && picked.categories.every((c) => c === category);
  let kind = r.kind;
  if (only(TRANSFERS) && kind !== "transfers-in" && kind !== "transfers-out") kind = "transfers-out";
  if (only(INCOME) && kind === "spending") kind = "income";

  return {
    title: cleanText(r.title, 80) ?? question.slice(0, 80),
    range: span(r.from, r.to),
    kind,
    ...picked,
    words: [...words].slice(0, 8),
    minCents,
    maxCents,
    measure: r.measure,
    groupBy: r.group_by,
    top: Number.isFinite(r.top) ? Math.min(Math.max(Math.round(r.top), 1), 20) : 8,
    compare: compare.from && compare.to ? compare : null,
  };
}

/** A question in, a query out. The page works out the answer from it, so the numbers are exact. */
export async function askAboutMoney(
  question: string,
  earlier: { question: string; title: string }[] = [],
): Promise<{ ok: true; reply: string; query: MoneyQuery | null } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  const text = cleanText(question, 300);
  if (!text) return { ok: false, error: "Ask something like “How much on takeaway since July?”" };
  if (!Array.isArray(earlier)) return { ok: false, error: "Try asking again." };
  const history = earlier.slice(-EARLIER_QUESTIONS).flatMap((e) => {
    const asked = cleanText(e?.question, 300);
    const title = cleanText(e?.title, 120);
    return asked && title ? [{ question: asked, title }] : [];
  });

  const [categories, summary, span] = await Promise.all([getCategories(), merchantSummary(RULE_CONTEXT), transactionSpan()]);
  // By the name the page shows, so a business Claude picks matches the list.
  const merchants = new Map<string, { name: string; count: number; category: string | null }>();
  for (const m of summary) {
    const name = m.name ?? titleCase(m.key);
    const known = merchants.get(name);
    if (known) known.count += m.count;
    else merchants.set(name, { name, count: m.count, category: m.category });
  }

  try {
    const result = await interpretMoneyQuestion(text, history, {
      today: dayKey(new Date()),
      firstDay: span.first,
      lastDay: span.last,
      categories,
      accounts: span.accounts,
      merchants: [...merchants.values()].sort((a, b) => b.count - a.count),
    });
    if (!result.answerable) {
      return { ok: true, reply: result.reply.trim() || "I can answer questions about what you've spent and what's come in.", query: null };
    }
    return { ok: true, reply: "", query: toQuery(result, text, categories, [...merchants.keys()], span.accounts) };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}

// ---- Checking -----------------------------------------------------------------------------

/** Atlas reads how payments are sorted and flags what looks wrong: just what's new (after an upload), or everything. */
export async function reviewWithAtlas(
  scope: "new" | "all",
): Promise<{ ok: true; checked: number; flagged: number } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  if (scope !== "new" && scope !== "all") return { ok: false, error: "Try again." };
  try {
    return { ok: true, ...(await review(scope)) };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}

/** Moves a flag's payments where Atlas suggested: Atlas's own read where it decided, my pick where a rule or I did. */
export async function fixFlag(id: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id)) return { ok: false as const };
  const flag = await getFlag(id);
  if (!flag || !(await isCategory(flag.category))) return { ok: false as const };
  const payments = await paymentsIn(flag.merchant_key, flag.current_category);
  const byAtlas = payments.filter((p) => p.sorted_by === "atlas");
  const others = payments.filter((p) => p.sorted_by !== "atlas").map((p) => p.id);
  if (others.length) await setCategory(others, flag.category);
  if (byAtlas.length) await saveMerchants([{ key: flag.merchant_key, name: byAtlas[0].name ?? titleCase(flag.merchant_key), category: flag.category }]);
  await setFlagStatus(id, "fixed");
  return { ok: true as const };
}

/** "Leave it" on a thing to check: an Atlas flag ("flag:<id>") or one of the page's own checks. */
export async function leaveAlone(id: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (typeof id !== "string" || id.length === 0 || id.length > 300) return { ok: false as const };
  if (id.startsWith("flag:")) {
    if (!isId(id.slice(5))) return { ok: false as const };
    await setFlagStatus(id.slice(5), "left");
  } else await leaveCheck(id);
  return { ok: true as const };
}

/** Atlas reads these merchants again from scratch (say, a payback it once called income). */
export async function resortMerchants(keys: string[]): Promise<{ ok: true; sorted: number } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 50 || !keys.every((k) => typeof k === "string" && k.length > 0 && k.length <= 80))
    return { ok: false, error: "Try again." };
  const [merchants, categories] = await Promise.all([merchantsByKey(keys), getCategories()]);
  if (merchants.length === 0) return { ok: true, sorted: 0 };
  try {
    const sorted = await sortMerchants(
      merchants.map((m) => ({ ...m, sample: cleanDescription(m.sample) })),
      categories,
    );
    await saveMerchants(sorted);
    return { ok: true, sorted: sorted.length };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}

// ---- Up Bank ------------------------------------------------------------------------------

/** Up's personal access tokens look like "up:yeah:" and then letters and numbers. */
const UP_TOKEN = /^up:yeah:[A-Za-z0-9]{20,200}$/;

function upProblem(error: unknown) {
  if (error instanceof UpError && error.status === 401) return "Up didn't accept that token. Check you copied all of it, or make a new one.";
  if (error instanceof UpError && error.status === 429) return "Up is limiting requests. Try again in a minute.";
  if (error instanceof UpNotConnected) return "Up isn't connected.";
  return "Couldn't reach Up. Try again.";
}

/** Connects Up with my personal access token (I paste it in; it's stored sealed), then syncs. */
export async function connectUp(
  token: string,
): Promise<{ ok: true; live: boolean; added: number; linked: number; done: boolean } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  const clean = typeof token === "string" ? token.trim() : "";
  if (!UP_TOKEN.test(clean)) return { ok: false, error: "That doesn't look like an Up token. It starts with up:yeah:" };
  try {
    const res = await connect(clean);
    // Sorting new merchants and checking what came in can take a while, so it runs after answering.
    after(() => sortAndCheck().catch((error) => console.error("Sort and check after connecting Up", error)));
    return { ok: true, live: res.live, added: res.added, linked: res.linked, done: res.done };
  } catch (error) {
    return { ok: false, error: upProblem(error) };
  }
}

export async function syncUpNow(): Promise<{ ok: true; added: number; done: boolean } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  try {
    const res = await syncUp(40_000);
    if (res.added) after(() => sortAndCheck().catch((error) => console.error("Sort and check after syncing Up", error)));
    return { ok: true, added: res.added, done: res.done };
  } catch (error) {
    return { ok: false, error: upProblem(error) };
  }
}

/** Stops syncing with Up and forgets the token. What's already synced stays. */
export async function disconnectUp() {
  if (!(await signedIn())) return { ok: false as const };
  await disconnect();
  return { ok: true as const };
}
