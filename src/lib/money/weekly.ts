import { addDays, parseDay, shortDay } from "@/lib/life/days";
import { accountInsights, type AccountBalance } from "./accounts";
import { findHabits } from "./habits";
import { merchantName } from "./merchant";
import { inRange, kindOf, summarise, weekStart } from "./periods";
import type { Recurring } from "./recurring";
import { expandSplits } from "./split";
import { auditSubscriptions } from "./subscriptions";
import { money, type Transaction } from "./types";

// The weekly money message, which Hermes sends on Telegram on Sundays: the week so far
// against a usual week, where it went, savers, what's due next, habits and subscriptions.
// Safe in the browser and on the server.

/** Past weeks a usual week is worked out from. */
const USUAL_WEEKS = 8;

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
const whole = (cents: number) => money(cents, { whole: true });

interface WeeklyInput {
  /** Every transaction, including any left out of the totals. */
  transactions: Transaction[];
  accounts: AccountBalance[];
  recurring: Recurring[];
  today: string;
  /** Things to check waiting in Atlas. */
  openChecks: number;
}

export function weeklySummary({ transactions, accounts, recurring, today, openChecks }: WeeklyInput) {
  const from = weekStart(today);
  const days = daysBetween(from, today) + 1;
  const counted = transactions.filter((t) => !t.excluded);
  const parts = expandSplits(counted);
  const week = summarise(parts.filter((t) => inRange(t.day, { from, to: today })));

  // A usual week: the same days of each of the last 8 weeks the transactions cover.
  const earliest = transactions.reduce((min, t) => (t.day < min ? t.day : min), today);
  const past: number[] = [];
  for (let i = 1; i <= USUAL_WEEKS; i++) {
    const start = addDays(from, -7 * i);
    if (start < earliest) break;
    past.push(summarise(parts.filter((t) => inRange(t.day, { from: start, to: addDays(start, days - 1) }))).spentCents);
  }
  const usualCents = median(past);

  const lines: string[] = [];
  let spent = `Spent ${whole(week.spentCents)}`;
  if (usualCents !== null && usualCents > 0) {
    const change = Math.round(((week.spentCents - usualCents) / usualCents) * 100);
    const compared = Math.abs(change) < 5 ? "about the same" : `${Math.abs(change)}% ${change > 0 ? "more" : "less"}`;
    spent += ` · usually ${whole(usualCents)} ${days < 7 ? "by now" : "a week"} (${compared})`;
  }
  lines.push(spent);
  lines.push(`Money in ${whole(week.incomeCents)} · left over ${money(week.netCents, { whole: true, sign: true })}`);

  const top = [...week.byCategory.entries()]
    .filter(([, cents]) => cents > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, cents]) => `${category ?? "Not sorted"} ${whole(cents)}`);
  if (top.length) lines.push(`Most went on: ${top.join(", ")}`);

  const biggest = counted
    .filter((t) => inRange(t.day, { from, to: today }) && t.amountCents < 0 && kindOf(t) === "spend")
    .sort((a, b) => a.amountCents - b.amountCents)[0];
  if (biggest) lines.push(`Biggest: ${merchantName(biggest)} ${money(-biggest.amountCents)} (${shortDay(biggest.day)})`);

  if (accounts.length) {
    const info = accountInsights(accounts, counted, { from, to: today }, recurring, today);
    const savers = info.savers.filter((s) => s.addedCents !== 0).slice(0, 3);
    if (info.savedCents !== 0 || info.roundUpCents > 0) {
      const which = savers.map((s) => `${s.name} ${money(s.addedCents, { whole: true, sign: true })}`).join(", ");
      const rounds = info.roundUpCents > 0 ? ` · ${money(info.roundUpCents)} from round-ups` : "";
      lines.push("", `Savers: ${money(info.savedCents, { whole: true, sign: true })}${which ? ` (${which})` : ""}${rounds}`);
    }
    const mine = info.spending.find((a) => !a.joint);
    if (mine) lines.push(`${mine.name}: ${money(mine.balanceCents)} · ${money(info.afterBillsCents)} after the next 7 days' bills`);
    if (info.bills.length) {
      lines.push(`Due next: ${info.bills.map((b) => `${b.name} ${money(b.typicalCents)} (${shortDay(b.nextDay)})`).join(", ")}`);
    }
  }

  const habits = findHabits(counted, today).slice(0, 2);
  const subs = auditSubscriptions(counted, recurring, today);
  if (habits.length || subs.subscriptions.length) lines.push("");
  if (habits.length) {
    lines.push(`Habits: ${habits.map((h) => `${h.name} ${h.perWeek.toFixed(1).replace(/\.0$/, "")}×/week, about ${whole(h.yearCents)} a year`).join("; ")}`);
  }
  if (subs.subscriptions.length) {
    // Only this week's news, so the same ones don't come up every Sunday.
    const fresh = subs.subscriptions.filter((s) => s.firstDay >= from).map((s) => s.name);
    const rose = subs.subscriptions.filter((s) => s.rose && s.lastDay >= from).map((s) => s.name);
    lines.push(
      `Subscriptions: ${whole(subs.monthlyCents)} a month (${whole(subs.yearCents)} a year)` +
        (fresh.length ? `. New: ${fresh.join(", ")}` : "") +
        (rose.length ? `. Gone up: ${rose.join(", ")}` : ""),
    );
  }

  const leftOut = transactions.filter((t) => t.excluded && inRange(t.day, { from, to: today }));
  if (leftOut.length || openChecks) lines.push("");
  if (leftOut.length) lines.push(`Left out of totals: ${leftOut.map((t) => `${merchantName(t)} ${whole(Math.abs(t.amountCents))}`).join(", ")}`);
  if (openChecks) lines.push(`${openChecks} thing${openChecks === 1 ? "" : "s"} to check in Atlas`);

  const title = `Money this week · ${shortDay(from)} to ${shortDay(today)}`;
  return { title, text: [`*${title}*`, "", ...lines].join("\n"), from, to: today, spentCents: week.spentCents, usualCents };
}
