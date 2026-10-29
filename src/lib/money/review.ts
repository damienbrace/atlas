import { MONTHS } from "@/lib/format";
import { addDays, parseDay, shortDay } from "@/lib/life/days";
import { accountInsights, type AccountBalance } from "./accounts";
import { isPurchase } from "./alerts";
import { findHabits } from "./habits";
import { biggestPurchases, categoryChanges, periodSpan, weekdaySpending, type DaySpan } from "./insights";
import { merchantName } from "./merchant";
import { inRange, kindOf, monthEnd, monthStart, summarise } from "./periods";
import { findRecurring } from "./recurring";
import { expandSplits } from "./split";
import { auditSubscriptions } from "./subscriptions";
import { money, type Transaction } from "./types";

// Month and Year in Review: how a month or a year went, against the ones before. Where the
// money went and what changed, the places used most, the standouts (biggest purchase,
// biggest day, no-spend days), savers and subscriptions, and for a year, month by month.
// Kept plain rather than cheeky. Safe in the browser and on the server.

const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES: Record<string, string> = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays" };
const shiftYear = (day: string, years: number) => `${Number(day.slice(0, 4)) + years}${day.slice(4)}`;
const minDay = (a: string, b: string) => (a < b ? a : b);
const whole = (cents: number) => money(cents, { whole: true });

/** A month as "2026-10", or a year: "12m" (the last 12 months), "2026", or "fy2026" (July 2025 to June 2026). */
export type ReviewChoice = { kind: "month"; id: string } | { kind: "year"; id: string };

export interface ReviewOption {
  id: string;
  label: string;
}

const dayLabel = (day: string) => `${parseDay(day).getDate()} ${MONTHS[parseDay(day).getMonth()]}`;
export const lastMonth = (today: string) => monthStart(today, -1).slice(0, 7);

/** Every month with transactions, newest first. */
export function monthOptions(earliest: string, today: string): ReviewOption[] {
  const options: ReviewOption[] = [];
  for (let from = monthStart(today); from >= monthStart(earliest); from = monthStart(from, -1)) {
    const d = parseDay(from);
    const note = from === monthStart(today) ? " (so far)" : from < earliest ? ` (from ${dayLabel(earliest)})` : "";
    options.push({ id: from.slice(0, 7), label: `${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}${note}` });
  }
  return options;
}

/** The last 12 months, then each calendar year and financial year with transactions, newest first. */
export function yearOptions(earliest: string, today: string): ReviewOption[] {
  const note = (from: string, to: string) => (to > today ? " (so far)" : from < earliest ? ` (from ${dayLabel(earliest)})` : "");
  const options: ReviewOption[] = [{ id: "12m", label: "Last 12 months" }];
  for (let y = Number(today.slice(0, 4)); y >= Number(earliest.slice(0, 4)); y--) options.push({ id: String(y), label: `${y}${note(`${y}-01-01`, `${y}-12-31`)}` });
  const lastFy = Number(today.slice(5, 7)) >= 7 ? Number(today.slice(0, 4)) + 1 : Number(today.slice(0, 4));
  for (let y = lastFy; `${y}-06-30` >= earliest; y--) options.push({ id: `fy${y}`, label: `FY ${y - 1}–${String(y).slice(2)}${note(`${y - 1}-07-01`, `${y}-06-30`)}` });
  return options;
}

/** The days a review covers, its title, and the spans it's compared with (fully inside the history). */
function reviewSpans(choice: ReviewChoice, today: string, earliest: string) {
  const covered = (spans: DaySpan[]) => spans.filter((s) => s.from >= earliest);
  if (choice.kind === "month") {
    const from = `${choice.id}-01`;
    const soFar = monthEnd(from) > today;
    const to = minDay(monthEnd(from), today);
    const d = parseDay(from);
    const before = covered(
      [1, 2, 3].map((k) => {
        const start = monthStart(from, -k);
        return { from: start, to: soFar ? minDay(addDays(start, parseDay(today).getDate() - 1), monthEnd(start)) : monthEnd(start) };
      }),
    );
    const n = before.length;
    const words = soFar ? `the same days of ${n === 1 ? "last month" : `the last ${n} months`}` : n === 1 ? "the month before" : `the ${n} months before`;
    return { from, to, soFar, title: `${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`, before, words };
  }
  let from: string;
  let end: string;
  let title: string;
  if (choice.id === "12m") [from, end, title] = [addDays(today, -364), today, "Your last 12 months"];
  else if (choice.id.startsWith("fy")) {
    const y = Number(choice.id.slice(2));
    [from, end, title] = [`${y - 1}-07-01`, `${y}-06-30`, `FY ${y - 1}–${String(y).slice(2)}`];
  } else [from, end, title] = [`${choice.id}-01-01`, `${choice.id}-12-31`, choice.id];
  const to = minDay(end, today);
  const before = covered([choice.id === "12m" ? { from: addDays(from, -365), to: addDays(from, -1) } : { from: shiftYear(from, -1), to: shiftYear(to, -1) }]);
  return { from, to, soFar: end > today, title, before, words: choice.id === "12m" ? "the 12 months before" : "the same days a year before" };
}

interface ReviewInput {
  /** Every transaction, including any left out of the totals (they stay out). */
  transactions: Transaction[];
  accounts: AccountBalance[];
  today: string;
  choice: ReviewChoice;
}

export function buildReview({ transactions, accounts, today, choice }: ReviewInput) {
  const counted = transactions.filter((t) => !t.excluded && t.day <= today);
  const parts = expandSplits(counted);
  const earliest = parts.reduce((min, t) => (t.day < min ? t.day : min), today);
  const spans = reviewSpans(choice, today, earliest);
  const span = periodSpan(spans, parts, today);
  const inSpan = (t: Transaction) => inRange(t.day, span);
  const total = summarise(parts.filter(inSpan));

  // Usual: the average of the spans before.
  const before = spans.before.map((b) => summarise(parts.filter((t) => inRange(t.day, b))));
  const average = (pick: (s: ReturnType<typeof summarise>) => number) => Math.round(before.reduce((sum, s) => sum + pick(s), 0) / before.length);
  const usual = before.length ? { spentCents: average((s) => s.spentCents), incomeCents: average((s) => s.incomeCents), leftOverCents: average((s) => s.netCents) } : null;

  const categories = [...total.byCategory.entries()]
    .filter(([, cents]) => cents > 0)
    .map(([category, cents]) => ({
      category: category ?? "Not sorted",
      cents,
      share: total.spentCents > 0 ? cents / total.spentCents : 0,
      usualCents: before.length ? Math.round(before.reduce((sum, s) => sum + (s.byCategory.get(category) ?? 0), 0) / before.length) : null,
    }))
    .sort((a, b) => b.cents - a.cents);
  const changes = categoryChanges(parts, span, spans.before, choice.kind === "year" ? 10000 : 2000);

  // Places: where the most went, and where I went most.
  const places = new Map<string, { name: string; cents: number; visits: number }>();
  for (const t of counted) {
    if (!inSpan(t) || !isPurchase(t)) continue;
    const name = merchantName(t);
    const place = places.get(name) ?? { name, cents: 0, visits: 0 };
    place.cents -= t.amountCents;
    place.visits++;
    places.set(name, place);
  }
  const placeList = [...places.values()];
  const businesses = [...placeList].sort((a, b) => b.cents - a.cents).slice(0, 5);
  const mostVisited = [...placeList].sort((a, b) => b.visits - a.visits || b.cents - a.cents)[0] ?? null;

  // Days: the biggest, and how many went by with nothing spent.
  const byDay = new Map<string, number>();
  for (const t of parts) if (inSpan(t) && kindOf(t) === "spend") byDay.set(t.day, (byDay.get(t.day) ?? 0) - t.amountCents);
  const biggestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const noSpendDays = span.days - [...byDay.values()].filter((cents) => cents > 0).length;
  const weekdays = weekdaySpending(parts, span);
  const busiest = weekdays.reduce((a, b) => (b.averageCents > a.averageCents ? b : a), weekdays[0]);

  // Savers and subscriptions as they stood at the end.
  const recurring = findRecurring(counted, span.to);
  const savers = accounts.length ? accountInsights(accounts, counted, span, recurring, today) : null;
  const subs = auditSubscriptions(counted, recurring, span.to);

  // A year, month by month.
  const months =
    choice.kind === "year"
      ? (() => {
          const rows = [];
          for (let from = monthStart(span.from); from <= span.to; from = monthStart(from, 1)) {
            const range = { from: from < span.from ? span.from : from, to: minDay(monthEnd(from), span.to) };
            const s = summarise(parts.filter((t) => inRange(t.day, range)));
            rows.push({ month: from, whole: range.from === from && range.to === monthEnd(from), spentCents: s.spentCents, leftOverCents: s.netCents });
          }
          return rows;
        })()
      : [];
  const wholeMonths = months.filter((m) => m.whole);

  return {
    choice,
    title: spans.title,
    span,
    soFar: spans.soFar,
    /** The history starts partway through. */
    partial: spans.from < earliest,
    comparedWith: before.length ? spans.words : null,
    spentCents: total.spentCents,
    incomeCents: total.incomeCents,
    leftOverCents: total.netCents,
    rate: total.incomeCents > 0 ? total.netCents / total.incomeCents : null,
    usual,
    categories: categories.slice(0, 8),
    up: changes.filter((c) => c.changeCents > 0).slice(0, 3),
    down: changes.filter((c) => c.changeCents < 0).slice(0, 3),
    businesses,
    mostVisited,
    purchases: placeList.reduce((sum, p) => sum + p.visits, 0),
    places: placeList.length,
    biggest: biggestPurchases(counted.filter(isPurchase), span, 1)[0] ?? null,
    biggestDay: biggestDay ? { day: biggestDay[0], cents: biggestDay[1] } : null,
    noSpendDays,
    busiest: busiest && busiest.averageCents > 0 ? { day: DAY_NAMES[busiest.day], averageCents: busiest.averageCents } : null,
    savedCents: savers?.savedCents ?? null,
    roundUpCents: savers?.roundUpCents ?? 0,
    subscriptions: {
      monthlyCents: subs.monthlyCents,
      fresh: subs.subscriptions.filter((s) => inRange(s.firstDay, span)).map((s) => s.name),
      rose: subs.subscriptions.filter((s) => s.rose && inRange(s.lastDay, span)).map((s) => s.name),
    },
    habits: findHabits(counted, span.to, span.from).slice(0, 3),
    months,
    priciestMonth: [...wholeMonths].sort((a, b) => b.spentCents - a.spentCents)[0] ?? null,
    bestMonth: [...wholeMonths].sort((a, b) => b.leftOverCents - a.leftOverCents)[0] ?? null,
  };
}

export type Review = ReturnType<typeof buildReview>;

const percentChange = (now: number, usual: number) => {
  if (usual <= 0) return "";
  const change = Math.round(((now - usual) / usual) * 100);
  return Math.abs(change) < 5 ? " (about the same)" : ` (${Math.abs(change)}% ${change > 0 ? "more" : "less"})`;
};

/** The review as a Telegram message, with a link to the page. */
export function reviewText(r: Review, url: string) {
  const title = `${r.title}${r.soFar ? " so far" : ""} in review`;
  const lines = [`*${title}*`, ""];
  lines.push(`Spent ${whole(r.spentCents)}${r.usual ? ` · usually ${whole(r.usual.spentCents)}${percentChange(r.spentCents, r.usual.spentCents)}` : ""}`);
  lines.push(`Money in ${whole(r.incomeCents)} · left over ${money(r.leftOverCents, { whole: true, sign: true })}${r.rate !== null ? ` (${Math.round(r.rate * 100)}% kept)` : ""}`);
  if (r.categories.length) lines.push(`Most went on: ${r.categories.slice(0, 3).map((c) => `${c.category} ${whole(c.cents)}`).join(", ")}`);
  const moves = [
    r.up.length ? `Up most: ${r.up.map((c) => `${c.category} ${money(c.changeCents, { whole: true, sign: true })}`).join(", ")}` : "",
    r.down.length ? `Down most: ${r.down.map((c) => `${c.category} ${money(c.changeCents, { whole: true, sign: true })}`).join(", ")}` : "",
  ].filter(Boolean);
  if (moves.length) lines.push(moves.join(" · "));

  lines.push("");
  if (r.businesses.length) lines.push(`Top places: ${r.businesses.slice(0, 3).map((b) => `${b.name} ${whole(b.cents)}`).join(", ")}`);
  if (r.mostVisited && r.mostVisited.visits > 1) lines.push(`Most visits: ${r.mostVisited.name}, ${r.mostVisited.visits} times`);
  if (r.biggest) lines.push(`Biggest: ${merchantName(r.biggest)} ${money(-r.biggest.amountCents)} (${shortDay(r.biggest.day)})`);
  if (r.biggestDay) lines.push(`Biggest day: ${shortDay(r.biggestDay.day)}, ${whole(r.biggestDay.cents)} · ${r.noSpendDays} no-spend day${r.noSpendDays === 1 ? "" : "s"}`);
  if (r.priciestMonth && r.bestMonth) {
    const name = (m: { month: string }) => FULL_MONTHS[parseDay(m.month).getMonth()];
    lines.push(`Priciest month: ${name(r.priciestMonth)} ${whole(r.priciestMonth.spentCents)} · most left over: ${name(r.bestMonth)} ${money(r.bestMonth.leftOverCents, { whole: true, sign: true })}`);
  }

  const extras = [];
  if (r.savedCents !== null && (r.savedCents !== 0 || r.roundUpCents > 0)) {
    extras.push(`Savers: ${money(r.savedCents, { whole: true, sign: true })}${r.roundUpCents > 0 ? ` · ${money(r.roundUpCents)} from round-ups` : ""}`);
  }
  if (r.subscriptions.monthlyCents > 0) {
    extras.push(
      `Subscriptions: ${whole(r.subscriptions.monthlyCents)} a month` +
        (r.subscriptions.fresh.length ? ` · New: ${r.subscriptions.fresh.join(", ")}` : "") +
        (r.subscriptions.rose.length ? ` · Gone up: ${r.subscriptions.rose.join(", ")}` : ""),
    );
  }
  if (extras.length) lines.push("", ...extras);
  lines.push("", `Full review: ${url}`);
  return { title, text: lines.join("\n") };
}

/** Where a review lives on the page. */
export function reviewPath(choice: ReviewChoice) {
  return `/money/review?${choice.kind}=${choice.id}`;
}
