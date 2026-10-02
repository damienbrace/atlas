"use server";

import { signedIn } from "@/lib/auth/session";
import type { Label } from "@/lib/inbox/types";
import { isDayKey } from "@/lib/life/days";
import { isRepeat, isTaskArea, type TaskArea } from "@/lib/life/task-rules";
import { getSuggestion, resolveSuggestion, resolveThread, suggestionsForThreads } from "@/lib/life/task-suggestions";
import { addTask, deleteTask, restoreTask, searchTasks, setTaskDone, updateTask, type Task, type TaskChange } from "@/lib/life/tasks";
import { getThread } from "@/lib/mail/db";
import { triageKey } from "@/lib/mail/sync";
import { annotationsFor } from "@/lib/store";

// Server Functions are public endpoints: check the session and validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
const isThreadId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{6,32}$/i.test(id);
const isSuggestionKey = (key: unknown): key is string => typeof key === "string" && /^[0-9a-f]{6,32}:[0-9a-f]{6,32}$/i.test(key);

const MAX_TITLE = 200;
const MAX_NOTES = 10_000;

/** Validates whichever fields are present; null if any is bad. */
function cleanChange(input: unknown): TaskChange | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const change: TaskChange = {};
  if ("title" in raw) {
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > MAX_TITLE) return null;
    change.title = raw.title.trim();
  }
  if ("dueDay" in raw) {
    if (raw.dueDay !== null && !isDayKey(raw.dueDay)) return null;
    change.dueDay = raw.dueDay as string | null;
  }
  if ("area" in raw) {
    if (raw.area !== null && !isTaskArea(raw.area)) return null;
    change.area = raw.area as TaskArea | null;
  }
  if ("priority" in raw) {
    if (typeof raw.priority !== "boolean") return null;
    change.priority = raw.priority;
  }
  if ("notes" in raw) {
    if (typeof raw.notes !== "string" || raw.notes.length > MAX_NOTES) return null;
    change.notes = raw.notes;
  }
  if ("repeat" in raw) {
    if (raw.repeat !== null && !isRepeat(raw.repeat)) return null;
    change.repeat = raw.repeat as TaskChange["repeat"];
  }
  return change;
}

export async function createTask(input: TaskChange & { title: string }) {
  if (!(await signedIn())) return { ok: false as const };
  const change = cleanChange(input);
  if (!change?.title) return { ok: false as const };
  const task = await addTask({
    title: change.title,
    dueDay: change.dueDay ?? null,
    area: change.area ?? null,
    priority: change.priority ?? false,
    notes: change.notes ?? "",
    repeat: change.repeat ?? null,
    threadId: null,
    source: "manual",
  });
  return { ok: true as const, task };
}

export async function editTask(id: string, input: TaskChange) {
  if (!(await signedIn())) return { ok: false as const };
  const change = cleanChange(input);
  if (!isId(id) || !change) return { ok: false as const };
  const task = await updateTask(id, change);
  return task ? { ok: true as const, task } : { ok: false as const };
}

/** Ticks a task off (or back on). Repeating tasks hand back the next one, or the one taken away. */
export async function markTask(id: string, done: boolean) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id) || typeof done !== "boolean") return { ok: false as const };
  return { ok: true as const, ...(await setTaskDone(id, done)) };
}

export async function removeTask(id: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id)) return { ok: false as const };
  await deleteTask(id);
  return { ok: true as const };
}

export async function undoRemoveTask(id: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id)) return { ok: false as const };
  const task = await restoreTask(id);
  return task ? { ok: true as const, task } : { ok: false as const };
}

/** Searches every task, the whole Done history included. */
export async function findTasks(query: string): Promise<{ ok: true; tasks: Task[] } | { ok: false }> {
  if (!(await signedIn())) return { ok: false };
  if (typeof query !== "string" || !query.trim() || query.length > 100) return { ok: false };
  return { ok: true, tasks: await searchTasks(query.trim()) };
}

/** Approves one of Atlas's suggestions as a task, with any edits made first. */
export async function approveSuggestion(key: string, input: TaskChange = {}) {
  if (!(await signedIn())) return { ok: false as const };
  const change = cleanChange(input);
  if (!isSuggestionKey(key) || !change) return { ok: false as const };
  const suggestion = await getSuggestion(key);
  if (!suggestion) return { ok: false as const };
  const task = await addTask({
    title: change.title ?? suggestion.title,
    dueDay: change.dueDay !== undefined ? change.dueDay : suggestion.dueDay,
    area: change.area !== undefined ? change.area : suggestion.area,
    priority: change.priority ?? false,
    notes: change.notes ?? "",
    repeat: change.repeat ?? null,
    threadId: suggestion.threadId,
    source: "email",
  });
  await resolveSuggestion(key, "approved", task.id);
  return { ok: true as const, task };
}

export async function dismissSuggestion(key: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isSuggestionKey(key)) return { ok: false as const };
  await resolveSuggestion(key, "dismissed");
  return { ok: true as const };
}

const AREA_FOR_LABEL: Partial<Record<Label, TaskArea>> = {
  Bricklaying: "Bricklaying",
  "Henty Lodge": "Henty Lodge",
  Trading: "Trading",
  Personal: "Home",
};

/** "Make a task" on an email: Atlas's suggestion if it has one, else the email's headline. */
export async function makeTaskFromEmail(threadId: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isThreadId(threadId)) return { ok: false as const };
  const thread = await getThread(threadId);
  if (!thread) return { ok: false as const };
  const [suggestion] = await suggestionsForThreads([threadId]);
  const triage = suggestion ? undefined : (await annotationsFor([triageKey(thread)], [])).triage[triageKey(thread)];
  const area = suggestion?.area ?? triage?.labels.map((l) => AREA_FOR_LABEL[l]).find(Boolean) ?? null;
  const task = await addTask({
    title: (suggestion?.title ?? triage?.headline ?? thread.subject).slice(0, MAX_TITLE) || "Follow up this email",
    dueDay: suggestion?.dueDay ?? null,
    area,
    priority: false,
    notes: "",
    repeat: null,
    threadId,
    source: "email",
  });
  await resolveThread(threadId, task.id);
  return { ok: true as const, task };
}
