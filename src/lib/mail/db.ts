import "server-only";
import { sql, textList } from "@/lib/db";
import { labelFlags, type ParsedMessage, type ParsedThread } from "@/lib/gmail/parse";
import { likePattern } from "@/lib/search-words";

// Atlas's copy of the last year of mail, so it reads Gmail once and then only
// asks for changes. Lives in Supabase with everything else.

// ---- Sync bookkeeping -------------------------------------------------------

export async function getState(key: string) {
  const [row] = await sql<{ value: string }[]>`SELECT value FROM sync_state WHERE key = ${key}`;
  return row?.value ?? null;
}

export async function setState(key: string, value: string | number | null) {
  if (value === null) await sql`DELETE FROM sync_state WHERE key = ${key}`;
  else
    await sql`
      INSERT INTO sync_state (key, value) VALUES (${key}, ${String(value)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/** Takes the sync lock unless another run holds a fresh one. Survives crashes by expiring. */
export async function tryLock(owner: string, ttlMs: number) {
  const now = Date.now();
  const rows = await sql`
    INSERT INTO sync_state (key, value) VALUES ('lock', ${`${owner}|${now + ttlMs}`})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    WHERE split_part(sync_state.value, '|', 2)::bigint <= ${now} OR sync_state.value LIKE ${`${owner}|%`}
    RETURNING key`;
  return rows.length > 0;
}

export async function releaseLock(owner: string) {
  await sql`DELETE FROM sync_state WHERE key = 'lock' AND value LIKE ${`${owner}|%`}`;
}

export async function isLocked() {
  const until = Number((await getState("lock"))?.split("|")[1] ?? 0);
  return until > Date.now();
}

// ---- Messages ---------------------------------------------------------------

interface MessageRow {
  id: string;
  thread_id: string;
  internal_date: number;
  from_name: string;
  from_email: string;
  to_json: ParsedMessage["to"];
  subject: string;
  snippet: string;
  body: string;
  labels: string[];
  designed: boolean;
}

function toParsed(row: MessageRow): ParsedMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    labels: row.labels,
    snippet: row.snippet,
    from: { name: row.from_name, email: row.from_email },
    to: row.to_json,
    subject: row.subject,
    date: new Date(row.internal_date).toISOString(),
    body: row.body,
    designed: row.designed,
    ...labelFlags(row.labels),
  };
}

export async function saveMessage(m: ParsedMessage) {
  await sql`
    INSERT INTO messages (id, thread_id, internal_date, from_name, from_email, to_json, subject, snippet, body, labels, designed)
    VALUES (${m.id}, ${m.threadId}, ${Date.parse(m.date)}, ${m.from.name}, ${m.from.email}, ${sql.json(m.to as never)},
            ${m.subject}, ${m.snippet}, ${m.body}, ${textList(m.labels)}, ${m.designed})
    ON CONFLICT (id) DO UPDATE SET
      thread_id = EXCLUDED.thread_id, internal_date = EXCLUDED.internal_date, from_name = EXCLUDED.from_name,
      from_email = EXCLUDED.from_email, to_json = EXCLUDED.to_json, subject = EXCLUDED.subject, snippet = EXCLUDED.snippet,
      body = EXCLUDED.body, labels = EXCLUDED.labels, designed = EXCLUDED.designed`;
}

export async function setLabels(id: string, labels: string[]) {
  await sql`UPDATE messages SET labels = ${textList(labels)} WHERE id = ${id}`;
}

export async function deleteMessage(id: string) {
  await sql`DELETE FROM messages WHERE id = ${id}`;
}

/** The ids we don't have yet, out of `ids`. */
export async function missingIds(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await sql<{ id: string }[]>`SELECT id FROM messages WHERE id = ANY (${textList(ids)})`;
  const have = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !have.has(id));
}

export async function messageCount() {
  const [row] = await sql<{ n: number }[]>`SELECT COUNT(*) AS n FROM messages`;
  return row.n;
}

export async function messageBody(id: string) {
  const [row] = await sql<{ body: string }[]>`SELECT body FROM messages WHERE id = ${id}`;
  return row?.body ?? null;
}

/** Forgets the mail and everything Atlas wrote about it (on disconnect or account change). */
export async function clearMail() {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM messages`;
    await tx`DELETE FROM sync_state`;
    await tx`DELETE FROM triage`;
    await tx`DELETE FROM drafts`;
    await tx`DELETE FROM overrides`;
  });
}

// ---- Threads ----------------------------------------------------------------

/** The threads' messages, oldest first. `bodyChars` trims each body, for lists that don't need it all. */
async function threadsFor(threadIds: string[], bodyChars?: number): Promise<ParsedThread[]> {
  if (threadIds.length === 0) return [];
  const body = bodyChars ? sql`left(body, ${bodyChars}) AS body` : sql`body`;
  const rows = await sql<MessageRow[]>`
    SELECT id, thread_id, internal_date, from_name, from_email, to_json, subject, snippet, ${body}, labels, designed
    FROM messages WHERE thread_id = ANY (${textList(threadIds)}) ORDER BY internal_date`;
  const byThread = new Map<string, ParsedMessage[]>();
  for (const row of rows) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push(toParsed(row));
    byThread.set(row.thread_id, list);
  }
  return threadIds
    .map((id) => byThread.get(id))
    .filter((messages): messages is ParsedMessage[] => Boolean(messages?.length))
    .map((messages) => ({ id: messages[0].threadId, subject: messages[0].subject, messages }));
}

/**
 * Threads that belong in the inbox view (anything in the inbox, plus things I sent),
 * newest activity first. `before` pages backwards; `since` stops at a cut-off.
 */
export async function listThreads({
  before = Number.MAX_SAFE_INTEGER,
  since = 0,
  limit,
  bodyChars,
}: {
  before?: number;
  since?: number;
  limit: number;
  bodyChars?: number;
}) {
  const rows = await sql<{ thread_id: string }[]>`
    SELECT thread_id FROM messages GROUP BY thread_id
    HAVING bool_or('INBOX' = ANY (labels) OR 'SENT' = ANY (labels))
       AND MAX(internal_date) < ${before} AND MAX(internal_date) >= ${since}
    ORDER BY MAX(internal_date) DESC LIMIT ${limit}`;
  return threadsFor(rows.map((r) => r.thread_id), bodyChars);
}

/** Whether any inbox-view thread is older than `before`. */
export async function hasThreadsBefore(before: number) {
  const rows = await sql`
    SELECT 1 FROM messages GROUP BY thread_id
    HAVING bool_or('INBOX' = ANY (labels) OR 'SENT' = ANY (labels)) AND MAX(internal_date) < ${before}
    LIMIT 1`;
  return rows.length > 0;
}

/** Plain-text search across every stored thread, archived ones included. */
export async function searchThreads(query: string, limit: number, bodyChars?: number) {
  const like = likePattern(query);
  const rows = await sql<{ thread_id: string }[]>`
    SELECT thread_id FROM messages
    WHERE subject ILIKE ${like} OR from_name ILIKE ${like} OR from_email ILIKE ${like}
       OR to_json::text ILIKE ${like} OR body ILIKE ${like}
    GROUP BY thread_id ORDER BY MAX(internal_date) DESC LIMIT ${limit}`;
  return threadsFor(rows.map((r) => r.thread_id), bodyChars);
}

export async function getThread(threadId: string) {
  return (await threadsFor([threadId]))[0] ?? null;
}

/**
 * Messages that mention the most of `words`, for Ask Atlas. Subject and sender
 * hits count double; ties go to the newer message.
 */
export async function messagesMatching(words: string[], limit: number) {
  if (words.length === 0) return [];
  const likes = textList(words.map(likePattern));
  const rows = await sql<MessageRow[]>`
    SELECT * FROM messages
    WHERE subject ILIKE ANY (${likes}) OR from_name ILIKE ANY (${likes}) OR body ILIKE ANY (${likes})
    ORDER BY internal_date DESC LIMIT 400`;

  const score = (row: MessageRow) => {
    const head = `${row.subject} ${row.from_name}`.toLowerCase();
    const body = row.body.toLowerCase();
    return words.reduce((sum, w) => sum + (head.includes(w) ? 2 : 0) + (body.includes(w) ? 1 : 0), 0);
  };
  return rows
    .map((row) => ({ row, score: score(row) }))
    .sort((a, b) => b.score - a.score || b.row.internal_date - a.row.internal_date)
    .slice(0, limit)
    .map(({ row }) => toParsed(row));
}
