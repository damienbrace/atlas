// One-off move of what Atlas kept on the PC (.data/life.db, mail.db, atlas.json)
// into Supabase. Run with `npm run db:import` after `npm run db:setup`.
// Never overwrites: rows already in Supabase are left as they are, so it's safe to re-run.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL isn't set in .env.local yet.");
  process.exit(1);
}

const DATA = new URL("../.data/", import.meta.url);
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max_pipeline: 0, max: 1, onnotice: () => {} });
const counts = {};

function open(name) {
  const file = new URL(name, DATA);
  return existsSync(file) ? new DatabaseSync(file, { readOnly: true }) : null;
}

// Many rows per statement: the batch goes up as one JSON value and jsonb_to_recordset
// turns it back into rows (nulls and booleans intact).
async function insertMany(table, rows, columns, select, conflict) {
  const names = columns.map(([name]) => name).join(", ");
  const defs = columns.map(([name, type]) => `${name} ${type}`).join(", ");
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) => Object.fromEntries(columns.map(([name]) => [name, r[name] ?? null])));
    await sql`
      INSERT INTO ${sql(table)} (${sql.unsafe(names)})
      SELECT ${sql.unsafe(select)} FROM jsonb_to_recordset(${sql.json(batch)}) AS t (${sql.unsafe(defs)})
      ON CONFLICT ${sql.unsafe(conflict)} DO NOTHING`;
  }
  counts[table] = (counts[table] ?? 0) + rows.length;
}

try {
  // ---- Journal, habits, notes, tasks, settings ---------------------------------
  const life = open("life.db");
  if (life) {
    const all = (q) => life.prepare(q).all();
    await insertMany("journal", all("SELECT * FROM journal"), [["day", "text"], ["body", "text"], ["mood", "smallint"], ["updated_at", "bigint"]], "*", "(day)");
    await insertMany(
      "habits",
      all("SELECT * FROM habits").map((h) => ({ ...h, archived: h.archived === 1 })),
      [["id", "text"], ["name", "text"], ["color", "text"], ["days", "text"], ["position", "integer"], ["created_at", "bigint"], ["archived", "boolean"]],
      "*",
      "(id)",
    );
    await insertMany("habit_checks", all("SELECT * FROM habit_checks"), [["habit_id", "text"], ["day", "text"]], "*", "(habit_id, day)");
    await insertMany(
      "notes",
      all("SELECT * FROM notes"),
      [["id", "text"], ["title", "text"], ["body", "text"], ["tag", "text"], ["created_at", "bigint"], ["updated_at", "bigint"]],
      "*",
      "(id)",
    );
    await insertMany(
      "tasks",
      all("SELECT * FROM tasks"),
      [["id", "text"], ["title", "text"], ["due_day", "text"], ["done_at", "bigint"], ["source", "text"], ["created_at", "bigint"]],
      "*",
      "(id)",
    );
    await insertMany("settings", all("SELECT * FROM settings"), [["key", "text"], ["value", "text"]], "key, value::jsonb", "(key)");
    life.close();
  }

  // ---- Mail ------------------------------------------------------------------
  const mail = open("mail.db");
  if (mail) {
    const messages = mail.prepare("SELECT * FROM messages").all().map((m) => ({ ...m, designed: m.designed === 1 }));
    await insertMany(
      "messages",
      messages,
      [
        ["id", "text"], ["thread_id", "text"], ["internal_date", "bigint"], ["from_name", "text"], ["from_email", "text"],
        ["to_json", "text"], ["subject", "text"], ["snippet", "text"], ["body", "text"], ["labels", "text"], ["designed", "boolean"],
      ],
      "id, thread_id, internal_date, from_name, from_email, to_json::jsonb, subject, snippet, body, string_to_array(labels, ' '), designed",
      "(id)",
    );
    // Carry on from where the PC's sync got to. The download window grew from 90 days
    // to a year, so the cloud keeps downloading the older mail; the lock isn't copied.
    const keep = ["account", "history_id", "last_sync"];
    const state = mail.prepare("SELECT * FROM sync_state").all().filter((s) => keep.includes(s.key));
    await insertMany("sync_state", state, [["key", "text"], ["value", "text"]], "*", "(key)");
    mail.close();
  }

  // ---- What Atlas wrote about the mail (atlas.json) --------------------------------
  const notesFile = new URL("atlas.json", DATA);
  if (existsSync(notesFile)) {
    const store = JSON.parse(await readFile(notesFile, "utf8"));
    const json = (record, key) => Object.entries(record ?? {}).map(([k, data]) => ({ [key]: k, data: JSON.stringify(data) }));
    const triage = json(store.triage, "key").map((t) => ({ ...t, thread_id: t.key.split(":")[0] }));
    await insertMany("triage", triage, [["key", "text"], ["thread_id", "text"], ["data", "text"]], "key, thread_id, data::jsonb", "(key)");
    await insertMany("drafts", json(store.drafts, "key"), [["key", "text"], ["data", "text"]], "key, data::jsonb", "(key)");
    await insertMany("overrides", json(store.overrides, "thread_id"), [["thread_id", "text"], ["data", "text"]], "thread_id, data::jsonb", "(thread_id)");
  }

  // ---- Check -----------------------------------------------------------------
  console.log("Copied from the PC (rows offered → rows now in Supabase):");
  for (const [table, offered] of Object.entries(counts)) {
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM ${sql(table)}`;
    console.log(`  ${table.padEnd(13)} ${String(offered).padStart(6)} → ${n}`);
  }
} finally {
  await sql.end();
}
