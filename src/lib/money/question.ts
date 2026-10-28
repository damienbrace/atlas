import { MONTHS } from "@/lib/format";
import { addDays, parseDay } from "@/lib/life/days";
import { merchantName } from "./merchant";
import { inRange, kindOf, monthLabel, monthStart, weekLabel, weekStart, type Range } from "./periods";
import { paymentId } from "./split";
import { TRANSFERS, type Transaction } from "./types";

// Answering a question about money. Claude turns the question into a MoneyQuery and
// never sees an amount; the numbers are worked out here from the transactions, so
// they're exact. Split payments come in as their parts (expandSplits), each in its own
// category, and still count as one payment. Safe in the browser and on the server.

export const QUERY_KINDS = ["spending", "income", "net", "transfers-out", "transfers-in"] as const;
export const QUERY_MEASURES = ["total", "count", "average", "per-week", "per-month", "largest"] as const;
export const QUERY_GROUPS = ["none", "category", "merchant", "week", "month", "account"] as const;

export type QueryKind = (typeof QUERY_KINDS)[number];
export type QueryMeasure = (typeof QUERY_MEASURES)[number];
export type QueryGroup = (typeof QUERY_GROUPS)[number];

export interface MoneyQuery {
  /** What's measured, as Atlas understood it: "Takeaway since July". */
  title: string;
  range: Range;
  kind: QueryKind;
  /** Each list narrows the transactions; empty means any. */
  categories: string[];
  /** Businesses by their shown name. A transaction fits if it's one of these or has one of `words`. */
  merchants: string[];
  /** Lowercase words to find in the description, for things that aren't a listed business. */
  words: string[];
  accounts: string[];
  /** Size of a transaction, either direction. */
  minCents: number | null;
  maxCents: number | null;
  measure: QueryMeasure;
  groupBy: QueryGroup;
  /** How many groups or transactions to list. */
  top: number;
  /** A second span to measure the same way. */
  compare: Range | null;
}

/** Inclusive, both ends known. */
export interface Span {
  from: string;
  to: string;
}

export interface Group {
  label: string;
  cents: number;
  count: number;
}

export interface Answer {
  /** What fits the query in its span, newest first. */
  matches: Transaction[];
  /** How many payments those are (the parts of a split payment count once). */
  count: number;
  span: Span;
  totalCents: number;
  /** The headline: cents, or a number of transactions for "count". */
  value: number;
  /** How many weeks and months the span covers, for "per-week" and "per-month". */
  weeks: number;
  months: number;
  groups: Group[];
  /** Groups that didn't make the list. */
  moreGroups: number;
  /** For "largest": the biggest, biggest first. */
  largest: Transaction[];
  compare: { span: Span; value: number; count: number } | null;
  /** The last day there are transactions for, when the span runs well past it. */
  dataEnds: string | null;
}

/** Month and week buckets shown at most; older ones are left out. */
const MAX_MONTHS = 24;
const MAX_WEEKS = 26;
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

function fitsKind(t: Transaction, kind: QueryKind) {
  switch (kind) {
    case "spending":
      return kindOf(t) === "spend";
    case "income":
      return kindOf(t) === "income";
    case "net":
      return kindOf(t) !== "transfer";
    case "transfers-out":
      return t.category === TRANSFERS && t.amountCents < 0;
    case "transfers-in":
      return t.category === TRANSFERS && t.amountCents > 0;
  }
}

/** What a transaction adds: spending counts up (a refund counts down), income and net keep their sign. */
const valueOf = (t: Transaction, kind: QueryKind) => (kind === "spending" || kind === "transfers-out" ? -t.amountCents : t.amountCents);
const payments = (transactions: Transaction[]) => new Set(transactions.map(paymentId)).size;

export function queryFilter(q: MoneyQuery) {
  const categories = new Set(q.categories);
  const merchants = new Set(q.merchants);
  const accounts = new Set(q.accounts);
  return (t: Transaction) => {
    if (!fitsKind(t, q.kind)) return false;
    if (categories.size && !categories.has(t.category ?? "")) return false;
    if (accounts.size && !accounts.has(t.account)) return false;
    if (merchants.size || q.words.length) {
      const name = merchantName(t);
      const text = `${name} ${t.description}`.toLowerCase();
      if (!merchants.has(name) && !q.words.some((w) => text.includes(w))) return false;
    }
    const size = Math.abs(t.amountCents);
    return (q.minCents === null || size >= q.minCents) && (q.maxCents === null || size <= q.maxCents);
  };
}

/**
 * Open ends become the first transaction and today. A span reaching back past the first
 * transaction starts there instead, so a monthly average isn't spread over months with no data.
 */
function resolve(range: Range, first: string, today: string): Span {
  const to = range.to && range.to < today ? range.to : today;
  let from = range.from ?? first;
  if (from < first && to >= first) from = first;
  return { from, to: to < from ? from : to };
}

const daysIn = (span: Span) => daysBetween(span.from, span.to) + 1;
const monthsIn = (span: Span) => daysIn(span) / (365.25 / 12);
const weeksIn = (span: Span) => daysIn(span) / 7;

function measure(q: MoneyQuery, matches: Transaction[], span: Span) {
  const total = matches.reduce((sum, t) => sum + valueOf(t, q.kind), 0);
  const count = payments(matches);
  switch (q.measure) {
    case "count":
      return count;
    case "average":
      return count ? Math.round(total / count) : 0;
    case "per-week":
      return Math.round(total / Math.max(weeksIn(span), 1));
    case "per-month":
      return Math.round(total / Math.max(monthsIn(span), 1));
    default:
      return total;
  }
}

function groupKey(t: Transaction, group: QueryGroup) {
  switch (group) {
    case "week":
      return weekStart(t.day);
    case "month":
      return t.day.slice(0, 7);
    case "category":
      return t.category ?? "Not sorted yet";
    case "merchant":
      return merchantName(t);
    default:
      return t.account;
  }
}

function groupsOf(q: MoneyQuery, matches: Transaction[], span: Span): Group[] {
  const groups = new Map<string, Group>();
  // Every week or month in the span, so one with nothing still shows.
  if (q.groupBy === "week") {
    for (let w = weekStart(span.from); w <= span.to; w = addDays(w, 7)) groups.set(w, { label: weekLabel(w), cents: 0, count: 0 });
  }
  if (q.groupBy === "month") {
    for (let m = monthStart(span.from); m <= span.to; m = monthStart(m, 1)) groups.set(m.slice(0, 7), { label: monthLabel(m), cents: 0, count: 0 });
  }
  for (const t of matches) {
    const key = groupKey(t, q.groupBy);
    const g = groups.get(key) ?? { label: key, cents: 0, count: 0 };
    g.cents += valueOf(t, q.kind);
    g.count += 1;
    groups.set(key, g);
  }
  const list = [...groups.values()];
  if (q.groupBy === "week" || q.groupBy === "month") return list;
  return list.sort((a, b) => (q.measure === "count" ? b.count - a.count : b.cents - a.cents) || a.label.localeCompare(b.label));
}

export function answer(q: MoneyQuery, transactions: Transaction[], today: string): Answer {
  let first = today;
  let last = "";
  for (const t of transactions) {
    if (t.day < first) first = t.day;
    if (t.day > last) last = t.day;
  }
  const fits = queryFilter(q);
  const span = resolve(q.range, first, today);
  const matches = transactions.filter((t) => inRange(t.day, span) && fits(t)).sort((a, b) => b.day.localeCompare(a.day));

  const groups = q.groupBy === "none" ? [] : groupsOf(q, matches, span);
  const shown = q.groupBy === "week" ? groups.slice(-MAX_WEEKS) : q.groupBy === "month" ? groups.slice(-MAX_MONTHS) : groups.slice(0, q.top);

  let compare: Answer["compare"] = null;
  if (q.compare) {
    const other = resolve(q.compare, first, today);
    const earlier = transactions.filter((t) => inRange(t.day, other) && fits(t));
    compare = { span: other, value: measure(q, earlier, other), count: payments(earlier) };
  }

  return {
    matches,
    count: payments(matches),
    span,
    totalCents: matches.reduce((sum, t) => sum + valueOf(t, q.kind), 0),
    value: measure(q, matches, span),
    weeks: weeksIn(span),
    months: monthsIn(span),
    groups: shown,
    moreGroups: groups.length - shown.length,
    largest: q.measure === "largest" ? [...matches].sort((a, b) => valueOf(b, q.kind) - valueOf(a, q.kind)).slice(0, q.top) : [],
    compare,
    dataEnds: last && daysBetween(last, span.to) >= 3 ? last : null,
  };
}

/** "1 Jul to 28 Oct 2026"; the first year only when it differs. */
export function spanLabel({ from, to }: Span) {
  const day = (key: string, year: boolean) => {
    const d = parseDay(key);
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ""}`;
  };
  if (from === to) return day(from, true);
  return `${day(from, from.slice(0, 4) !== to.slice(0, 4))} to ${day(to, true)}`;
}

/** Whether more is better, for colouring a comparison. Null when it's neither. */
export function upIsGood(q: MoneyQuery) {
  if (q.measure === "count") return null;
  if (q.kind === "spending") return false;
  if (q.kind === "income" || q.kind === "net") return true;
  return null;
}
