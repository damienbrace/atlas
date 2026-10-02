import "server-only";
import type { CalendarEvent, CalendarId } from "@/lib/calendar/types";
import { accessTokenFor, forgetAccessToken } from "@/lib/gmail/oauth";
import { htmlToText, tidyText } from "@/lib/gmail/parse";
import { addDays, dayKey, parseDay } from "@/lib/life/days";

// Read-only Google Calendar. https://developers.google.com/calendar/api/v3/reference
// Times are converted to local time where Atlas runs (your PC), which is your time zone.

const API = "https://www.googleapis.com/calendar/v3";
// The Calendar screen has three colour slots; Google calendars take them in turn, yours first.
const SLOTS: CalendarId[] = ["work", "admin", "bills"];
const MAX_DAYS_PER_EVENT = 31;

export class CalendarHttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Google Calendar failed: ${status} ${reason}`.trim());
  }
}

async function get<T>(refreshToken: string, path: string, retried = false): Promise<T> {
  const token = await accessTokenFor(refreshToken);
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.ok) return res.json() as Promise<T>;
  if (res.status === 401 && !retried) {
    forgetAccessToken(refreshToken);
    return get(refreshToken, path, true);
  }
  const body = await res.json().catch(() => null);
  throw new CalendarHttpError(res.status, body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "");
}

interface GoogleCalendar {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
}

interface GoogleTime {
  date?: string;
  dateTime?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: GoogleTime;
  end: GoogleTime;
}

export interface CalendarInfo {
  id: string;
  name: string;
  slot: CalendarId;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function toEvents(e: GoogleEvent, calendar: CalendarInfo): CalendarEvent[] {
  if (e.status === "cancelled") return [];
  const base = {
    title: e.summary?.trim() || "(No title)",
    calendar: calendar.slot,
    calendarName: calendar.name,
    location: e.location || undefined,
    notes: e.description ? tidyText(htmlToText(e.description)).trim() || undefined : undefined,
    link: e.htmlLink,
    readOnly: true as const,
  };

  if (e.start.date && e.end.date) {
    // All day: the end date is exclusive. One entry per day it covers.
    const out: CalendarEvent[] = [];
    for (let day = e.start.date; day < e.end.date && out.length < MAX_DAYS_PER_EVENT; day = addDays(day, 1)) {
      out.push({ ...base, id: `${calendar.id}:${e.id}:${day}`, date: day });
    }
    return out;
  }

  if (!e.start.dateTime || !e.end.dateTime) return [];
  const start = new Date(e.start.dateTime);
  const end = new Date(e.end.dateTime);
  const first = dayKey(start);
  const last = dayKey(new Date(end.getTime() - 1));
  if (first === last) return [{ ...base, id: `${calendar.id}:${e.id}`, date: first, start: hhmm(start), end: hhmm(end) }];

  // Runs past midnight: the first and last days get their times, any days between are all day.
  const out: CalendarEvent[] = [{ ...base, id: `${calendar.id}:${e.id}:${first}`, date: first, start: hhmm(start), end: "23:59" }];
  for (let day = addDays(first, 1); day < last && out.length < MAX_DAYS_PER_EVENT; day = addDays(day, 1)) {
    out.push({ ...base, id: `${calendar.id}:${e.id}:${day}`, date: day });
  }
  out.push({ ...base, id: `${calendar.id}:${e.id}:${last}`, date: last, start: "00:00", end: hhmm(end) });
  return out;
}

/** Events from every calendar you show in Google Calendar, for days `from` up to (not including) `to`. */
export async function calendarEvents(refreshToken: string, from: string, to: string) {
  const list = await get<{ items?: GoogleCalendar[] }>(refreshToken, "/users/me/calendarList?minAccessRole=reader");
  const calendars: CalendarInfo[] = (list.items ?? [])
    .filter((c) => c.selected !== false && !c.hidden)
    .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
    .map((c, i) => ({ id: c.id, name: c.primary ? "My calendar" : c.summaryOverride || c.summary, slot: SLOTS[i % SLOTS.length] }));

  const params = new URLSearchParams({
    timeMin: parseDay(from).toISOString(),
    timeMax: parseDay(to).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  });
  const perCalendar = await Promise.all(
    calendars.map(async (c) => {
      const res = await get<{ items?: GoogleEvent[] }>(refreshToken, `/calendars/${encodeURIComponent(c.id)}/events?${params}`);
      return (res.items ?? []).flatMap((e) => toEvents(e, c));
    }),
  );
  const events = perCalendar.flat().filter((e) => e.date >= from && e.date < to);
  return { calendars, events };
}
