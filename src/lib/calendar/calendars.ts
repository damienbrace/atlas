import type { CalendarId } from "./types";

// Event colours. Teal stays reserved for Atlas, so calendars use blue, violet and amber.

export const CALENDARS: { id: CalendarId; label: string; dot: string; chip: string }[] = [
  { id: "work", label: "Work", dot: "bg-blue", chip: "border-blue/25 bg-event-blue text-ink" },
  { id: "admin", label: "Home & admin", dot: "bg-violet", chip: "border-violet/25 bg-event-violet text-ink" },
  { id: "bills", label: "Bills", dot: "bg-amber", chip: "border-amber/25 bg-event-amber text-amber" },
];

export function calendarFor(id: CalendarId) {
  return CALENDARS.find((c) => c.id === id)!;
}
