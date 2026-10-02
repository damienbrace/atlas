import "server-only";
import { randomUUID } from "node:crypto";
import { lifeDb } from "./db";

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

export function listNotes() {
  return (lifeDb().prepare("SELECT * FROM notes ORDER BY updated_at DESC").all() as unknown as Row[]).map(toNote);
}

export function createNote(title: string, body: string, tag: NoteTag | null) {
  const id = randomUUID();
  const now = Date.now();
  lifeDb()
    .prepare("INSERT INTO notes (id, title, body, tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, title, body, tag, now, now);
  return { id, createdAt: now };
}

export function updateNote(id: string, title: string, body: string, tag: NoteTag | null) {
  lifeDb().prepare("UPDATE notes SET title = ?, body = ?, tag = ?, updated_at = ? WHERE id = ?").run(title, body, tag, Date.now(), id);
}

export function deleteNote(id: string) {
  lifeDb().prepare("DELETE FROM notes WHERE id = ?").run(id);
}

/** Notes matching any of the words, for Ask Atlas. */
export function notesMatching(words: string[], limit: number) {
  if (words.length === 0) return [];
  const clauses = words.map(() => "(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')").join(" OR ");
  const params = words.flatMap((w) => {
    const like = `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return [like, like];
  });
  return (lifeDb().prepare(`SELECT * FROM notes WHERE ${clauses} ORDER BY updated_at DESC LIMIT ?`).all(...params, limit) as unknown as Row[]).map(
    toNote,
  );
}
