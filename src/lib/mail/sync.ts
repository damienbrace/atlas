import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { describeAiError, triageThreads } from "@/lib/ai/claude";
import { aiConfigured } from "@/lib/env";
import { GmailClient, GmailHttpError, Pacer } from "@/lib/gmail/client";
import { GmailAuthExpiredError } from "@/lib/gmail/oauth";
import { parseMessage, type ParsedThread } from "@/lib/gmail/parse";
import { saveSuggestions } from "@/lib/life/task-suggestions";
import { annotationsFor, saveTriage } from "@/lib/store";
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

// Keeps Atlas's mail store in step with Gmail:
//   1. first run: download the last WINDOW_DAYS of mail, newest first, paced under Gmail's quota;
//   2. every run after: replay Gmail's change history (new mail, read/archived, deleted);
//   3. have Claude sort and summarise threads active in the last SORT_DAYS.
// Each run stops at a time budget (servers cut long requests off) and the next run
// carries on where it left off: opening Atlas starts a short run, the scheduled job a long one.

export const WINDOW_DAYS = 365;
export const SORT_DAYS = 14;
const DAY_MS = 86_400_000;

// Only Gmail's Primary and Updates tabs: promotions, social and forums are skipped.
const SKIP_LABELS = ["SPAM", "TRASH", "DRAFT", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const BACKFILL_QUERY = `newer_than:${WINDOW_DAYS}d -in:spam -in:trash -in:drafts -category:promotions -category:social -category:forums`;
// messages.get costs 20 units; 4 a second uses 4,800 of Gmail's 6,000 units a minute.
const DOWNLOADS_PER_SECOND = 4;
const DOWNLOAD_WORKERS = 4;
// Light check-ins (just a history replay) at most this often.
const MIN_SYNC_GAP_MS = 20_000;
const LOCK_TTL_MS = 2 * 60_000;
// Threads sent to Claude per round: three requests of eight in parallel.
const TRIAGE_ROUND = 24;
/** How long a run started by opening a page may take. */
const PAGE_RUN_MS = 45_000;

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

export async function syncStatus(): Promise<SyncStatus> {
  const [active, backfillDone, stored, estimate, sortingLeft, expired, problem] = await Promise.all([
    isLocked(),
    getState("backfill_done"),
    messageCount(),
    getState("backfill_estimate"),
    getState("sorting_left"),
    getState("auth_expired"),
    getState("triage_problem"),
  ]);
  return {
    active,
    downloading: backfillDone !== "1",
    stored,
    estimate: Number(estimate ?? 0),
    sortingLeft: Number(sortingLeft ?? 0),
    expired: expired === "1",
    problem,
  };
}

/** Starts a short sync after this response unless one is running or ran moments ago. */
export function startSync(account: string, refreshToken: string) {
  after(() => syncMail(account, refreshToken, PAGE_RUN_MS));
}

/** Syncs for up to `budgetMs`, unless another run holds the lock or a light check-in isn't due yet. */
export async function syncMail(account: string, refreshToken: string, budgetMs: number) {
  if ((await getState("account")) !== account) {
    // A different Gmail account: start its store from scratch.
    await clearMail();
    await setState("account", account);
  }
  const [last, backfillDone, sortingLeft] = await Promise.all([getState("last_sync"), getState("backfill_done"), getState("sorting_left")]);
  const caughtUp = backfillDone === "1" && Number(sortingLeft ?? 0) === 0;
  if (caughtUp && Date.now() - Number(last ?? 0) < MIN_SYNC_GAP_MS) return;

  const owner = randomUUID();
  if (!(await tryLock(owner, LOCK_TTL_MS))) return;
  try {
    await runSync(owner, refreshToken, Date.now() + budgetMs);
  } catch (error) {
    if (error instanceof GmailAuthExpiredError) await setState("auth_expired", "1");
    else console.error("[atlas] sync failed", error);
  } finally {
    await releaseLock(owner);
  }
}

async function runSync(owner: string, refreshToken: string, deadline: number) {
  const gmail = new GmailClient(refreshToken);
  const pacer = new Pacer(DOWNLOADS_PER_SECOND);
  const keepLock = () => void tryLock(owner, LOCK_TTL_MS).catch(() => {});
  const late = () => Date.now() > deadline;

  if (!(await getState("history_id"))) {
    // Remember where Gmail's history stands before downloading, so nothing that arrives mid-download is missed.
    await setState("history_id", (await gmail.profile()).historyId);
  } else {
    await replayHistory(gmail, pacer, keepLock, late);
  }
  await setState("auth_expired", null);

  if ((await getState("backfill_done")) !== "1") {
    let sorting: Promise<void> | null = null;
    let pageToken: string | undefined;
    do {
      const page = await gmail.listMessages(BACKFILL_QUERY, pageToken);
      if (!pageToken) await setState("backfill_estimate", page.estimate);
      await download(gmail, pacer, await missingIds(page.ids), keepLock, late);
      // The newest page covers the recent weeks: start sorting them while older mail downloads.
      sorting ??= sortRecent(keepLock, late);
      pageToken = page.nextPageToken;
    } while (pageToken && !late());
    await sorting;
    // Out of time: the next run lists again and skips what's already stored.
    if (pageToken) return;
    await setState("backfill_done", "1");
    await replayHistory(gmail, pacer, keepLock, late);
  }

  await sortRecent(keepLock, late);
  await setState("last_sync", Date.now());
}

/** Downloads and stores `ids`; false if the time budget ran out first. */
async function download(gmail: GmailClient, pacer: Pacer, ids: string[], keepLock: () => void, late: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_WORKERS, ids.length) }, async () => {
      while (next < ids.length && !late()) {
        const id = ids[next++];
        await pacer.wait();
        try {
          const message = parseMessage(await gmail.message(id));
          if (!message.labels.some((l) => SKIP_LABELS.includes(l))) await saveMessage(message);
        } catch (error) {
          if (error instanceof GmailAuthExpiredError) throw error;
          // Deleted since it was listed, or briefly unavailable: the next history replay catches up.
          console.warn(`[atlas] skipped message ${id}:`, error instanceof Error ? error.message : error);
        }
        if (next % 50 === 0) keepLock();
      }
    }),
  );
  return next >= ids.length;
}

async function replayHistory(gmail: GmailClient, pacer: Pacer, keepLock: () => void, late: () => boolean) {
  const start = await getState("history_id");
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
          if (labels.some((l) => SKIP_LABELS.includes(l))) await deleteMessage(message.id);
          else await setLabels(message.id, labels);
        }
        for (const { message } of record.messagesDeleted ?? []) {
          await deleteMessage(message.id);
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
  // Only move the bookmark on once everything it covers has been fetched.
  if (await download(gmail, pacer, await missingIds([...added]), keepLock, late)) await setState("history_id", latest);
}

/** Has Claude sort threads active in the last SORT_DAYS that it hasn't read yet. */
async function sortRecent(keepLock: () => void, late: () => boolean) {
  if (!aiConfigured()) {
    await setState("sorting_left", 0);
    return;
  }
  // Sorting clips each message to a few thousand characters after shortening links, so the rest isn't needed.
  const recent = await listThreads({ since: Date.now() - SORT_DAYS * DAY_MS, limit: 2000, bodyChars: 12_000 });
  const known = (await annotationsFor(recent.map(triageKey), [])).triage;
  const todo = recent.filter((t) => !known[triageKey(t)]);
  await setState("sorting_left", todo.length);
  await setState("triage_problem", null);

  for (let i = 0; i < todo.length && !late(); i += TRIAGE_ROUND) {
    const round = todo.slice(i, i + TRIAGE_ROUND);
    let results: Awaited<ReturnType<typeof triageThreads>>;
    try {
      results = await triageThreads(round);
    } catch (error) {
      console.error("[atlas] triage failed", error);
      await setState("triage_problem", describeAiError(error));
      return;
    }
    // Outside the try: a database error isn't Claude's, and fails the sync with its own log line.
    await saveRound(round, results);
    await setState("sorting_left", Math.max(0, todo.length - i - round.length));
    keepLock();
  }
}

/** Saves Claude's read of a round of threads, and any tasks it spotted as suggestions. Returns how many. */
async function saveRound(round: ParsedThread[], results: Awaited<ReturnType<typeof triageThreads>>) {
  const read = round.flatMap((t) => {
    const result = results.get(t.id);
    return result ? [{ thread: t, ...result }] : [];
  });
  await saveTriage(read.map(({ thread, triage }) => ({ key: triageKey(thread), threadId: thread.id, triage })));
  const suggestions = read.flatMap(({ thread, triage, task }) =>
    task
      ? [
          {
            key: triageKey(thread),
            threadId: thread.id,
            ...task,
            emailFrom: thread.messages.findLast((m) => !m.sentByMe)?.from.name ?? "",
            emailHeadline: triage.headline,
          },
        ]
      : [],
  );
  await saveSuggestions(suggestions);
  return suggestions.length;
}

/**
 * One-off: re-reads recent threads that were sorted before Atlas looked for tasks, so
 * the suggestions start full. Only threads sorted into `categories` (e.g. action, receipts).
 */
export async function lookBackForTasks(categories: string[], budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const recent = await listThreads({ since: Date.now() - SORT_DAYS * DAY_MS, limit: 2000, bodyChars: 12_000 });
  const { triage } = await annotationsFor(recent.map(triageKey), []);
  const done = new Set((await getState("lookback_done"))?.split(" ") ?? []);
  const todo = recent.filter((t) => {
    const read = triage[triageKey(t)];
    return read && categories.includes(read.category) && !done.has(t.id);
  });
  let suggested = 0;
  let looked = 0;
  for (let i = 0; i < todo.length && Date.now() < deadline; i += TRIAGE_ROUND) {
    const round = todo.slice(i, i + TRIAGE_ROUND);
    suggested += await saveRound(round, await triageThreads(round));
    looked += round.length;
    // Remember progress so a second run carries on rather than paying twice.
    round.forEach((t) => done.add(t.id));
    await setState("lookback_done", [...done].join(" "));
  }
  return { candidates: todo.length, looked, suggested };
}