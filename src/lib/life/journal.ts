import "server-only";
import { lifeDb } from "./db";

export interface JournalEntry {
  day: string;
  body: string;
  mood: number | null;
  updatedAt: number;
}

interface Row {
  day: string;
  body: string;
  mood: number | null;
  updated_at: number;
}

const toEntry = (r: Row): JournalEntry => ({ day: r.day, body: r.body, mood: r.mood, updatedAt: r.updated_at });

/** Every entry, newest first. A daily journal stays small enough to send whole. */
export function listEntries() {
  return (lifeDb().prepare("SELECT * FROM journal WHERE body != '' OR mood IS NOT NULL ORDER BY day DESC").all() as unknown as Row[]).map(
    toEntry,
  );
}

export function saveEntry(day: string, body: string, mood: number | null) {
  const empty = body.trim() === "" && mood === null;
  if (empty) lifeDb().prepare("DELETE FROM journal WHERE day = ?").run(day);
  else
    lifeDb()
      .prepare("INSERT OR REPLACE INTO journal (day, body, mood, updated_at) VALUES (?, ?, ?, ?)")
      .run(day, body, mood, Date.now());
}

/** Adds a line to a day's entry (used by voice capture). */
export function appendToEntry(day: string, text: string) {
  const row = lifeDb().prepare("SELECT * FROM journal WHERE day = ?").get(day) as Row | undefined;
  const body = row?.body.trim() ? `${row.body.trimEnd()}\n\n${text}` : text;
  saveEntry(day, body, row?.mood ?? null);
}
