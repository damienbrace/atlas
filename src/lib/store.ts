import "server-only";
import { sql, textList } from "@/lib/db";
import type { Category, Label, Tone } from "@/lib/inbox/types";

// What Atlas has written about mail: its read of each thread, the drafts it has
// written, and the sorting corrections I make. Stored in Supabase beside the mail.

export interface Triage {
  category: Exclude<Category, "waiting">;
  headline: string;
  summary: string;
  needsReply: boolean;
  /** For threads where my message is last: am I waiting on an answer? */
  awaitingReply: boolean;
  labels: Label[];
}

export interface StoredDraft {
  rationale: string;
  variants: Partial<Record<Tone, string>>;
}

export interface Override {
  category?: Category;
  labels?: Label[];
}

export interface Annotations {
  /** Keyed by `${threadId}:${lastMessageId}` so a new message re-triages the thread. */
  triage: Record<string, Triage>;
  drafts: Record<string, StoredDraft>;
  /** Keyed by thread id; survives new messages. */
  overrides: Record<string, Override>;
}

/** Everything Atlas has noted for these threads: `keys` are triage keys, `threadIds` the threads. */
export async function annotationsFor(keys: string[], threadIds: string[]): Promise<Annotations> {
  const [triage, drafts, overrides] = await Promise.all([
    keys.length ? sql<{ key: string; data: Triage }[]>`SELECT key, data FROM triage WHERE key = ANY (${textList(keys)})` : [],
    keys.length ? sql<{ key: string; data: StoredDraft }[]>`SELECT key, data FROM drafts WHERE key = ANY (${textList(keys)})` : [],
    threadIds.length
      ? sql<{ thread_id: string; data: Override }[]>`SELECT thread_id, data FROM overrides WHERE thread_id = ANY (${textList(threadIds)})`
      : [],
  ]);
  return {
    triage: Object.fromEntries(triage.map((r) => [r.key, r.data])),
    drafts: Object.fromEntries(drafts.map((r) => [r.key, r.data])),
    overrides: Object.fromEntries(overrides.map((r) => [r.thread_id, r.data])),
  };
}

/** One statement for the whole round (no sql.begin: see db.ts on max_pipeline). */
export async function saveTriage(entries: { key: string; threadId: string; triage: Triage }[]) {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({ key: e.key, thread_id: e.threadId, data: e.triage }));
  await sql`
    INSERT INTO triage (key, thread_id, data)
    SELECT key, thread_id, data FROM jsonb_to_recordset(${sql.json(rows as never)}) AS t (key text, thread_id text, data jsonb)
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`;
}

export async function getDraft(key: string) {
  const [row] = await sql<{ data: StoredDraft }[]>`SELECT data FROM drafts WHERE key = ${key}`;
  return row?.data ?? null;
}

export async function saveDraft(key: string, draft: StoredDraft) {
  await sql`
    INSERT INTO drafts (key, data) VALUES (${key}, ${sql.json(draft as never)})
    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`;
}

/** Merges a correction into the thread's existing one. */
export async function saveOverride(threadId: string, change: Override) {
  await sql`
    INSERT INTO overrides (thread_id, data) VALUES (${threadId}, ${sql.json(change as never)})
    ON CONFLICT (thread_id) DO UPDATE SET data = overrides.data || EXCLUDED.data`;
}
