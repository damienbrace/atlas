import "server-only";
import { randomUUID } from "node:crypto";
import { lifeDb } from "./db";

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
export function listTasks(todayStart: number) {
  return (
    lifeDb()
      .prepare(
        `SELECT * FROM tasks WHERE done_at IS NULL OR done_at >= ?
         ORDER BY done_at IS NOT NULL, due_day IS NULL, due_day, created_at`,
      )
      .all(todayStart) as unknown as Row[]
  ).map(toTask);
}

export function addTask(title: string, dueDay: string | null, source: string) {
  const id = randomUUID();
  lifeDb()
    .prepare("INSERT INTO tasks (id, title, due_day, done_at, source, created_at) VALUES (?, ?, ?, NULL, ?, ?)")
    .run(id, title, dueDay, source, Date.now());
  return id;
}

export function setTaskDone(id: string, done: boolean) {
  lifeDb().prepare("UPDATE tasks SET done_at = ? WHERE id = ?").run(done ? Date.now() : null, id);
}
