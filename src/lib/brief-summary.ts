import type { BriefData } from "@/lib/brief";
import type { BriefSection } from "@/lib/brief-sections";

// Atlas's one-line read of the day, shared by the Brief screen and the 5am notification.

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pieces of the summary, each tagged with the part of the Brief it comes from. */
export function summaryParts(data: BriefData) {
  const parts: { section: BriefSection; text: string }[] = [];
  if (data.replies.length) parts.push({ section: "needs", text: `${plural(data.replies.length, "reply", "replies")} needed` });
  if (data.calendar.status === "ok") {
    const n = data.calendar.events.length;
    parts.push({ section: "today", text: n ? `${plural(n, "event")} today` : "a clear calendar" });
  }
  if (data.weather?.rainFrom) parts.push({ section: "weather", text: `showers likely from ${data.weather.rainFrom}` });
  else if (data.weather?.hot) parts.push({ section: "weather", text: `a hot one at ${data.weather.today.high}°` });
  const left = data.habits.length - data.habitsDone.length;
  if (left > 0) parts.push({ section: "habits", text: `${plural(left, "habit")} to tick off` });
  const dueTasks = data.tasks.filter((t) => !t.done && t.dueDay !== null && t.dueDay <= data.today).length;
  if (dueTasks) parts.push({ section: "needs", text: `${plural(dueTasks, "task")} due` });
  return parts;
}

/** The parts that are showing, as one sentence. */
export function summarySentence(texts: string[]) {
  if (texts.length === 0) return "Nothing urgent today. A clear run.";
  const joined = texts.length === 1 ? texts[0] : `${texts.slice(0, -1).join(", ")} and ${texts.at(-1)}`;
  return `${joined[0].toUpperCase()}${joined.slice(1)}.`;
}
