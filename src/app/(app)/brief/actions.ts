"use server";

import { signedIn } from "@/lib/auth/session";
import { isBriefSection } from "@/lib/brief-sections";
import { isDayKey } from "@/lib/life/days";
import { setSetting } from "@/lib/life/settings";
import { addTask, setTaskDone } from "@/lib/life/tasks";

// Server Functions are public endpoints: validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);

export async function createTask(title: string, dueDay: string | null) {
  if (!(await signedIn())) return { ok: false as const };
  if (typeof title !== "string" || !title.trim() || title.length > 200) return { ok: false as const };
  if (dueDay !== null && !isDayKey(dueDay)) return { ok: false as const };
  return { ok: true as const, id: await addTask(title.trim(), dueDay, "manual") };
}

export async function markTask(id: string, done: boolean) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id) || typeof done !== "boolean") return { ok: false as const };
  await setTaskDone(id, done);
  return { ok: true as const };
}

/** Which parts of the Brief are hidden. */
export async function saveBriefHidden(hidden: string[]) {
  if (!(await signedIn())) return { ok: false as const };
  if (!Array.isArray(hidden) || !hidden.every(isBriefSection)) return { ok: false as const };
  await setSetting("brief.hidden", [...new Set(hidden)]);
  return { ok: true as const };
}
