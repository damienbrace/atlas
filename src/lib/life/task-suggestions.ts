import "server-only";
import { sql, textList } from "@/lib/db";
import { isTaskArea, type TaskArea } from "./task-rules";

// Tasks Atlas spotted while sorting email. Each waits for Approve / Edit / Dismiss;
// they're keyed like triage (thread + latest message), so a dismissed one never returns.

export interface TaskSuggestion {
  key: string;
  threadId: string;
  title: string;
  dueDay: string | null;
  area: TaskArea | null;
  emailFrom: string;
  emailHeadline: string;
}

interface Row {
  key: string;
  thread_id: string;
  title: string;
  due_day: string | null;
  area: string | null;
  email_from: string;
  email_headline: string;
}

const toSuggestion = (r: Row): TaskSuggestion => ({
  key: r.key,
  threadId: r.thread_id,
  title: r.title,
  dueDay: r.due_day,
  area: isTaskArea(r.area) ? r.area : null,
  emailFrom: r.email_from,
  emailHeadline: r.email_headline,
});

/** Adds new suggestions in one statement; ones already seen (pending, approved or dismissed) are left alone. */
export async function saveSuggestions(list: TaskSuggestion[]) {
  if (list.length === 0) return;
  const rows = list.map((s) => ({
    key: s.key,
    thread_id: s.threadId,
    title: s.title,
    due_day: s.dueDay,
    area: s.area,
    email_from: s.emailFrom,
    email_headline: s.emailHeadline,
    created_at: Date.now(),
  }));
  await sql`
    INSERT INTO task_suggestions (key, thread_id, title, due_day, area, email_from, email_headline, created_at)
    SELECT key, thread_id, title, due_day, area, email_from, email_headline, created_at
    FROM jsonb_to_recordset(${sql.json(rows as never)})
      AS t (key text, thread_id text, title text, due_day text, area text, email_from text, email_headline text, created_at bigint)
    ON CONFLICT (key) DO NOTHING`;
}

export async function pendingSuggestions(limit = 30) {
  const rows = await sql<Row[]>`SELECT * FROM task_suggestions WHERE status = 'pending' ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map(toSuggestion);
}

/** The newest pending suggestion for each thread, for the email view. */
export async function suggestionsForThreads(threadIds: string[]) {
  if (threadIds.length === 0) return [];
  const rows = await sql<Row[]>`
    SELECT DISTINCT ON (thread_id) * FROM task_suggestions
    WHERE status = 'pending' AND thread_id = ANY (${textList(threadIds)})
    ORDER BY thread_id, created_at DESC`;
  return rows.map(toSuggestion);
}

export async function getSuggestion(key: string) {
  const [row] = await sql<Row[]>`SELECT * FROM task_suggestions WHERE key = ${key} AND status = 'pending'`;
  return row ? toSuggestion(row) : null;
}

/** Marks a suggestion approved (with the task it became) or dismissed. */
export async function resolveSuggestion(key: string, status: "approved" | "dismissed", taskId: string | null = null) {
  await sql`UPDATE task_suggestions SET status = ${status}, task_id = ${taskId} WHERE key = ${key}`;
}

/** Any pending suggestions on a thread are settled once a task is made from it directly. */
export async function resolveThread(threadId: string, taskId: string) {
  await sql`UPDATE task_suggestions SET status = 'approved', task_id = ${taskId} WHERE thread_id = ${threadId} AND status = 'pending'`;
}
