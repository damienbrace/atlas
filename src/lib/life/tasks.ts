import "server-only";
import { randomUUID } from "node:crypto";
import { sql, textList } from "@/lib/db";
import { likePattern } from "@/lib/search-words";
import { addDays, dayKey } from "./days";
import { isRepeat, isTaskArea, nextDue, type Repeat, type TaskArea } from "./task-rules";

export interface Task {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null for "someday". */
  dueDay: string | null;
  done: boolean;
  doneAt: number | null;
  area: TaskArea | null;
  priority: boolean;
  notes: string;
  /** The email thread it came from, if any. */
  threadId: string | null;
  repeat: Repeat | null;
}

interface Row {
  id: string;
  title: string;
  due_day: string | null;
  done_at: number | null;
  area: string | null;
  priority: boolean;
  notes: string;
  thread_id: string | null;
  repeat: string | null;
  next_id: string | null;
}

const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  dueDay: r.due_day,
  done: r.done_at !== null,
  doneAt: r.done_at,
  area: isTaskArea(r.area) ? r.area : null,
  priority: r.priority,
  notes: r.notes,
  threadId: r.thread_id,
  repeat: isRepeat(r.repeat) ? r.repeat : null,
});

/** Open tasks, plus ones ticked off in the last `doneDays` days (the Done list). */
export async function listTasks(doneDays: number) {
  const doneSince = Date.now() - doneDays * 86_400_000;
  const rows = await sql<Row[]>`
    SELECT * FROM tasks WHERE deleted_at IS NULL AND (done_at IS NULL OR done_at >= ${doneSince})
    ORDER BY priority DESC, due_day IS NULL, due_day, created_at`;
  return rows.map(toTask);
}

/**
 * The Brief's few: overdue, today and the next `days` days, priority first. Ones ticked
 * today stay (struck through) so a tick doesn't make them vanish mid-glance.
 */
export async function briefTasks(today: string, todayStart: number, days = 3, limit = 6) {
  const rows = await sql<Row[]>`
    SELECT * FROM tasks
    WHERE deleted_at IS NULL AND due_day IS NOT NULL AND due_day <= ${addDays(today, days)}
      AND (done_at IS NULL OR done_at >= ${todayStart})
    ORDER BY done_at IS NOT NULL, priority DESC, due_day, created_at LIMIT ${limit}`;
  return rows.map(toTask);
}

/** Tasks with a due date, open or ticked in the last `doneDays` days: the calendar's week list. */
export async function datedTasks(doneDays: number) {
  const doneSince = Date.now() - doneDays * 86_400_000;
  const rows = await sql<Row[]>`
    SELECT * FROM tasks WHERE deleted_at IS NULL AND due_day IS NOT NULL AND (done_at IS NULL OR done_at >= ${doneSince})
    ORDER BY due_day, priority DESC, created_at`;
  return rows.map(toTask);
}

/** Open tasks due today or earlier (the 5pm nudge). */
export async function dueOpenTasks(today: string) {
  const rows = await sql<Row[]>`
    SELECT * FROM tasks WHERE deleted_at IS NULL AND done_at IS NULL AND due_day IS NOT NULL AND due_day <= ${today}
    ORDER BY priority DESC, due_day, created_at`;
  return rows.map(toTask);
}

/** Every task, done or not, whose title or notes mention `query`. */
export async function searchTasks(query: string, limit = 50) {
  const like = likePattern(query);
  const rows = await sql<Row[]>`
    SELECT * FROM tasks WHERE deleted_at IS NULL AND (title ILIKE ${like} OR notes ILIKE ${like})
    ORDER BY done_at IS NOT NULL, coalesce(done_at, created_at) DESC LIMIT ${limit}`;
  return rows.map(toTask);
}

/** Which threads already have a task, for the email view. */
export async function tasksForThreads(threadIds: string[]) {
  if (threadIds.length === 0) return [];
  const rows = await sql<Row[]>`
    SELECT * FROM tasks WHERE deleted_at IS NULL AND thread_id = ANY (${textList(threadIds)}) ORDER BY created_at DESC`;
  return rows.map(toTask);
}

export interface TaskInput {
  title: string;
  dueDay: string | null;
  area: TaskArea | null;
  priority: boolean;
  notes: string;
  repeat: Repeat | null;
  threadId: string | null;
  source: string;
}

export async function addTask(input: TaskInput) {
  const id = randomUUID();
  const [row] = await sql<Row[]>`
    INSERT INTO tasks (id, title, due_day, done_at, source, created_at, area, priority, notes, thread_id, repeat)
    VALUES (${id}, ${input.title}, ${input.dueDay}, NULL, ${input.source}, ${Date.now()}, ${input.area}, ${input.priority},
            ${input.notes}, ${input.threadId}, ${input.repeat})
    RETURNING *`;
  return toTask(row);
}

export type TaskChange = Partial<Pick<TaskInput, "title" | "dueDay" | "area" | "priority" | "notes" | "repeat">>;

const COLUMNS: Record<keyof TaskChange, string> = {
  title: "title",
  dueDay: "due_day",
  area: "area",
  priority: "priority",
  notes: "notes",
  repeat: "repeat",
};

export async function updateTask(id: string, change: TaskChange) {
  const set = Object.fromEntries(Object.entries(change).map(([k, v]) => [COLUMNS[k as keyof TaskChange], v]));
  if (Object.keys(set).length === 0) return null;
  const [row] = await sql<Row[]>`UPDATE tasks SET ${sql(set)} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`;
  return row ? toTask(row) : null;
}

/**
 * Ticks a task off or back on. Ticking off a repeating task makes the next one, due on
 * its schedule; unticking it takes that next one away again (if it hasn't been done).
 */
export async function setTaskDone(id: string, done: boolean): Promise<{ next: Task | null; removedId: string | null }> {
  if (done) {
    const [row] = await sql<Row[]>`UPDATE tasks SET done_at = ${Date.now()} WHERE id = ${id} AND done_at IS NULL RETURNING *`;
    if (!row || !isRepeat(row.repeat) || row.next_id) return { next: null, removedId: null };
    const next = await addTask({
      title: row.title,
      dueDay: nextDue(row.due_day, row.repeat, dayKey(new Date())),
      area: isTaskArea(row.area) ? row.area : null,
      priority: row.priority,
      notes: row.notes,
      repeat: row.repeat,
      threadId: null,
      source: "repeat",
    });
    await sql`UPDATE tasks SET next_id = ${next.id} WHERE id = ${id}`;
    return { next, removedId: null };
  }
  // One statement: the CTE reads next_id before the update clears it.
  const removed = await sql<{ id: string }[]>`
    WITH old AS (SELECT next_id FROM tasks WHERE id = ${id}),
         reopened AS (UPDATE tasks SET done_at = NULL, next_id = NULL WHERE id = ${id})
    DELETE FROM tasks WHERE id = (SELECT next_id FROM old) AND done_at IS NULL RETURNING id`;
  return { next: null, removedId: removed[0]?.id ?? null };
}

/** Deleted tasks stay hidden in the table so Undo can bring them back. */
export async function deleteTask(id: string) {
  await sql`UPDATE tasks SET deleted_at = ${Date.now()} WHERE id = ${id}`;
}

export async function restoreTask(id: string) {
  const [row] = await sql<Row[]>`UPDATE tasks SET deleted_at = NULL WHERE id = ${id} RETURNING *`;
  return row ? toTask(row) : null;
}
