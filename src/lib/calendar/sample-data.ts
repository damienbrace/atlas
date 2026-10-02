import { addDays, startOfWeek } from "./dates";
import type { CalendarEvent, Suggestion } from "./types";

// Fictional sample calendar used until a real calendar is connected. Events are
// placed relative to today, so the month always looks lived-in.

export function buildSampleCalendar(today: string): { events: CalendarEvent[]; suggestion: Suggestion } {
  const monday = startOfWeek(today);
  /** `weekday` 0 is Monday, `weeks` after the current week. */
  const on = (weeks: number, weekday: number) => addDays(monday, weeks * 7 + weekday);

  const events: CalendarEvent[] = [
    { id: "site-visit", title: "Site visit", calendar: "work", date: today, start: "07:30", end: "08:30", location: "Hillview Rd" },
    { id: "hillview-brickwork", title: "Hillview brickwork", calendar: "work", date: today, start: "09:00", end: "11:45" },
    {
      id: "accountant",
      title: "Call with accountant",
      calendar: "admin",
      date: today,
      start: "12:00",
      end: "12:30",
      notes: "BAS for the September quarter.",
    },
    {
      id: "supplier-pickup",
      title: "Supplier pickup",
      calendar: "work",
      date: today,
      start: "16:00",
      end: "16:30",
      notes: "Bayside Brick & Block, two pallets of commons.",
    },
    { id: "finish-wall", title: "Finish wall", calendar: "work", date: addDays(today, 1), location: "Hillview Rd" },
    {
      id: "supplier-meeting",
      title: "Supplier meeting",
      calendar: "work",
      date: on(1, 0),
      start: "08:00",
      end: "09:00",
      location: "Bayside Brick & Block",
    },
    { id: "quote-follow-up", title: "Quote follow-up", calendar: "admin", date: on(1, 2), notes: "Ridge St and Hillview quotes." },
    { id: "electricity", title: "Electricity due", calendar: "bills", date: on(1, 4), notes: "$284" },
    { id: "family-lunch", title: "Family lunch", calendar: "admin", date: on(1, 5), start: "12:30", end: "14:30" },
    { id: "phone-bill", title: "Phone bill", calendar: "bills", date: on(2, 2), notes: "$79" },
    {
      id: "lodge-check-in",
      title: "Lodge check-in",
      calendar: "work",
      date: on(2, 4),
      location: "Henty Lodge",
      notes: "The Parkers, two nights.",
    },
    { id: "site-measure", title: "Site measure", calendar: "work", date: on(3, 1), location: "Ridge St" },
    { id: "project-review", title: "Project review", calendar: "admin", date: on(3, 4) },
    { id: "admin-morning", title: "Admin morning", calendar: "admin", date: on(4, 1), start: "08:00", end: "12:00" },
    { id: "month-review", title: "Month review", calendar: "work", date: on(4, 4) },
  ];

  // Ties to Sarah's email in the sample inbox: she's waiting on the Hillview quote.
  const suggestion: Suggestion = {
    id: "sarah-quote",
    heading: "Time for Sarah's quote",
    event: {
      title: "Hillview quote for Sarah",
      calendar: "work",
      date: today,
      start: "14:00",
      end: "14:30",
      notes: "Sarah Miller is waiting on the Hillview quote. Send it by 5 PM.",
    },
  };

  return { events, suggestion };
}
