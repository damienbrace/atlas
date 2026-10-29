import { parseDay } from "@/lib/life/days";
import { merchantName, normalise, patternMatches, titleCase } from "./merchant";
import { weekStart } from "./periods";
import { spanLabel } from "./question";
import { INCOME, isFixed, money, TRANSFERS, type Rule, type Transaction } from "./types";

// Things that look wrong in how payments are sorted, found without Claude: free, and up
// to date the moment anything changes. Each check comes from a mistake that really
// happened, noted on it. Safe in the browser and on the server.

const TRAVEL = "Travel";
/** Categories a rule pulls payments out of before it counts as broad. */
const BROAD = 3;
/** A town seen in this many different weeks is somewhere you go, not a trip. */
const LOCAL_WEEKS = 3;
/** Never trip spending, wherever they bill from (YouTube billed during a trip once looked like one). */
const NOT_TRIP = new Set([TRAVEL, TRANSFERS, INCOME, "Subscriptions", "Bills & utilities", "Fees & interest", "Board"]);

export function ruleMatches(rule: Omit<Rule, "id">, transactions: Transaction[]) {
  const pattern = normalise(rule.pattern);
  return transactions.filter(
    (t) => patternMatches(pattern, t.merchantKey) && (rule.amountCents === null || Math.abs(t.amountCents) === rule.amountCents),
  );
}

/** [label, count] pairs, biggest first. */
function countBy<T>(items: T[], label: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(label(item), (counts.get(label(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "Shopping 5, Travel 2, Home 1 and 3 more" */
function listCounts(counts: [string, number][], max = 4) {
  const shown = counts.slice(0, max).map(([label, n]) => `${label} ${n}`).join(", ");
  return counts.length > max ? `${shown} and ${counts.length - max} more` : shown;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

// ---- Rules before they're saved -----------------------------------------------------

/** What a rule would change: the payments it matches that aren't already in its category and aren't mine to keep. */
export function ruleImpact(rule: Omit<Rule, "id">, transactions: Transaction[]) {
  const moves = ruleMatches(rule, transactions).filter((t) => !isFixed(t.sortedBy) && t.category !== rule.category);
  const from = countBy(moves, (t) => t.category ?? "Not sorted");
  return { moves, from, broad: from.filter(([c]) => c !== "Not sorted").length >= BROAD };
}

/**
 * The words for an "all from here" rule. Atlas's name ("Woolworths") catches every branch,
 * but for a person ("Mum") it would catch every payment to them whatever the message says.
 * So a payment with a message gets just that message's payments, and a name is used only
 * when everything else it catches was sorted one way.
 */
export function safePattern(t: Transaction, category: string, transactions: Transaction[]) {
  if (personMessage(t)) return t.merchantKey;
  const name = normalise(t.merchant ?? "");
  if (name && patternMatches(name, t.merchantKey)) {
    const others = transactions.filter((o) => o.id !== t.id && !isFixed(o.sortedBy) && o.category !== category && patternMatches(name, o.merchantKey));
    if (new Set(others.map((o) => o.category)).size <= 1) return name;
  }
  return t.merchantKey;
}

// ---- Things to check ------------------------------------------------------------------

export type IssueFix =
  | { type: "remove-rule"; ruleId: string; label: string }
  | { type: "reread"; keys: string[]; label: string }
  | { type: "rule"; pattern: string; category: string; label: string }
  | { type: "categorise"; ids: string[]; category: string; label: string };

export interface Issue {
  /** Stable, so "Leave it" can be remembered. */
  id: string;
  title: string;
  detail: string;
  /** The payments it's about. */
  ids: string[];
  fix: IssueFix;
}

/** The message in "Name · Message" when a person wrote it. Shops put a terminal and suburb there ("COFFEEJOY SA455, BOYANUP"). */
export function personMessage(t: Transaction) {
  const m = t.description.match(/^([^·]{2,40}) · ([^·]+)$/);
  if (!m) return null;
  const message = m[2].trim();
  if (/[\d,]/.test(message) || message === message.toUpperCase() || !/[a-z]{2}/i.test(message)) return null;
  return message;
}

/**
 * A rule overriding what Atlas read from the payments themselves, across many different
 * things. ("ASHLEE DOCKING → Groceries" once put holidays, bills and paybacks in Groceries.)
 */
function broadRules(transactions: Transaction[], rules: Rule[]): Issue[] {
  return rules.flatMap((r) => {
    const overridden = ruleMatches(r, transactions).filter(
      (t) => t.sortedBy === "rule" && t.category === r.category && t.atlasCategory && t.atlasCategory !== r.category,
    );
    const kinds = countBy(overridden, (t) => t.atlasCategory!);
    if (new Set(overridden.map((t) => t.merchantKey)).size < 3 || kinds.length < BROAD) return [];
    return [
      {
        id: `rule:${r.id}`,
        title: `The rule “${titleCase(r.pattern)} → ${r.category}” may be too broad`,
        detail: `It puts ${plural(overridden.length, "payment")} in ${r.category} that read as other things: ${listCounts(kinds)}. Removing it sorts each by what it says.`,
        ids: overridden.map((t) => t.id),
        fix: { type: "remove-rule", ruleId: r.id, label: "Remove the rule" },
      },
    ];
  });
}

/** Someone paying me back for something, counted as income. ("Riley · Coffee" once was.) */
function paybacks(transactions: Transaction[]): Issue[] {
  const found = transactions.filter((t) => t.amountCents > 0 && t.category === INCOME && t.sortedBy === "atlas" && personMessage(t));
  return countBy(found, (t) => t.merchantKey).map(([key]) => {
    const group = found.filter((t) => t.merchantKey === key);
    return {
      id: `payback:${key}`,
      title: `“${group[0].description}” is counted as income`,
      detail: `It looks like someone paying you back (${plural(group.length, "payment")}, ${money(group.reduce((s, t) => s + t.amountCents, 0))}). It should lower what it paid for instead.`,
      ids: group.map((t) => t.id),
      fix: { type: "reread", keys: [key], label: "Let Atlas re-sort it" },
    };
  });
}

/**
 * Payments in my own name that Atlas decided. Moves between my accounts are transfers,
 * but regular money in can be my pay: my drawings from the business are.
 */
function ownName(transactions: Transaction[], ownerName: string): Issue[] {
  const first = ownerName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (first.length < 3) return [];
  const mine = transactions.filter(
    (t) => t.sortedBy === "atlas" && t.description.split("·")[0].toLowerCase().split(/[^a-z]+/).includes(first),
  );
  return countBy(mine, (t) => t.merchantKey).flatMap(([key]): Issue[] => {
    const group = mine.filter((t) => t.merchantKey === key);
    const total = group.reduce((s, t) => s + t.amountCents, 0);
    const what = `“${group[0].description}” (${plural(group.length, "payment")}, ${money(total, { sign: true })})`;
    if (group[0].category === TRANSFERS && group.length >= 3 && group.every((t) => t.amountCents > 0)) {
      return [
        {
          id: `own-in:${key}`,
          title: "Regular money in from your own name is counted as transfers",
          detail: `${what}. If this is your pay, count it as income so Money in is right.`,
          ids: group.map((t) => t.id),
          fix: { type: "rule", pattern: key, category: INCOME, label: "Count as Income" },
        },
      ];
    }
    if (group[0].category !== TRANSFERS && group[0].category !== INCOME) {
      return [
        {
          id: `own-out:${key}`,
          title: `A payment in your own name is in ${group[0].category}`,
          detail: `${what}. If it's between your own accounts, make it a transfer.`,
          ids: group.map((t) => t.id),
          fix: { type: "rule", pattern: key, category: TRANSFERS, label: "Make it a transfer" },
        },
      ];
    }
    return [];
  });
}

/**
 * One business in different categories, like a new branch read differently. People are
 * left out: what I pay them for changes with the message.
 */
function mixedNames(transactions: Transaction[]): Issue[] {
  const byName = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (isFixed(t.sortedBy) || t.category === null || personMessage(t) || /^transfer (to|from) /i.test(merchantName(t))) continue;
    const name = merchantName(t);
    byName.set(name, [...(byName.get(name) ?? []), t]);
  }
  return [...byName.entries()].flatMap(([name, group]): Issue[] => {
    const kinds = countBy(group, (t) => t.category!);
    if (kinds.length < 2) return [];
    const [main] = kinds[0];
    const others = group.filter((t) => t.category !== main);
    return [
      {
        id: `name:${name}:${kinds.map(([c]) => c).join("|")}`,
        title: `${name} is in ${kinds.length} categories`,
        detail: `${listCounts(kinds)}. If it's all the same kind of spending, put it together.`,
        ids: others.map((t) => t.id),
        fix: { type: "categorise", ids: others.map((t) => t.id), category: main, label: `Put all in ${main}` },
      },
    ];
  });
}

/** The suburb or town at the end of a bank description ("DENMARK TAVERN, DENMARK"). */
function townOf(t: Transaction) {
  const m = t.description.match(/,\s*([A-Za-z][A-Za-z .'-]{1,28}?)\s*$/);
  return m ? m[1].trim().toUpperCase().replace(/\s+/g, " ") : null;
}

/**
 * Days of spending in places I don't usually go, not in Travel. (Trips to Denmark,
 * Cervantes, Margaret River and Vietnam had meals, fuel and shops left in their everyday categories.)
 */
function trips(transactions: Transaction[]): Issue[] {
  const weeks = new Map<string, Set<string>>();
  for (const t of transactions) {
    const town = townOf(t);
    if (town) weeks.set(town, (weeks.get(town) ?? new Set()).add(weekStart(t.day)));
  }
  const away = transactions
    .filter((t) => {
      const town = townOf(t);
      return t.amountCents < 0 && town !== null && weeks.get(town)!.size < LOCAL_WEEKS && !NOT_TRIP.has(t.category ?? "");
    })
    .sort((a, b) => a.day.localeCompare(b.day));

  // Runs of spending away, no more than a day apart.
  const runs: Transaction[][] = [];
  for (const t of away) {
    const run = runs.at(-1);
    if (run && daysBetween(run.at(-1)!.day, t.day) <= 1) run.push(t);
    else runs.push([t]);
  }
  return runs.flatMap((run): Issue[] => {
    const towns = countBy(run, (t) => townOf(t)!);
    // Overnight, at two or more places in the main town; otherwise it's a day out, or one
    // online shop billing from its head office (Football Australia, Moore Park).
    const main = run.filter((t) => townOf(t) === towns[0][0]);
    if (new Set(run.map((t) => t.day)).size < 2 || new Set(main.map(merchantName)).size < 2) return [];
    const move = run.filter((t) => !isFixed(t.sortedBy));
    if (move.length === 0) return [];
    const span = { from: run[0].day, to: run.at(-1)!.day };
    const names = [...new Set(move.map(merchantName))];
    return [
      {
        id: `trip:${span.from}:${towns[0][0]}`,
        title: `Looks like a trip to ${titleCase(towns[0][0])}, ${spanLabel(span)}`,
        detail: `${plural(move.length, "payment")} while you were away (${money(-move.reduce((s, t) => s + t.amountCents, 0))}) aren't in Travel: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}.`,
        ids: move.map((t) => t.id),
        fix: { type: "categorise", ids: move.map((t) => t.id), category: TRAVEL, label: `Move ${move.length} to Travel` },
      },
    ];
  });
}

/** Everything that looks off, without the ones I've left. */
export function findIssues(transactions: Transaction[], rules: Rule[], categories: string[], ownerName: string, left: Set<string>) {
  return [
    ...broadRules(transactions, rules),
    ...paybacks(transactions),
    ...ownName(transactions, ownerName),
    ...mixedNames(transactions),
    ...(categories.includes(TRAVEL) ? trips(transactions) : []),
  ].filter((issue) => !left.has(issue.id));
}
