import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { labelFlags, type ParsedMessage, type ParsedThread } from "@/lib/gmail/parse";

// Local copy of the last few months of mail, so Atlas reads Gmail once and then
// only asks for changes. SQLite in .data/ (git- and Dropbox-ignored). This is
// the piece that moves to Supabase when sync goes server-side.

const FILE = path.join(process.cwd(), ".data", "mail.db");

let connection: DatabaseSync | null = null;

export function db() {
  if (connection) return connection;
  mkdirSync(path.dirname(FILE), { recursive: true });
  const conn = new DatabaseSync(FILE);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      internal_date INTEGER NOT NULL,
      from_name TEXT NOT NULL,
      from_email TEXT NOT NULL,
      to_json TEXT NOT NULL,
      subject TEXT NOT NULL,
      snippet TEXT NOT NULL,
      body TEXT NOT NULL,
      labels TEXT NOT NULL,
      designed INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_id);
    CREATE INDEX IF NOT EXISTS messages_date ON messages (internal_date);
    CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  connection = conn;
  return conn;
}

// ---- Sync bookkeeping -------------------------------------------------------

export function getState(key: string) {
  const row = db().prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(key: string, value: string | number | null) {
  if (value === null) db().prepare("DELETE FROM sync_state WHERE key = ?").run(key);
  else db().prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)").run(key, String(value));
}

/** Takes the sync lock unless another run holds a fresh one. Survives restarts by expiring. */
export function tryLock(owner: string, ttlMs: number) {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const held = getState("lock");
    const [, until] = held?.split("|") ?? [];
    if (held && Number(until) > Date.now() && !held.startsWith(`${owner}|`)) {
      conn.exec("COMMIT");
      return false;
    }
    setState("lock", `${owner}|${Date.now() + ttlMs}`);
    conn.exec("COMMIT");
    return true;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
}

export function releaseLock(owner: string) {
  if (getState("lock")?.startsWith(`${owner}|`)) setState("lock", null);
}

export function isLocked() {
  const until = Number(getState("lock")?.split("|")[1] ?? 0);
  return until > Date.now();
}

// ---- Messages ---------------------------------------------------------------

interface MessageRow {
  id: string;
  thread_id: string;
  internal_date: number;
  from_name: string;
  from_email: string;
  to_json: string;
  subject: string;
  snippet: string;
  body: string;
  labels: string;
  designed: number;
}

function toParsed(row: MessageRow): ParsedMessage {
  const labels = row.labels ? row.labels.split(" ") : [];
  return {
    id: row.id,
    threadId: row.thread_id,
    labels,
    snippet: row.snippet,
    from: { name: row.from_name, email: row.from_email },
    to: JSON.parse(row.to_json),
    subject: row.subject,
    date: new Date(row.internal_date).toISOString(),
    body: row.body,
    designed: row.designed === 1,
    ...labelFlags(labels),
  };
}

export function saveMessage(m: ParsedMessage) {
  db()
    .prepare(
      `INSERT OR REPLACE INTO messages (id, thread_id, internal_date, from_name, from_email, to_json, subject, snippet, body, labels, designed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.id, m.threadId, Date.parse(m.date), m.from.name, m.from.email, JSON.stringify(m.to), m.subject, m.snippet, m.body, m.labels.join(" "), m.designed ? 1 : 0);
}

export function setLabels(id: string, labels: string[]) {
  db().prepare("UPDATE messages SET labels = ? WHERE id = ?").run(labels.join(" "), id);
}

export function deleteMessage(id: string) {
  db().prepare("DELETE FROM messages WHERE id = ?").run(id);
}

/** The ids we don't have yet, out of `ids`. */
export function missingIds(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = db()
    .prepare("SELECT id FROM messages WHERE id IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify(ids)) as { id: string }[];
  const have = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !have.has(id));
}

export function messageCount() {
  return (db().prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
}

export function messageBody(id: string) {
  const row = db().prepare("SELECT body FROM messages WHERE id = ?").get(id) as { body: string } | undefined;
  return row?.body ?? null;
}

export function clearMail() {
  db().exec("DELETE FROM messages; DELETE FROM sync_state;");
}

// ---- Threads ----------------------------------------------------------------

function threadsFor(threadIds: string[]): ParsedThread[] {
  if (threadIds.length === 0) return [];
  const rows = db()
    .prepare("SELECT * FROM messages WHERE thread_id IN (SELECT value FROM json_each(?)) ORDER BY internal_date")
    .all(JSON.stringify(threadIds)) as unknown as MessageRow[];
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

const HAS_LABEL = (label: string) => `MAX(instr(' ' || labels || ' ', ' ${label} ') > 0)`;

/**
 * Threads that belong in the inbox view (anything in the inbox, plus things I sent),
 * newest activity first. `before` pages backwards; `since` stops at a cut-off.
 */
export function listThreads({ before = Number.MAX_SAFE_INTEGER, since = 0, limit }: { before?: number; since?: number; limit: number }) {
  const rows = db()
    .prepare(
      `SELECT thread_id, MAX(internal_date) AS last FROM messages GROUP BY thread_id
       HAVING (${HAS_LABEL("INBOX")} OR ${HAS_LABEL("SENT")}) AND last < ? AND last >= ?
       ORDER BY last DESC LIMIT ?`,
    )
    .all(before, since, limit) as { thread_id: string }[];
  return threadsFor(rows.map((r) => r.thread_id));
}

/** Whether any inbox-view thread is older than `before`. */
export function hasThreadsBefore(before: number) {
  return Boolean(
    db()
      .prepare(
        `SELECT 1 FROM messages GROUP BY thread_id
         HAVING (${HAS_LABEL("INBOX")} OR ${HAS_LABEL("SENT")}) AND MAX(internal_date) < ? LIMIT 1`,
      )
      .get(before),
  );
}

/** Plain-text search across every stored thread, archived ones included. */
export function searchThreads(query: string, limit: number) {
  const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = db()
    .prepare(
      `SELECT thread_id, MAX(internal_date) AS last FROM messages
       WHERE subject LIKE ?1 ESCAPE '\\' OR from_name LIKE ?1 ESCAPE '\\' OR from_email LIKE ?1 ESCAPE '\\'
          OR to_json LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\'
       GROUP BY thread_id ORDER BY last DESC LIMIT ?2`,
    )
    .all(like, limit) as { thread_id: string }[];
  return threadsFor(rows.map((r) => r.thread_id));
}

export function getThread(threadId: string) {
  return threadsFor([threadId])[0] ?? null;
}

/**
 * Messages that mention the most of `words`, for Ask Atlas. Subject and sender
 * hits count double; ties go to the newer message.
 */
export function messagesMatching(words: string[], limit: number) {
  if (words.length === 0) return [];
  const likes = words.map((w) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const clause = likes.map(() => "(subject LIKE ? ESCAPE '\\' OR from_name LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')").join(" OR ");
  const rows = db()
    .prepare(`SELECT * FROM messages WHERE ${clause} ORDER BY internal_date DESC LIMIT 400`)
    .all(...likes.flatMap((l) => [l, l, l])) as unknown as MessageRow[];

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
