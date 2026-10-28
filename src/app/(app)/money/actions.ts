"use server";

import { describeAiError, interpretMoneyInstruction, interpretMoneyQuestion, sortMerchants, type MoneyQuestionResult } from "@/lib/ai/claude";
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
  listRules,
  merchantSummary,
  resort,
  saveMerchants,
  setCategory,
  startUpload,
  transactionSpan,
  unsortedMerchants,
} from "@/lib/money/db";
import { cleanDescription, normalise, titleCase } from "@/lib/money/merchant";
import type { MoneyQuery } from "@/lib/money/question";
import { INCOME, MAX_CATEGORY, TRANSFERS, UPLOAD_CHUNK, type ProposedRule } from "@/lib/money/types";

// Server Functions are public endpoints: check the session and validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
const isTransactionId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);

const MAX_ROWS = 50_000;
const MAX_AMOUNT = 100_000_000_00;
/** Merchants per Claude request when sorting. */
const SORT_BATCH = 80;
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
  const [batch, categories] = await Promise.all([unsortedMerchants(SORT_BATCH), getCategories()]);
  if (batch.length === 0) return { ok: true, sorted: 0, remaining: 0 };
  try {
    const sorted = await sortMerchants(
      batch.map((m) => ({ ...m, sample: cleanDescription(m.sample) })),
      categories,
    );
    await saveMerchants(sorted);
    return { ok: true, sorted: sorted.length, remaining: await countUnsortedMerchants() };
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
