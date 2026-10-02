import "server-only";
import type { ParsedThread } from "@/lib/gmail/parse";
import type { Email } from "@/lib/inbox/types";
import { annotationsFor, type Annotations, type Override, type StoredDraft, type Triage } from "@/lib/store";
import { getThread, hasThreadsBefore, listThreads, searchThreads } from "./db";
import { SORT_DAYS, triageKey } from "./sync";

// Builds inbox rows from the local mail store. Rows carry Gmail's short preview,
// not the full body; the email view fetches that when it's opened.

const DAY_MS = 86_400_000;
const WAITING_AFTER_DAYS = 2;
/** First screen: everything from the sorted fortnight, and at least this many rows. */
const MIN_FIRST_PAGE = 60;
const OLDER_PAGE = 100;
const SEARCH_LIMIT = 100;
const MAX_REPLY_CHARS = 4000;

/** What Atlas has noted about these threads. */
function notesFor(threads: ParsedThread[]) {
  return annotationsFor(threads.map(triageKey), threads.map((t) => t.id));
}

function toEmails(threads: ParsedThread[], notes: Annotations, includeArchived = false) {
  const now = Date.now();
  return threads
    .map((t): Email | null => {
      const key = triageKey(t);
      const email = toEmail(t, notes.triage[key], notes.overrides[t.id], notes.drafts[key], now, includeArchived);
      return email && { ...email, task: notes.tasks[t.id], taskSuggestion: notes.suggestions[t.id] };
    })
    .filter((e): e is Email => e !== null);
}

/** The newest inbox rows: the whole sorted fortnight, padded to a sensible minimum. */
export async function firstPage() {
  const since = Date.now() - SORT_DAYS * DAY_MS;
  let threads = await listThreads({ since, limit: 1000, bodyChars: MAX_REPLY_CHARS });
  if (threads.length < MIN_FIRST_PAGE) threads = await listThreads({ limit: MIN_FIRST_PAGE, bodyChars: MAX_REPLY_CHARS });
  return page(threads);
}

/** The next rows older than `before` (epoch ms). */
export async function olderPage(before: number) {
  return page(await listThreads({ before, limit: OLDER_PAGE, bodyChars: MAX_REPLY_CHARS }));
}

/** A page of rows, plus the cursor (latest activity of its oldest thread) for fetching the next one. */
export interface InboxPage {
  emails: Email[];
  cursor: number | null;
  hasOlder: boolean;
}

async function page(threads: ParsedThread[]): Promise<InboxPage> {
  const oldest = threads.at(-1)?.messages.at(-1)?.date;
  const cursor = oldest ? Date.parse(oldest) : null;
  const [notes, hasOlder] = await Promise.all([notesFor(threads), cursor !== null && hasThreadsBefore(cursor)]);
  return { emails: toEmails(threads, notes), cursor, hasOlder };
}

export async function search(query: string) {
  const threads = await searchThreads(query, SEARCH_LIMIT, MAX_REPLY_CHARS);
  return toEmails(threads, await notesFor(threads), true);
}

/** One thread as an inbox row, archived or not: for links like /inbox?thread=… */
export async function threadRow(threadId: string) {
  const thread = await getThread(threadId);
  return thread ? (toEmails([thread], await notesFor([thread]), true)[0] ?? null) : null;
}

function toEmail(
  thread: ParsedThread,
  triage: Triage | undefined,
  override: Override | undefined,
  draft: StoredDraft | undefined,
  now: number,
  includeArchived: boolean,
): Email | null {
  const last = thread.messages.at(-1)!;
  const lastInbound = thread.messages.findLast((m) => !m.sentByMe);
  const inInbox = includeArchived || thread.messages.some((m) => m.inInbox);

  let shown = last;
  let direction: Email["direction"] = "in";
  let category: Email["category"];
  let repliedAt: string | undefined;
  let myReply: string | undefined;

  if (!last.sentByMe) {
    // Their message is the latest. Skip threads I've since archived.
    if (!inInbox) return null;
    // Only the recent fortnight is sorted; older mail stays unsorted.
    category = triage?.category ?? "unsorted";
  } else if (triage?.awaitingReply && now - Date.parse(last.date) >= WAITING_AFTER_DAYS * DAY_MS) {
    // I sent the last message, it expects an answer, and none has come.
    direction = "out";
    category = "waiting";
  } else if (inInbox && lastInbound) {
    // I've replied. Show their message, marked as replied.
    shown = lastInbound;
    repliedAt = last.date;
    myReply = last.body.slice(0, MAX_REPLY_CHARS);
    category = triage?.category ?? "unsorted";
  } else {
    return null;
  }

  category = override?.category ?? category;
  return {
    id: thread.id,
    threadId: thread.id,
    messageId: shown.id,
    designed: shown.designed,
    direction,
    from: shown.from,
    to: shown.to.slice(0, 5),
    subject: shown.subject,
    headline: triage?.headline ?? shown.subject,
    summary: triage?.summary ?? "",
    preview: shown.snippet,
    receivedAt: shown.date,
    category,
    unread: direction === "in" && shown.unread,
    labels: override?.labels ?? triage?.labels ?? [],
    needsReply: !repliedAt && (category === "waiting" || (triage?.needsReply ?? false)),
    repliedAt,
    myReply,
    draft,
  };
}
