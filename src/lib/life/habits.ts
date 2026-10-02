import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
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

export async function listHabits() {
  return (await sql<HabitRow[]>`SELECT * FROM habits WHERE NOT archived ORDER BY position, created_at`).map(toHabit);
}

/** Habits and their ticks from `since` (YYYY-MM-DD) on. */
export async function habitsData(since: string): Promise<HabitsData> {
  const [habits, rows] = await Promise.all([
    listHabits(),
    sql<{ habit_id: string; day: string }[]>`SELECT habit_id, day FROM habit_checks WHERE day >= ${since} ORDER BY day`,
  ]);
  const done: Record<string, string[]> = Object.fromEntries(habits.map((h) => [h.id, []]));
  for (const r of rows) done[r.habit_id]?.push(r.day);
  return { habits, done };
}

export async function setDone(habitId: string, day: string, done: boolean) {
  if (done) await sql`INSERT INTO habit_checks (habit_id, day) VALUES (${habitId}, ${day}) ON CONFLICT DO NOTHING`;
  else await sql`DELETE FROM habit_checks WHERE habit_id = ${habitId} AND day = ${day}`;
}

export async function createHabit(name: string, color: string, days: number[]) {
  const id = randomUUID();
  await sql`
    INSERT INTO habits (id, name, color, days, position, created_at)
    SELECT ${id}, ${name}, ${color}, ${days.join("")}, COALESCE(MAX(position), 0) + 1, ${Date.now()} FROM habits`;
  return id;
}

export async function updateHabit(id: string, name: string, color: string, days: number[]) {
  await sql`UPDATE habits SET name = ${name}, color = ${color}, days = ${days.join("")} WHERE id = ${id}`;
}

/** Hides a habit but keeps its history. */
export async function archiveHabit(id: string) {
  await sql`UPDATE habits SET archived = TRUE WHERE id = ${id}`;
}
