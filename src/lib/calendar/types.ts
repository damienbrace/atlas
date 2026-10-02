export type CalendarId = "work" | "admin" | "bills";

export type View = "day" | "week" | "month";

export interface CalendarEvent {
  id: string;
  title: string;
  calendar: CalendarId;
  /** Local date, "2026-10-01". Events sit within a single day. */
  date: string;
  /** Local 24-hour times, "07:30". Both are missing for all-day events. */
  start?: string;
  end?: string;
  location?: string;
  notes?: string;
  /** Came from an Atlas suggestion that I approved. */
  fromAtlas?: boolean;
  /** Google Calendar events: read-only in Atlas, edited in Google Calendar. */
  readOnly?: boolean;
  calendarName?: string;
  /** Opens the event in Google Calendar. */
  link?: string;
}

/** Where the calendar's events come from right now. */
export type CalendarSource =
  | { kind: "loading" }
  | { kind: "google"; calendars: { id: string; name: string; slot: CalendarId }[] }
  | { kind: "sample"; reason: "not-connected" | "needs-permission" | "api-disabled" | "expired" | "error" };

/** Atlas proposing time in the calendar. Nothing is added until I approve it. */
export interface Suggestion {
  id: string;
  /** Card heading, e.g. "Time for Sarah's quote". */
  heading: string;
  event: Omit<CalendarEvent, "id" | "fromAtlas">;
}
