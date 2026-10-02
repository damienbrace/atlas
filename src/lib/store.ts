import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Category, Label, Tone } from "@/lib/inbox/types";

// Small JSON file of things worth keeping between runs: Atlas's read of each
// thread, drafts it has written, and the sorting corrections I make. Lives in
// .data/ (git- and Dropbox-ignored). Swaps for Supabase once sync moves server-side.

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

interface StoreData {
  /** Keyed by `${threadId}:${lastMessageId}` so a new message re-triages the thread. */
  triage: Record<string, Triage>;
  drafts: Record<string, StoredDraft>;
  /** Keyed by thread id; survives new messages. */
  overrides: Record<string, Override>;
}

const FILE = path.join(process.cwd(), ".data", "atlas.json");

let writes: Promise<void> = Promise.resolve();

async function load(): Promise<StoreData> {
  try {
    return { triage: {}, drafts: {}, overrides: {}, ...JSON.parse(await readFile(FILE, "utf8")) };
  } catch {
    return { triage: {}, drafts: {}, overrides: {} };
  }
}

export async function readStore() {
  await writes;
  return load();
}

/** Serialised read-modify-write, written atomically via a temp file. */
export function updateStore(change: (data: StoreData) => void) {
  const run = writes.then(async () => {
    const data = await load();
    change(data);
    await mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data));
    await rename(temp, FILE);
  });
  // Keep the queue alive if one write fails; the caller still sees the error.
  writes = run.catch(() => {});
  return run;
}
