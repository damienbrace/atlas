"use server";

import { answerQuestion, describeAiError, type AskSource } from "@/lib/ai/claude";
import { signedIn } from "@/lib/auth/session";
import { aiConfigured } from "@/lib/env";
import { longDay, dayKey } from "@/lib/life/days";
import { createNote, deleteNote, NOTE_TAGS, notesMatching, updateNote, type NoteTag } from "@/lib/life/notes";
import { messagesMatching } from "@/lib/mail/db";
import { searchWords } from "@/lib/search-words";

// Server Functions are public endpoints: validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
const cleanTag = (tag: unknown): NoteTag | null => ((NOTE_TAGS as readonly unknown[]).includes(tag) ? (tag as NoteTag) : null);
const MAX_CHARS = 100_000;

export async function saveNote(input: { id?: string; title: string; body: string; tag: string | null }) {
  if (!(await signedIn())) return { ok: false as const };
  const { id, title, body } = input;
  if (typeof title !== "string" || typeof body !== "string" || title.length > 300 || body.length > MAX_CHARS) return { ok: false as const };
  if (id !== undefined && !isId(id)) return { ok: false as const };
  const tag = cleanTag(input.tag);
  if (id) {
    await updateNote(id, title, body, tag);
    return { ok: true as const, id };
  }
  return { ok: true as const, ...(await createNote(title, body, tag)) };
}

export async function removeNote(id: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id)) return { ok: false as const };
  await deleteNote(id);
  return { ok: true as const };
}

export type AskRef =
  | { kind: "email"; ref: string; title: string; date: string; from: string; threadId: string }
  | { kind: "note"; ref: string; title: string; date: string; noteId: string };

export type AskResult =
  | { ok: true; answer: string; found: boolean; sources: AskRef[] }
  | { ok: false; error: string };

/** Answers a plain-English question from your notes and (if Gmail's connected) your stored email. */
export async function askAtlas(question: string): Promise<AskResult> {
  if (!(await signedIn())) return { ok: false, error: "Sign in again." };
  if (typeof question !== "string" || !question.trim() || question.length > 500) return { ok: false, error: "Ask a question first." };
  const words = searchWords(question);
  if (words.length === 0) return { ok: false, error: "Add a few more specific words to the question." };

  const [emails, notes] = await Promise.all([messagesMatching(words, 10), notesMatching(words, 6)]);
  if (emails.length === 0 && notes.length === 0) {
    return { ok: true, found: false, sources: [], answer: "Nothing in your notes or the last year of email mentions that." };
  }
  if (!aiConfigured()) return { ok: false, error: "Add an Anthropic API key to .env.local to ask Atlas questions." };

  const refs = new Map<string, AskRef>();
  const sources: AskSource[] = [];
  emails.forEach((m, i) => {
    const ref = `e${i + 1}`;
    refs.set(ref, { kind: "email", ref, title: m.subject, date: m.date, from: m.sentByMe ? "You" : m.from.name, threadId: m.threadId });
    sources.push({ ref, kind: "email", date: m.date.slice(0, 10), title: m.subject, from: `${m.from.name} <${m.from.email}>`, text: m.body });
  });
  notes.forEach((n, i) => {
    const ref = `n${i + 1}`;
    const date = new Date(n.updatedAt).toISOString();
    refs.set(ref, { kind: "note", ref, title: n.title || "Untitled note", date, noteId: n.id });
    sources.push({ ref, kind: "note", date: date.slice(0, 10), title: n.title || "Untitled note", text: n.body });
  });

  try {
    const result = await answerQuestion(question.trim(), sources, longDay(dayKey(new Date())));
    return {
      ok: true,
      answer: result.answer,
      found: result.found,
      sources: result.sources.map((r) => refs.get(r)).filter((r): r is AskRef => Boolean(r)),
    };
  } catch (error) {
    console.error("[atlas] ask failed", error);
    return { ok: false, error: describeAiError(error) };
  }
}
