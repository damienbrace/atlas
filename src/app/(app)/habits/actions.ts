"use server";

import { dayKey, isDayKey } from "@/lib/life/days";
import { archiveHabit, createHabit, HABIT_COLORS, setDone, updateHabit } from "@/lib/life/habits";

// Server Functions are public endpoints: validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);

function cleanHabit(name: unknown, color: unknown, days: unknown) {
  if (typeof name !== "string" || !name.trim() || name.length > 80) return null;
  if (typeof color !== "string" || !HABIT_COLORS.includes(color)) return null;
  if (!Array.isArray(days) || days.length === 0 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  return { name: name.trim(), color, days: [...new Set(days as number[])].sort() };
}

export async function markHabit(habitId: string, day: string, done: boolean) {
  if (!isId(habitId) || !isDayKey(day) || typeof done !== "boolean") return { ok: false as const };
  setDone(habitId, day, done);
  return { ok: true as const };
}

export async function saveHabit(input: { id?: string; name: string; color: string; days: number[] }) {
  const habit = cleanHabit(input.name, input.color, input.days);
  if (!habit || (input.id !== undefined && !isId(input.id))) return { ok: false as const };
  if (input.id) {
    updateHabit(input.id, habit.name, habit.color, habit.days);
    return { ok: true as const, id: input.id };
  }
  return { ok: true as const, id: createHabit(habit.name, habit.color, habit.days), since: dayKey(new Date()) };
}

export async function removeHabit(habitId: string) {
  if (!isId(habitId)) return { ok: false as const };
  archiveHabit(habitId);
  return { ok: true as const };
}
