import "server-only";
import type { CalendarEvent } from "@/lib/calendar/types";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { CALENDAR_SCOPE } from "@/lib/gmail/oauth";
import { calendarEvents } from "@/lib/google/calendar";
import type { Email } from "@/lib/inbox/types";
import { addDays, dayKey } from "@/lib/life/days";
import { habitsData, type Habit } from "@/lib/life/habits";
import { listEntries } from "@/lib/life/journal";
import { getSetting } from "@/lib/life/settings";
import { briefTasks, type Task } from "@/lib/life/tasks";
import { isBriefSection, type BriefSection } from "@/lib/brief-sections";
import { firstPage } from "@/lib/mail/inbox";
import { startSync, syncStatus } from "@/lib/mail/sync";
import { getWeather, type Weather } from "@/lib/weather";

// Everything the Brief (home screen) shows, gathered in one pass on the server.

export interface BriefData {
  name: string;
  greeting: string;
  today: string;
  weather: Weather | null;
  calendar: { status: "ok" | "needs-permission" | "not-connected" | "error"; events: CalendarEvent[] };
  gmailConnected: boolean;
  replies: Email[];
  waiting: Email[];
  stillSorting: boolean;
  habits: Habit[];
  habitsDone: string[];
  journalWords: number | null;
  tasks: Task[];
  /** Parts of the Brief you've hidden. */
  hidden: BriefSection[];
}

const MAX_REPLIES = 5;
const MAX_WAITING = 4;

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

async function todaysEvents(refreshToken: string, scopes: string[] | undefined, today: string): Promise<BriefData["calendar"]> {
  if (!scopes?.includes(CALENDAR_SCOPE)) return { status: "needs-permission", events: [] };
  try {
    const { events } = await calendarEvents(refreshToken, today, addDays(today, 1));
    return { status: "ok", events: events.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")) };
  } catch (error) {
    console.error("[atlas] brief calendar failed", error);
    return { status: "error", events: [] };
  }
}

/** The Brief for whoever's signed in. Opening it also checks Gmail for new mail in the background. */
export async function getBrief(): Promise<BriefData> {
  const session = await getSession();
  if (session) startSync(session.email, session.refreshToken);
  return buildBrief(session);
}

/** The Brief's data for a Google account (or none), without starting a sync. The 5am notification uses it too. */
export async function buildBrief(session: { email: string; refreshToken: string; scopes?: string[] } | null): Promise<BriefData> {
  const now = new Date();
  const today = dayKey(now);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [weather, calendar, inbox, sync, { habits, done }, entries, tasks, hidden] = await Promise.all([
    getWeather(),
    session ? todaysEvents(session.refreshToken, session.scopes, today) : Promise.resolve({ status: "not-connected" as const, events: [] }),
    session ? firstPage() : Promise.resolve(null),
    session ? syncStatus() : Promise.resolve(null),
    habitsData(today),
    listEntries(),
    briefTasks(today, todayStart),
    getSetting<unknown[]>("brief.hidden", []),
  ]);

  const emails = inbox?.emails ?? [];
  const replies = emails.filter((e) => e.category === "action" && e.direction === "in" && !e.repliedAt).slice(0, MAX_REPLIES);
  const waiting = emails.filter((e) => e.category === "waiting").slice(0, MAX_WAITING);

  const habitsDone = habits.filter((h) => done[h.id]?.includes(today)).map((h) => h.id);
  const entry = entries.find((e) => e.day === today);

  return {
    name: env.ownerName,
    greeting: greeting(now.getHours()),
    today,
    weather,
    calendar,
    gmailConnected: Boolean(session),
    replies,
    waiting,
    stillSorting: (sync?.sortingLeft ?? 0) > 0,
    habits,
    habitsDone,
    journalWords: entry?.body.trim() ? entry.body.trim().split(/\s+/).length : null,
    tasks,
    hidden: hidden.filter(isBriefSection),
  };
}
