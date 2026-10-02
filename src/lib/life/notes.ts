import "server-only";
import { randomUUID } from "node:crypto";
import { sql, textList } from "@/lib/db";
import { likePattern } from "@/lib/search-words";

export const NOTE_TAGS = ["Bricklaying", "Henty Lodge", "Trading", "Home", "Ideas"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export interface Note {
  id: string;
  title: string;
  body: string;
  tag: NoteTag | null;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  title: string;
  body: string;
  tag: string | null;
  created_at: number;
  updated_at: number;
}

const toNote = (r: Row): Note => ({
  id: r.id,
  title: r.title,
  body: r.body,
  tag: (NOTE_TAGS as readonly string[]).includes(r.tag ?? "") ? (r.tag as NoteTag) : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listNotes() {
  return (await sql<Row[]>`SELECT * FROM notes ORDER BY updated_at DESC`).map(toNote);
}

export async function createNote(title: string, body: string, tag: NoteTag | null) {
  const id = randomUUID();
  const now = Date.now();
  await sql`
    INSERT INTO notes (id, title, body, tag, created_at, updated_at)
    VALUES (${id}, ${title}, ${body}, ${tag}, ${now}, ${now})`;
  return { id, createdAt: now };
}

export async function updateNote(id: string, title: string, body: string, tag: NoteTag | null) {
  await sql`UPDATE notes SET title = ${title}, body = ${body}, tag = ${tag}, updated_at = ${Date.now()} WHERE id = ${id}`;
}

export async function deleteNote(id: string) {
  await sql`DELETE FROM notes WHERE id = ${id}`;
}

/** Notes matching any of the words, for Ask Atlas. */
export async function notesMatching(words: string[], limit: number) {
  if (words.length === 0) return [];
  const likes = textList(words.map(likePattern));
  const rows = await sql<Row[]>`
    SELECT * FROM notes WHERE title ILIKE ANY (${likes}) OR body ILIKE ANY (${likes})
    ORDER BY updated_at DESC LIMIT ${limit}`;
  return rows.map(toNote);
}
