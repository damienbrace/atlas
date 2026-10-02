"use server";

import { signedIn } from "@/lib/auth/session";
import { isDayKey } from "@/lib/life/days";
import { saveEntry } from "@/lib/life/journal";

// Server Functions are public endpoints: validate every input.

const MAX_CHARS = 200_000;

export async function saveJournalEntry(day: string, body: string, mood: number | null) {
  if (!(await signedIn())) return { ok: false as const };
  const validMood = mood === null || (Number.isInteger(mood) && mood >= 1 && mood <= 5);
  if (!isDayKey(day) || typeof body !== "string" || body.length > MAX_CHARS || !validMood) {
    return { ok: false as const };
  }
  await saveEntry(day, body, mood);
  return { ok: true as const };
}
