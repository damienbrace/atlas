import "server-only";
import { sql } from "@/lib/db";

// Small preferences, stored as JSON. They live with your data, so desktop and phone share them.

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await sql<{ value: T }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return row ? row.value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${sql.json(value as never)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}
