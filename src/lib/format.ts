// Hand-rolled date formats so server and browser output match ("9:14 AM", "Thu 1 Oct").

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function clock(d: Date) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** Whole calendar days between two dates, in local time. */
export function daysBetween(earlier: Date, later: Date) {
  const a = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const b = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function dayMonth(d: Date) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** List column: "9:14 AM", "Yesterday", "Mon", "24 Sep". */
export function listTime(iso: string, now: Date) {
  const d = new Date(iso);
  const days = daysBetween(d, now);
  if (days <= 0) return clock(d);
  if (days === 1) return "Yesterday";
  if (days < 7) return DAYS[d.getDay()];
  return dayMonth(d);
}

/** Open email header: "9:14 AM" today, otherwise "Wed 30 Sep, 4:40 PM". */
export function headerTime(iso: string, now: Date) {
  const d = new Date(iso);
  if (daysBetween(d, now) <= 0) return clock(d);
  return `${DAYS[d.getDay()]} ${dayMonth(d)}, ${clock(d)}`;
}

/** Full timestamp: "Thu 1 Oct 2026, 9:14 AM". */
export function fullTime(iso: string) {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${dayMonth(d)} ${d.getFullYear()}, ${clock(d)}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export const URL_PATTERN = /<?(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])>?/g;

/** Email body minus the greeting, links and separator lines, for one- or two-line previews. */
export function previewText(body: string) {
  return body
    .replace(/^(hi|hello|hey|dear)\b[^\n]*\n+/i, "")
    .replace(URL_PATTERN, " ")
    .replace(/\[\s*\]|\(\s*\)/g, " ")
    .replace(/[-=_*~]{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "https://www.seek.com.au/job/123?x=y" → "seek.com.au" */
export function linkLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}
