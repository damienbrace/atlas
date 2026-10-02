"use server";

import { describeAiError, interpretCapture } from "@/lib/ai/claude";
import { signedIn } from "@/lib/auth/session";
import { aiConfigured } from "@/lib/env";
import { isDayKey, longDay } from "@/lib/life/days";
import { listHabits, setDone } from "@/lib/life/habits";
import { appendToEntry } from "@/lib/life/journal";
import { createNote, NOTE_TAGS, type NoteTag } from "@/lib/life/notes";
import { addTask } from "@/lib/life/tasks";

// Voice capture: Atlas turns what you said into suggested items; nothing is saved
// until you approve each one. Server Functions are public endpoints: validate every input.

export type CaptureKind = "task" | "note" | "journal" | "habit";

export interface CaptureSuggestion {
  kind: CaptureKind;
  title: string;
  body: string;
  dueDay: string | null;
  habitId: string | null;
  tag: NoteTag | null;
}

const cleanTag = (tag: unknown): NoteTag | null => ((NOTE_TAGS as readonly unknown[]).includes(tag) ? (tag as NoteTag) : null);

export async function understandCapture(
  transcript: string,
  today: string,
): Promise<{ ok: true; items: CaptureSuggestion[] } | { ok: false; error: string }> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 5000) return { ok: false, error: "Nothing to work with yet." };
  if (!isDayKey(today)) return { ok: false, error: "Bad request" };
  if (!aiConfigured()) return { ok: false, error: "Add an Anthropic API key to .env.local to use voice capture." };

  const habits = await listHabits();
  try {
    const items = await interpretCapture(transcript.trim(), { key: today, label: longDay(today) }, habits, NOTE_TAGS);
    return {
      ok: true,
      items: items
        .map((i): CaptureSuggestion => {
          const habit = i.kind === "habit" ? habits.find((h) => h.id === i.habit_id) : undefined;
          return {
            kind: i.kind,
            title: habit?.name ?? i.title.trim(),
            body: i.body.trim(),
            dueDay: isDayKey(i.due_day) ? i.due_day : null,
            habitId: habit?.id ?? null,
            tag: cleanTag(i.tag),
          };
        })
        // Drop habit ticks that don't match a real habit, and empty items.
        .filter((i) => (i.kind === "habit" ? i.habitId !== null : Boolean(i.title || i.body))),
    };
  } catch (error) {
    console.error("[atlas] capture failed", error);
    return { ok: false, error: describeAiError(error) };
  }
}

/** Saves one approved item where it belongs. */
export async function saveCaptureItem(item: CaptureSuggestion, today: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isDayKey(today) || !item || typeof item !== "object") return { ok: false as const };
  const title = typeof item.title === "string" ? item.title.trim().slice(0, 300) : "";
  const body = typeof item.body === "string" ? item.body.trim().slice(0, 20_000) : "";

  switch (item.kind) {
    case "task":
      if (!title) return { ok: false as const };
      await addTask(title, isDayKey(item.dueDay) ? item.dueDay : null, "voice");
      return { ok: true as const };
    case "note":
      if (!title && !body) return { ok: false as const };
      await createNote(title, body, cleanTag(item.tag));
      return { ok: true as const };
    case "journal":
      if (!body && !title) return { ok: false as const };
      await appendToEntry(today, body || title);
      return { ok: true as const };
    case "habit": {
      const habit = (await listHabits()).find((h) => h.id === item.habitId);
      if (!habit) return { ok: false as const };
      await setDone(habit.id, today, true);
      return { ok: true as const };
    }
    default:
      return { ok: false as const };
  }
}
