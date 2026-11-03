import { addDays, dayKey } from "./days";

// Plain rules for tasks, shared by the server and the Tasks screen.

/** The same areas as Notes, minus Ideas. */
export const TASK_AREAS = ["Bricklaying", "Henty Lodge", "Trading", "Home"] as const;
export type TaskArea = (typeof TASK_AREAS)[number];
export const isTaskArea = (value: unknown): value is TaskArea => (TASK_AREAS as readonly unknown[]).includes(value);

/** Same colours as the matching Notes tags. */
export const AREA_COLORS: Record<TaskArea, string> = {
  Bricklaying: "#f5a524",
  "Henty Lodge": "#a78bfa",
  Trading: "#60a5fa",
  Home: "#4ade80",
};

export const REPEATS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];
export const isRepeat = (value: unknown): value is Repeat => (REPEATS as readonly unknown[]).includes(value);

export const REPEAT_LABELS: Record<Repeat, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
};

/** Same day of the month `n` months on, kept inside shorter months (31 Jan + 1 month = 28/29 Feb). */
function addMonths(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dayKey(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}

function step(key: string, repeat: Repeat) {
  if (repeat === "daily") return addDays(key, 1);
  if (repeat === "weekly") return addDays(key, 7);
  return addMonths(key, repeat === "monthly" ? 1 : repeat === "quarterly" ? 3 : 12);
}

/**
 * When the next one is due after ticking off a repeating task. It follows the schedule,
 * not the day it was ticked: BAS due 28 Oct stays on the 28th whether lodged early or late.
 * If ticked very late, it skips ahead to the first date that isn't already past.
 */
export function nextDue(due: string | null, repeat: Repeat, today: string) {
  let next = step(due ?? today, repeat);
  while (next < today) next = step(next, repeat);
  return next;
}

/**
 * Repeating tasks keep out of the way until they're this close: a BAS due in April
 * doesn't need to sit on the Tasks page from October. Started ones always show.
 */
export const REPEAT_SHOW_DAYS = 14;

export function waitingToShow(t: { done: boolean; startedAt: number | null; repeat: Repeat | null; dueDay: string | null }, today: string) {
  return !t.done && !t.startedAt && t.repeat !== null && t.dueDay !== null && t.dueDay > addDays(today, REPEAT_SHOW_DAYS);
}

/** The Tasks page shows a list or a board; the choice is remembered in this cookie. */
export type TaskView = "list" | "board";
export const TASK_VIEW_COOKIE = "tasks-view";

export type TaskGroup = "overdue" | "today" | "week" | "later" | "someday";

export const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  someday: "Someday",
};

export function taskGroup(dueDay: string | null, today: string): TaskGroup {
  if (!dueDay) return "someday";
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  return dueDay <= addDays(today, 6) ? "week" : "later";
}
