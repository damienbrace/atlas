import { env } from "@/lib/env";
import { isHermesRequest } from "@/lib/hermes";
import { dayKey } from "@/lib/life/days";
import { getUpStatus, listTransactions } from "@/lib/money/db";
import { buildReview, lastMonth, reviewPath, reviewText, type ReviewChoice } from "@/lib/money/review";

// A month or year in review as a Telegram message, for when it's asked for ("how did
// September go?"). The monthly one also arrives by itself on the 1st, through alerts.
// Bearer HERMES_SECRET.
//
// GET                   last month: { title, text, url }; send `text`
// GET ?month=2026-09    that month (this month runs to today)
// GET ?year=2026        a calendar year; ?year=fy2026 is July 2025 to June 2026; ?year=12m the last 12 months

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^(12m|\d{4}|fy\d{4})$/;

export async function GET(request: Request) {
  if (!isHermesRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const today = dayKey(new Date());
  const month = params.get("month");
  const year = params.get("year");
  if (month !== null && !MONTH.test(month)) return Response.json({ error: "month must be YYYY-MM" }, { status: 400 });
  if (year !== null && !YEAR.test(year)) return Response.json({ error: "year must be YYYY, fyYYYY or 12m" }, { status: 400 });
  const choice: ReviewChoice = year ? { kind: "year", id: year } : { kind: "month", id: month ?? lastMonth(today) };

  const [transactions, up] = await Promise.all([listTransactions(), getUpStatus()]);
  const url = `${env.appUrl}${reviewPath(choice)}`;
  return Response.json({ ...reviewText(buildReview({ transactions, accounts: up?.accounts ?? [], today, choice }), url), url });
}
