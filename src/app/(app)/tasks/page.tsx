import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Tasks } from "@/components/tasks/tasks";
import { dayKey } from "@/lib/life/days";
import { fillBriefsLater, keptBriefs } from "@/lib/life/task-brief";
import { TASK_VIEW_COOKIE } from "@/lib/life/task-rules";
import { pendingSuggestions } from "@/lib/life/task-suggestions";
import { listTasks } from "@/lib/life/tasks";

export const metadata: Metadata = { title: "Tasks · Atlas" };
/** Room for Atlas to write any missing summaries after the page has gone out. */
export const maxDuration = 60;

/** The Done list shows this far back; search reaches everything. */
const DONE_DAYS = 30;

export default async function TasksPage() {
  await connection();
  const [tasks, suggestions, jar] = await Promise.all([listTasks(DONE_DAYS), pendingSuggestions(), cookies()]);
  const briefs = await keptBriefs(tasks);
  fillBriefsLater(6);
  const view = jar.get(TASK_VIEW_COOKIE)?.value === "board" ? "board" : "list";
  return <Tasks tasks={tasks} suggestions={suggestions} briefs={briefs} today={dayKey(new Date())} view={view} />;
}
