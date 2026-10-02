import "server-only";
import { lifeDb } from "./db";

// Small preferences, stored as JSON. They live with your data, so desktop and phone share them.

export function getSetting<T>(key: string, fallback: T): T {
  const row = lifeDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  lifeDb().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
}
