import { env } from "@/lib/env";
import { isHermesRequest } from "@/lib/hermes";
import { dayKey, isDayKey } from "@/lib/life/days";
import { findIssues } from "@/lib/money/checks";
import { getCategories, getLeftChecks, getUpStatus, listFlags, listRules, listTransactions } from "@/lib/money/db";
import { findRecurring } from "@/lib/money/recurring";
import { weeklySummary } from "@/lib/money/weekly";

// Hermes fetches the weekly money message here on Sundays and sends it on Telegram: the
// week so far (Monday to the day asked, today by default) against a usual week, where it
// went, savers, bills due next, habits and subscriptions. Bearer HERMES_SECRET.
//
// GET              { title, text, from, to, spentCents, usualCents }; send `text`
// GET ?day=YYYY-MM-DD   the week holding that day, up to it

export async function GET(request: Request) {
  if (!isHermesRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const asked = new URL(request.url).searchParams.get("day");
  if (asked !== null && !isDayKey(asked)) return Response.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  const today = asked ?? dayKey(new Date());

  const [all, up, flags, left, rules, categories] = await Promise.all([
    listTransactions(),
    getUpStatus(),
    listFlags(),
    getLeftChecks(),
    listRules(),
    getCategories(),
  ]);
  const transactions = all.filter((t) => t.day <= today);
  const recurring = findRecurring(
    transactions.filter((t) => !t.excluded),
    today,
  );
  // Things to check: Atlas's flags that still apply, and the page's own checks.
  const openFlags = flags.filter((f) => transactions.some((t) => t.merchantKey === f.merchantKey && t.category === f.currentCategory && !t.splits)).length;
  const openChecks = openFlags + findIssues(transactions, rules, categories, env.ownerName, new Set(left)).length;

  return Response.json(weeklySummary({ transactions, accounts: up?.accounts ?? [], recurring, today, openChecks }));
}
