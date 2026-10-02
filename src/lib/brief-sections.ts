// The parts of the Brief that can be hidden. Safe in the browser and on the server.

export const BRIEF_SECTIONS = [
  { id: "summary", label: "Atlas summary" },
  { id: "weather", label: "Weather" },
  { id: "today", label: "Today's calendar" },
  { id: "needs", label: "Needs you" },
  { id: "habits", label: "Habits" },
  { id: "journal", label: "Journal" },
] as const;

export type BriefSection = (typeof BRIEF_SECTIONS)[number]["id"];

export const isBriefSection = (value: unknown): value is BriefSection => BRIEF_SECTIONS.some((s) => s.id === value);
