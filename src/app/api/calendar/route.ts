import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { CALENDAR_SCOPE, GmailAuthExpiredError } from "@/lib/gmail/oauth";
import { CalendarHttpError, calendarEvents } from "@/lib/google/calendar";
import { addDays, isDayKey } from "@/lib/life/days";

const MAX_SPAN_DAYS = 120;

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD: your Google Calendar events for that range, read-only. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return Response.json({ status: "not-connected" });
  if (!session.scopes?.includes(CALENDAR_SCOPE)) return Response.json({ status: "needs-permission" });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!isDayKey(from) || !isDayKey(to) || to <= from || addDays(from, MAX_SPAN_DAYS) < to) {
    return Response.json({ status: "error", error: "Bad range" }, { status: 400 });
  }

  try {
    return Response.json({ status: "ok", ...(await calendarEvents(session.refreshToken, from, to)) });
  } catch (error) {
    if (error instanceof GmailAuthExpiredError) return Response.json({ status: "expired" });
    if (error instanceof CalendarHttpError && error.status === 403) {
      // The Calendar API isn't switched on in the Google Cloud project, or the permission was removed.
      const status = /accessNotConfigured|SERVICE_DISABLED/i.test(error.reason) ? "api-disabled" : "needs-permission";
      return Response.json({ status });
    }
    console.error("[atlas] calendar failed", error);
    return Response.json({ status: "error" });
  }
}
