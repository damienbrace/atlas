import { DAYS, MONTHS } from "@/lib/format";

// Local calendar days as "YYYY-MM-DD" strings. Safe in the browser and on the server.

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export const isDayKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDay(value).getTime());

const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Friday 2 October" */
export function longDay(key: string) {
  const d = parseDay(key);
  return `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getMonth()]}`;
}

/** "Fri 2 Oct" */
export function shortDay(key: string) {
  const d = parseDay(key);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Consecutive days ending today (or yesterday, if today isn't done yet). */
export function streak(done: Set<string>, today: string, isDue: (key: string) => boolean = () => true) {
  let day = done.has(today) ? today : addDays(today, -1);
  let count = 0;
  for (let i = 0; i < 3660; i++) {
    if (done.has(day)) count++;
    else if (isDue(day)) break;
    day = addDays(day, -1);
  }
  return count;
}
