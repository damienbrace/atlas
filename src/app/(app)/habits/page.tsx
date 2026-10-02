import type { Metadata } from "next";
import { connection } from "next/server";
import { Habits } from "@/components/habits/habits";
import { addDays, dayKey } from "@/lib/life/days";
import { HABIT_COLORS, habitsData } from "@/lib/life/habits";

export const metadata: Metadata = { title: "Habits · Atlas" };

// Enough history for long streaks and a year of month grids.
const HISTORY_DAYS = 400;

export default async function HabitsPage() {
  await connection();
  const today = dayKey(new Date());
  return <Habits data={habitsData(addDays(today, -HISTORY_DAYS))} today={today} colors={HABIT_COLORS} />;
}
