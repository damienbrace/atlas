import "server-only";
import { randomUUID } from "node:crypto";
import { describeAiError, triageThreads } from "@/lib/ai/claude";
import { aiConfigured } from "@/lib/env";
import { GmailClient, GmailHttpError, Pacer } from "@/lib/gmail/client";
import { GmailAuthExpiredError } from "@/lib/gmail/oauth";
import { parseMessage, type ParsedThread } from "@/lib/gmail/parse";
import { readStore, updateStore } from "@/lib/store";
import {
  clearMail,
  deleteMessage,
  getState,
  isLocked,
  listThreads,
  messageCount,
  missingIds,
  releaseLock,
  saveMessage,
  setLabels,
  setState,
  tryLock,
} from "./db";

// Keeps the local mail store in step with Gmail, in the background:
//   1. first run: download the last WINDOW_DAYS of mail, newest first, paced under Gmail's quota;
//   2. every run after: replay Gmail's change history (new mail, read/archived, deleted);
//   3. have Claude sort and summarise threads active in the last SORT_DAYS.
// Runs inside the Next server process. Deployed to Vercel, this becomes a cron job.

export const WINDOW_DAYS = 90;
export const SORT_DAYS = 14;
const DAY_MS = 86_400_000;

const SKIP_LABELS = ["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"];
const BACKFILL_QUERY = `newer_than:${WINDOW_DAYS}d -in:spam -in:trash -in:drafts -category:promotions -category:social`;
// messages.get costs 20 units; 4 a second uses 4,800 of Gmail's 6,000 units a minute.
const DOWNLOADS_PER_SECOND = 4;
const DOWNLOAD_WORKERS = 4;
// Light check-ins (just a history replay) at most this often.
const MIN_SYNC_GAP_MS = 20_000;
const LOCK_TTL_MS = 2 * 60_000;
// Threads sent to Claude per round: three requests of eight in parallel.
const TRIAGE_ROUND = 24;

export const triageKey = (thread: ParsedThread) => `${thread.id}:${thread.messages.at(-1)!.id}`;

export interface SyncStatus {
  /** A sync is running right now. */
  active: boolean;
  /** Still downloading the first WINDOW_DAYS of mail. */
  downloading: boolean;
  stored: number;
  /** Gmail's rough count of how many messages the download covers. */
  estimate: number;
  /** Recent threads still waiting for Claude. */
  sortingLeft: number;
  expired: boolean;
  problem: string | null;
}

export function syncStatus(): SyncStatus {
  return {
    active: isLocked(),
    downloading: getState("backfill_done") !== "1",
    stored: messageCount(),
    estimate: Number(getState("backfill_estimate") ?? 0),
    sortingLeft: Number(getState("sorting_left") ?? 0),
    expired: getState("auth_expired") === "1",
    problem: getState("triage_problem"),
  };
}

/** Starts a background sync for this account unless one is running or ran moments ago. */
export function startSync(account: string, refreshToken: string) {
  if (getState("account") !== account) {
    // A different Gmail account: start its store from scratch.
    clearMail();
    setState("account", account);
  }
  const last = Number(getState("last_sync") ?? 0);
  const caughtUp = getState("backfill_done") === "1" && Number(getState("sorting_left") ?? 0) === 0;
  if (caughtUp && Date.now() - last < MIN_SYNC_GAP_MS) return;

  const owner = randomUUID();
  if (!tryLock(owner, LOCK_TTL_MS)) return;
  void runSync(owner, refreshToken)
    .catch((error) => {
      if (error instanceof GmailAuthExpiredError) setState("auth_expired", "1");
      else console.error("[atlas] sync failed", error);
    })
    .finally(() => releaseLock(owner));
}

async function runSync(owner: string, refreshToken: string) {
  const gmail = new GmailClient(refreshToken);
  const pacer = new Pacer(DOWNLOADS_PER_SECOND);
  const keepLock = () => tryLock(owner, LOCK_TTL_MS);

  if (!getState("history_id")) {
    // Remember where Gmail's history stands before downloading, so nothing that arrives mid-download is missed.
    setState("history_id", (await gmail.profile()).historyId);
  } else {
    await replayHistory(gmail, pacer, keepLock);
  }
  setState("auth_expired", null);

  if (getState("backfill_done") !== "1") {
    let sorting: Promise<void> | null = null;
    let pageToken: string | undefined;
    do {
      const page = await gmail.listMessages(BACKFILL_QUERY, pageToken);
      if (!pageToken) setState("backfill_estimate", page.estimate);
      await download(gmail, pacer, missingIds(page.ids), keepLock);
      // The newest page covers the recent weeks: start sorting them while older mail downloads.
      sorting ??= sortRecent(keepLock);
      pageToken = page.nextPageToken;
    } while (pageToken);
    setState("backfill_done", "1");
    await sorting;
    await replayHistory(gmail, pacer, keepLock);
  }

  await sortRecent(keepLock);
  setState("last_sync", Date.now());
}

async function download(gmail: GmailClient, pacer: Pacer, ids: string[], keepLock: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_WORKERS, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        await pacer.wait();
        try {
          const message = parseMessage(await gmail.message(id));
          if (!message.labels.some((l) => SKIP_LABELS.includes(l))) saveMessage(message);
        } catch (error) {
          if (error instanceof GmailAuthExpiredError) throw error;
          // Deleted since it was listed, or briefly unavailable: the next history replay catches up.
          console.warn(`[atlas] skipped message ${id}:`, error instanceof Error ? error.message : error);
        }
        if (next % 50 === 0) keepLock();
      }
    }),
  );
}

async function replayHistory(gmail: GmailClient, pacer: Pacer, keepLock: () => boolean) {
  const start = getState("history_id");
  if (!start) return;
  const added = new Set<string>();
  let latest = start;
  let pageToken: string | undefined;
  try {
    do {
      const page = await gmail.history(start, pageToken);
      for (const record of page.history ?? []) {
        for (const { message } of record.messagesAdded ?? []) {
          if (!(message.labelIds ?? []).some((l) => SKIP_LABELS.includes(l))) added.add(message.id);
        }
        for (const { message } of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
          const labels = message.labelIds ?? [];
          if (labels.some((l) => SKIP_LABELS.includes(l))) deleteMessage(message.id);
          else setLabels(message.id, labels);
        }
        for (const { message } of record.messagesDeleted ?? []) {
          deleteMessage(message.id);
          added.delete(message.id);
        }
      }
      latest = page.historyId ?? latest;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (error) {
    if (!(error instanceof GmailHttpError && error.status === 404)) throw error;
    // History only reaches back about a week. Re-list the recent fortnight instead.
    latest = (await gmail.profile()).historyId;
    let token: string | undefined;
    do {
      const page = await gmail.listMessages(BACKFILL_QUERY.replace(`${WINDOW_DAYS}d`, `${SORT_DAYS}d`), token);
      page.ids.forEach((id) => added.add(id));
      token = page.nextPageToken;
    } while (token);
  }
  await download(gmail, pacer, missingIds([...added]), keepLock);
  setState("history_id", latest);
}

/** Has Claude sort threads active in the last SORT_DAYS that it hasn't read yet. */
async function sortRecent(keepLock: () => boolean) {
  if (!aiConfigured()) {
    setState("sorting_left", 0);
    return;
  }
  const recent = listThreads({ since: Date.now() - SORT_DAYS * DAY_MS, limit: 2000 });
  const known = (await readStore()).triage;
  const todo = recent.filter((t) => !known[triageKey(t)]);
  setState("sorting_left", todo.length);
  setState("triage_problem", null);

  for (let i = 0; i < todo.length; i += TRIAGE_ROUND) {
    const round = todo.slice(i, i + TRIAGE_ROUND);
    try {
      const results = await triageThreads(round);
      await updateStore((data) => {
        for (const t of round) {
          const result = results.get(t.id);
          if (result) data.triage[triageKey(t)] = result;
        }
      });
    } catch (error) {
      console.error("[atlas] triage failed", error);
      setState("triage_problem", describeAiError(error));
      return;
    }
    setState("sorting_left", Math.max(0, todo.length - i - round.length));
    keepLock();
  }
}
