import "server-only";
import { sql } from "@/lib/db";

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
export async function listEntries() {
  const rows = await sql<Row[]>`SELECT * FROM journal WHERE body <> '' OR mood IS NOT NULL ORDER BY day DESC`;
  return rows.map(toEntry);
}

export async function saveEntry(day: string, body: string, mood: number | null) {
  const empty = body.trim() === "" && mood === null;
  if (empty) await sql`DELETE FROM journal WHERE day = ${day}`;
  else
    await sql`
      INSERT INTO journal (day, body, mood, updated_at) VALUES (${day}, ${body}, ${mood}, ${Date.now()})
      ON CONFLICT (day) DO UPDATE SET body = EXCLUDED.body, mood = EXCLUDED.mood, updated_at = EXCLUDED.updated_at`;
}

/** Adds a line to a day's entry (used by voice capture). */
export async function appendToEntry(day: string, text: string) {
  const [row] = await sql<Row[]>`SELECT * FROM journal WHERE day = ${day}`;
  const body = row?.body.trim() ? `${row.body.trimEnd()}\n\n${text}` : text;
  await saveEntry(day, body, row?.mood ?? null);
}
