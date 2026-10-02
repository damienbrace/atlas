import type { Metadata } from "next";
import { connection } from "next/server";
import { Calendar } from "@/components/calendar/calendar";
import { datedTasks } from "@/lib/life/tasks";

export const metadata: Metadata = { title: "Calendar · Atlas" };

/** Ticked-off tasks stay on the week list (struck through) for this long. */
const DONE_DAYS = 14;

export default async function CalendarPage() {
  await connection();
  return <Calendar tasks={await datedTasks(DONE_DAYS)} />;
}
