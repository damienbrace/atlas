import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Everything you write into Atlas yourself: journal, habits, notes, tasks.
// SQLite in .data/ (git- and Dropbox-ignored), on the PC that runs Atlas, so the
// phone and the desktop share it. Moves to Supabase along with the mail store.

const FILE = path.join(process.cwd(), ".data", "life.db");

let connection: DatabaseSync | null = null;

export function lifeDb() {
  if (connection) return connection;
  mkdirSync(path.dirname(FILE), { recursive: true });
  const conn = new DatabaseSync(FILE);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS journal (
      day TEXT PRIMARY KEY,          -- local date, YYYY-MM-DD
      body TEXT NOT NULL,
      mood INTEGER,                  -- 1 (rough) to 5 (great), optional
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      days TEXT NOT NULL,            -- weekdays it's due, 0 = Sunday, e.g. "0123456"
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS habit_checks (
      habit_id TEXT NOT NULL REFERENCES habits (id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      PRIMARY KEY (habit_id, day)
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tag TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL            -- JSON
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_day TEXT,
      done_at INTEGER,
      source TEXT NOT NULL,          -- "voice", "manual", …
      created_at INTEGER NOT NULL
    );
    PRAGMA foreign_keys = ON;
  `);
  connection = conn;
  return conn;
}
