import { addDays } from "@/lib/life/days";
import { merchantName } from "./merchant";
import type { Cadence, Recurring } from "./recurring";
import type { Transaction } from "./types";

// What subscriptions cost a month and a year, which are new, which went up, and where
// several do the same job (four AI tools, three debrid services). Safe in the browser and
// on the server.

const SUBSCRIPTIONS = "Subscriptions";
/** Charged in this many days to count as current. */
const CURRENT_DAYS = 60;
/** First charged this recently: new. */
const NEW_DAYS = 60;
/** A lone charge this recent counts as a month's worth. */
const SINGLE_DAYS = 45;

/** Kinds of subscription that often overlap. */
const KINDS: { kind: string; test: RegExp }[] = [
  { kind: "AI tools", test: /chatgpt|openai|claude|anthropic|gemini|perplexity|midjourney|copilot|cursor/i },
  { kind: "video streaming services", test: /netflix|\bstan\b|binge|disney|paramount|kayo|foxtel|youtube premium|prime video|apple tv|hayu/i },
  { kind: "music and audio services", test: /spotify|apple music|tidal|deezer|audible/i },
  { kind: "cloud storage plans", test: /google one|icloud|dropbox|onedrive/i },
  { kind: "debrid services", test: /debrid|torbox|premiumize/i },
  { kind: "VPNs", test: /\bvpn\b|nordvpn|nord security|surfshark|expressvpn|proton/i },
];

export interface Subscription {
  name: string;
  /** What it costs a month: from its schedule, or the last year's charges spread out when it has none. */
  monthlyCents: number;
  cadence: Cadence | null;
  firstDay: string;
  lastDay: string;
  nextDay: string | null;
  /** The latest charge is up on the usual one. */
  rose: boolean;
  /** First charged in the last 60 days. */
  isNew: boolean;
}

export interface Overlap {
  kind: string;
  names: string[];
  monthlyCents: number;
}

export function auditSubscriptions(transactions: Transaction[], recurring: Recurring[], today: string) {
  const yearAgo = addDays(today, -364);
  const byName = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.category !== SUBSCRIPTIONS || t.amountCents >= 0 || t.excluded) continue;
    const name = merchantName(t);
    byName.set(name, [...(byName.get(name) ?? []), t]);
  }

  const subscriptions: Subscription[] = [];
  for (const [name, all] of byName) {
    const days = all.map((t) => t.day).sort();
    const lastDay = days.at(-1)!;
    if (lastDay < addDays(today, -CURRENT_DAYS)) continue; // stopped, by the look of it
    const schedules = recurring.filter((r) => r.name === name);
    // No schedule yet: one recent charge is most likely a new monthly one; otherwise
    // spread the last year's charges over its months.
    const monthlyCents = schedules.length
      ? schedules.reduce((sum, r) => sum + r.monthlyCents, 0)
      : all.length === 1 && lastDay >= addDays(today, -SINGLE_DAYS)
        ? -all[0].amountCents
        : Math.round(all.filter((t) => t.day >= yearAgo).reduce((sum, t) => sum - t.amountCents, 0) / 12);
    subscriptions.push({
      name,
      monthlyCents,
      cadence: schedules[0]?.cadence ?? null,
      firstDay: days[0],
      lastDay,
      nextDay: schedules.length ? schedules.map((r) => r.nextDay).sort()[0] : null,
      rose: schedules.some((r) => r.rose),
      isNew: days[0] >= addDays(today, -NEW_DAYS),
    });
  }
  subscriptions.sort((a, b) => b.monthlyCents - a.monthlyCents);

  const overlaps: Overlap[] = KINDS.flatMap(({ kind, test }) => {
    const same = subscriptions.filter((s) => test.test(s.name));
    return same.length >= 2 ? [{ kind, names: same.map((s) => s.name), monthlyCents: same.reduce((sum, s) => sum + s.monthlyCents, 0) }] : [];
  });

  const monthlyCents = subscriptions.reduce((sum, s) => sum + s.monthlyCents, 0);
  return { subscriptions, overlaps, monthlyCents, yearCents: monthlyCents * 12 };
}
