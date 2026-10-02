import { DAYS, MONTHS } from "@/lib/format";
import type { View } from "./types";

// Calendar days are local "YYYY-MM-DD" keys and times are "HH:MM", so nothing
// shifts with time zones or daylight saving.

const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Column headings, Monday first. */
export const WEEKDAYS = [...DAYS.slice(1), DAYS[0]];

const pad = (n: number) => String(n).padStart(2, "0");

export function toKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Same day `n` months on, pulled back to the last day of shorter months (31 Jan → 28 Feb). */
export function addMonths(key: string, n: number) {
  const d = fromKey(key);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return toKey(target);
}

/** Monday of the week that contains `key`. */
export function startOfWeek(key: string) {
  return addDays(key, -((fromKey(key).getDay() + 6) % 7));
}

export function weekOf(key: string) {
  const monday = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Whole Monday-to-Sunday weeks covering the month that contains `key` (5 or 6 of them). */
export function monthWeeks(key: string) {
  const first = `${key.slice(0, 7)}-01`;
  const weeks: string[][] = [];
  for (let monday = startOfWeek(first); sameMonth(monday, first) || weeks.length === 0; monday = addDays(monday, 7)) {
    weeks.push(weekOf(monday));
  }
  return weeks;
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

export const dayOfMonth = (key: string) => Number(key.slice(8));

export function isWeekend(key: string) {
  const day = fromKey(key).getDay();
  return day === 0 || day === 6;
}

export function toMinutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "07:30" → "7:30 AM" */
export function timeLabel(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

/** Compact time for event chips: "07:30" → "7:30am", "16:00" → "4pm". */
export function shortTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** Time-grid gutter: 7 → "7 AM". */
export function hourLabel(hour: number) {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** "30 minutes", "1 hour", "1 hr 30 min" */
export function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hour${h === 1 ? "" : "s"}`;
}

/** "Thursday, 1 October" */
export function longDate(key: string) {
  const d = fromKey(key);
  return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

/** "Thu 1 Oct" */
export function shortDate(key: string) {
  const d = fromKey(key);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const weekdayName = (key: string) => DAYS[fromKey(key).getDay()];
export const weekdayLongName = (key: string) => DAYS_LONG[fromKey(key).getDay()];

/** Toolbar heading: "October 2026", "28 Sep – 4 Oct 2026" or "Thu 1 Oct 2026". `compact` drops the year from weeks and days. */
export function rangeLabel(view: View, key: string, compact = false) {
  const d = fromKey(key);
  const year = compact ? "" : ` ${d.getFullYear()}`;
  if (view === "month") return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
  if (view === "day") return `${shortDate(key)}${year}`;
  const week = weekOf(key);
  const first = fromKey(week[0]);
  const last = fromKey(week[6]);
  const from = first.getMonth() === last.getMonth() ? `${first.getDate()}` : `${first.getDate()} ${MONTHS[first.getMonth()]}`;
  return `${from} – ${last.getDate()} ${MONTHS[last.getMonth()]}${year}`;
}
