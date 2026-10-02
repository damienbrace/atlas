import "server-only";
import { randomUUID } from "node:crypto";
import { lifeDb } from "./db";
import { dayKey } from "./days";

export interface Habit {
  id: string;
  name: string;
  /** Hex colour from HABIT_COLORS. */
  color: string;
  /** Weekdays it's due, 0 = Sunday. */
  days: number[];
  /** Day it was added (YYYY-MM-DD). Earlier days don't count as missed. */
  since: string;
}

/** Habits plus the days each was done, for the window the screen shows. */
export interface HabitsData {
  habits: Habit[];
  done: Record<string, string[]>;
}

// Teal stays reserved for Atlas; habits get the other accent colours.
export const HABIT_COLORS = ["#60a5fa", "#a78bfa", "#f5a524", "#4ade80", "#f87171", "#f472b6"];

interface HabitRow {
  id: string;
  name: string;
  color: string;
  days: string;
  created_at: number;
}

const toHabit = (r: HabitRow): Habit => ({
  id: r.id,
  name: r.name,
  color: r.color,
  days: [...r.days].map(Number),
  since: dayKey(new Date(r.created_at)),
});

export function listHabits() {
  return (lifeDb().prepare("SELECT * FROM habits WHERE archived = 0 ORDER BY position, created_at").all() as unknown as HabitRow[]).map(
    toHabit,
  );
}

/** Habits and their ticks from `since` (YYYY-MM-DD) on. */
export function habitsData(since: string): HabitsData {
  const habits = listHabits();
  const rows = lifeDb().prepare("SELECT habit_id, day FROM habit_checks WHERE day >= ? ORDER BY day").all(since) as {
    habit_id: string;
    day: string;
  }[];
  const done: Record<string, string[]> = Object.fromEntries(habits.map((h) => [h.id, []]));
  for (const r of rows) done[r.habit_id]?.push(r.day);
  return { habits, done };
}

export function setDone(habitId: string, day: string, done: boolean) {
  if (done) lifeDb().prepare("INSERT OR IGNORE INTO habit_checks (habit_id, day) VALUES (?, ?)").run(habitId, day);
  else lifeDb().prepare("DELETE FROM habit_checks WHERE habit_id = ? AND day = ?").run(habitId, day);
}

export function createHabit(name: string, color: string, days: number[]) {
  const id = randomUUID();
  const position = (lifeDb().prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM habits").get() as { p: number }).p;
  lifeDb()
    .prepare("INSERT INTO habits (id, name, color, days, position, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, name, color, days.join(""), position, Date.now());
  return id;
}

export function updateHabit(id: string, name: string, color: string, days: number[]) {
  lifeDb().prepare("UPDATE habits SET name = ?, color = ?, days = ? WHERE id = ?").run(name, color, days.join(""), id);
}

/** Hides a habit but keeps its history. */
export function archiveHabit(id: string) {
  lifeDb().prepare("UPDATE habits SET archived = 1 WHERE id = ?").run(id);
}

export function findHabit(name: string) {
  const all = listHabits();
  const wanted = name.trim().toLowerCase();
  return all.find((h) => h.name.toLowerCase() === wanted) ?? null;
}
