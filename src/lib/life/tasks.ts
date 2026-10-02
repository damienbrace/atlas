import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

export interface Task {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null for "whenever". */
  dueDay: string | null;
  done: boolean;
}

interface Row {
  id: string;
  title: string;
  due_day: string | null;
  done_at: number | null;
}

const toTask = (r: Row): Task => ({ id: r.id, title: r.title, dueDay: r.due_day, done: r.done_at !== null });

/** Open tasks, plus ones finished today so a tick doesn't make them vanish mid-glance. */
export async function listTasks(todayStart: number) {
  const rows = await sql<Row[]>`
    SELECT * FROM tasks WHERE done_at IS NULL OR done_at >= ${todayStart}
    ORDER BY done_at IS NOT NULL, due_day IS NULL, due_day, created_at`;
  return rows.map(toTask);
}

export async function addTask(title: string, dueDay: string | null, source: string) {
  const id = randomUUID();
  await sql`
    INSERT INTO tasks (id, title, due_day, done_at, source, created_at)
    VALUES (${id}, ${title}, ${dueDay}, NULL, ${source}, ${Date.now()})`;
  return id;
}

export async function setTaskDone(id: string, done: boolean) {
  await sql`UPDATE tasks SET done_at = ${done ? Date.now() : null} WHERE id = ${id}`;
}
