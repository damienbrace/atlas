import "server-only";
import { after } from "next/server";
import { briefTask, writeTaskHelp, type HelpKind, type TaskBriefText } from "@/lib/ai/claude";
import { getGoogleAccount } from "@/lib/auth/account";
import { sql, textList } from "@/lib/db";
import { aiConfigured } from "@/lib/env";
import { GmailClient, GmailHttpError, type GmailMessage, type GmailThread } from "@/lib/gmail/client";
import { gmailDraftUrl, gmailThreadUrl } from "@/lib/gmail/links";
import { COMPOSE_SCOPE } from "@/lib/gmail/oauth";
import { parseThread, type ParsedThread } from "@/lib/gmail/parse";
import { dayKey } from "./days";
import { waitingToShow } from "./task-rules";
import { getTasks, type Task } from "./tasks";

// The summary behind a tapped task: Atlas's read of it and of the email it came from,
// written once per task and kept, plus anything Atlas has written to help get it done.
// Nothing here sends anything: emails only ever become Gmail drafts.

export interface TaskEmail {
  threadId: string;
  subject: string;
  /** Who wrote it (the latest message not from the owner). */
  from: string;
  /** ISO time of the latest message. */
  date: string;
  url: string;
}

export interface TaskBrief extends TaskBriefText {
  email: TaskEmail | null;
  /** The title it was written for: a renamed task gets a fresh read. */
  title: string;
  createdAt: number;
}

export interface HelpResult {
  kind: HelpKind;
  to: string;
  subject: string;
  body: string;
}

export interface StoredBrief {
  brief: TaskBrief;
  /** What each help option wrote, keyed by its index. */
  results: Record<string, HelpResult>;
}

/** A failure worth showing as it is. */
export class TaskBriefError extends Error {}

const DAY = 86_400_000;

const header = (message: GmailMessage, name: string) =>
  message.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9$]+/).filter((w) => w.length > 2));

/** Parts of an address's domain that say nothing about who sent it. */
const PLAIN_DOMAIN_PARTS = new Set([
  ...["com", "net", "org", "gov", "edu", "mail", "email", "info", "news"],
  ...["gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "icloud", "bigpond", "optusnet"],
]);

/** The "From: Name <address>" line Hermes puts in the notes of the tasks it makes from email. */
function senderOf(notes: string) {
  const line = notes.split("\n").find((l) => l.trim().toLowerCase().startsWith("from:"));
  if (!line) return null;
  const address = line.match(/[^\s<>"',;]+@[^\s<>"',;]+/)?.[0] ?? "";
  // The person's name without any "(Company)" after it, and the telling part of the domain.
  const name = line.slice(line.indexOf(":") + 1).split("<")[0].replace(/\(.*?\)/g, "").replace(/["']/g, "").trim();
  const site =
    (address.split("@")[1] ?? "")
      .split(".")
      .filter((p) => p.length >= 4 && !PLAIN_DOMAIN_PARTS.has(p))
      .sort((a, b) => b.length - a.length)[0] ?? "";
  return { address, name, site };
}

/**
 * The email a task came from: its linked thread, or for Hermes's tasks the email from the
 * named sender around when the task was made whose subject best matches the title.
 */
async function findEmail(task: Task, gmail: GmailClient): Promise<GmailThread | null> {
  if (task.threadId) {
    return gmail.thread(task.threadId).catch((e) => (e instanceof GmailHttpError && e.status === 404 ? null : Promise.reject(e)));
  }
  const sender = senderOf(task.notes);
  if (!sender) return null;
  const window = `after:${Math.floor((task.createdAt - 60 * DAY) / 1000)} before:${Math.floor((task.createdAt + 2 * DAY) / 1000)}`;
  const want = words(task.title);
  const keywords = [...want].filter((w) => w.length >= 4 && !/^\$?\d/.test(w)).sort((a, b) => b.length - a.length).slice(0, 3);
  const score = (m: GmailMessage) => [...words(`${header(m, "Subject")} ${m.snippet}`)].filter((w) => want.has(w)).length;

  // Hermes sometimes gets the address a little wrong (".com" for ".com.au"), so looser
  // searches follow the exact one. Those only count an email whose subject matches the title.
  const searches: { q: string; minScore: number }[] = [];
  if (sender.address) searches.push({ q: `from:${sender.address}`, minScore: 0 });
  if (sender.name) searches.push({ q: `from:"${sender.name}"`, minScore: 2 });
  if (sender.site) searches.push({ q: `from:${sender.site}`, minScore: 2 });
  if (keywords.length >= 2) searches.push({ q: keywords.join(" "), minScore: 2 });

  for (const { q, minScore } of searches) {
    const { ids } = await gmail.listMessages(`${q} ${window}`, undefined, 6);
    if (ids.length === 0) continue;
    const messages = await Promise.all(ids.map((id) => gmail.message(id)));
    // Most words in common with the title; a tie goes to the newer one (ids come newest first).
    const best = messages.reduce((a, b) => (score(b) > score(a) ? b : a));
    if (score(best) >= minScore) return gmail.thread(best.threadId);
  }
  return null;
}

const fromThem = (thread: ParsedThread) => [...thread.messages].reverse().find((m) => !m.sentByMe) ?? thread.messages.at(-1);

async function stored(taskId: string) {
  const [row] = await sql<{ data: StoredBrief }[]>`SELECT data FROM task_briefs WHERE task_id = ${taskId}`;
  return row?.data ?? null;
}

async function store(taskId: string, data: StoredBrief) {
  await sql`
    INSERT INTO task_briefs (task_id, data, created_at) VALUES (${taskId}, ${sql.json(data as never)}, ${Date.now()})
    ON CONFLICT (task_id) DO UPDATE SET data = EXCLUDED.data`;
}

// Summaries being written in this server right now, so a tap during a background write
// waits for it instead of paying for a second one.
const writing = new Map<string, Promise<StoredBrief>>();

/** The kept summary, or a fresh one when there's none yet, the title changed, or `refresh` asks for it. */
export async function taskBrief(task: Task, refresh: boolean): Promise<StoredBrief> {
  if (!refresh) {
    const kept = await stored(task.id);
    if (kept && kept.brief.title === task.title) return kept;
    const pending = writing.get(task.id);
    if (pending) return pending;
  }
  const job = writeBrief(task).finally(() => writing.delete(task.id));
  writing.set(task.id, job);
  return job;
}

/** Summaries already written for these tasks (and still for the same title), to send with the page. */
export async function keptBriefs(tasks: Task[]): Promise<Record<string, StoredBrief>> {
  if (tasks.length === 0) return {};
  const rows = await sql<{ task_id: string; data: StoredBrief }[]>`
    SELECT task_id, data FROM task_briefs WHERE task_id = ANY (${textList(tasks.map((t) => t.id))})`;
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return Object.fromEntries(rows.filter((r) => r.data.brief.title === titles.get(r.task_id)).map((r) => [r.task_id, r.data]));
}

/** How many summaries are written side by side in the background. */
const FILL_AT_ONCE = 3;

/**
 * Writes summaries ahead of time, newest task first, so tapping a task shows one straight
 * away: open tasks with none yet, or renamed since. Tasks still hidden until closer to their
 * date wait until they show. Run it with after(), so nobody waits on it.
 */
export async function fillBriefs({ limit = 6, budgetMs = 40_000 } = {}) {
  if (!aiConfigured()) return;
  const started = Date.now();
  const rows = await sql<{ id: string }[]>`
    SELECT t.id FROM tasks t LEFT JOIN task_briefs b ON b.task_id = t.id
    WHERE t.deleted_at IS NULL AND t.done_at IS NULL
      AND (b.task_id IS NULL OR b.data->'brief'->>'title' IS DISTINCT FROM t.title)
    ORDER BY t.created_at DESC LIMIT ${limit * 3}`;
  const today = dayKey(new Date());
  const tasks = (await getTasks(rows.map((r) => r.id)))
    .filter((t) => !waitingToShow(t, today))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
  for (let i = 0; i < tasks.length && Date.now() - started < budgetMs; i += FILL_AT_ONCE) {
    const results = await Promise.allSettled(tasks.slice(i, i + FILL_AT_ONCE).map((t) => taskBrief(t, false)));
    for (const r of results) if (r.status === "rejected") console.error("Couldn't write a task summary ahead", r.reason);
  }
}

/** Writes missing summaries once the current response has gone out: after a task is added or renamed, or Tasks opens. */
export function fillBriefsLater(limit = 3) {
  after(() => fillBriefs({ limit }).catch((error) => console.error("Writing task summaries ahead", error)));
}

async function writeBrief(task: Task): Promise<StoredBrief> {
  const account = await getGoogleAccount();
  const raw = account
    ? await findEmail(task, new GmailClient(account.refreshToken)).catch((e) => {
        console.error("Couldn't look up the task's email", e);
        return null;
      })
    : null;
  const thread = raw ? parseThread(raw) : null;
  const text = await briefTask(task, thread);
  const them = thread && fromThem(thread);
  const email: TaskEmail | null =
    thread && them && account
      ? {
          threadId: thread.id,
          subject: thread.subject,
          from: them.from.name || them.from.email,
          date: thread.messages.at(-1)!.date,
          url: gmailThreadUrl(account.email, thread.id),
        }
      : null;
  const data: StoredBrief = { brief: { ...text, email, title: task.title, createdAt: Date.now() }, results: {} };
  await store(task.id, data);
  return data;
}

/** Writes one of the summary's help options and keeps it. Returns null if there's no such option. */
export async function taskHelp(task: Task, index: number): Promise<HelpResult | null> {
  const data = await stored(task.id);
  const option = data?.brief.help[index];
  if (!data || !option) return null;
  const { email } = data.brief;
  const account = email ? await getGoogleAccount() : null;
  const raw = email && account ? await new GmailClient(account.refreshToken).thread(email.threadId).catch(() => null) : null;
  const thread = raw ? parseThread(raw) : null;
  const written = await writeTaskHelp(task, option, thread);

  let { to, subject } = written;
  if (option.kind === "reply" && thread) {
    to = fromThem(thread)?.from.email ?? "";
    subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  } else if (option.kind === "email") {
    // Only an address that's actually in the task or the email, never one Claude made up.
    const known = [task.notes, ...(thread?.messages ?? []).flatMap((m) => [m.from.email, ...m.to.map((c) => c.email), m.body])].join("\n");
    if (!to.includes("@") || !known.toLowerCase().includes(to.toLowerCase())) to = "";
  } else {
    to = "";
  }
  const result: HelpResult = { kind: option.kind, to, subject, body: written.body };
  await store(task.id, { ...data, results: { ...data.results, [index]: result } });
  return result;
}

const CRLF = "\r\n";

/** Non-ASCII header text goes as an RFC 2047 encoded word. */
const encodeHeader = (value: string) =>
  [...value].every((c) => c.charCodeAt(0) < 128) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

function mimeMessage(m: { to: string; subject: string; body: string; inReplyTo: string; references: string }) {
  const headers = [
    m.to && `To: ${oneLine(m.to)}`,
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
    m.inReplyTo && `In-Reply-To: ${m.inReplyTo}`,
    m.references && `References: ${m.references}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const body = Buffer.from(m.body.replace(/\r?\n/g, CRLF)).toString("base64").replace(/.{76}/g, `$&${CRLF}`);
  return Buffer.from(`${headers.join(CRLF)}${CRLF}${CRLF}${body}`).toString("base64url");
}

/** Puts an email Atlas wrote into Gmail's drafts (a reply goes into its thread). Returns a link to open it. */
export async function saveTaskDraft(task: Task, input: { kind: "reply" | "email"; to: string; subject: string; body: string }) {
  const account = await getGoogleAccount();
  if (!account) throw new TaskBriefError("Google isn't connected. Sign out and back in.");
  if (!account.scopes.includes(COMPOSE_SCOPE)) throw new TaskBriefError("Atlas needs permission to write Gmail drafts. Sign out and back in.");
  const gmail = new GmailClient(account.refreshToken);

  let threadId: string | undefined;
  let inReplyTo = "";
  let references = "";
  const email = input.kind === "reply" ? (await stored(task.id))?.brief.email : null;
  if (email) {
    const raw = await gmail.thread(email.threadId);
    const last = raw.messages.at(-1);
    threadId = raw.id;
    inReplyTo = last ? header(last, "Message-ID") : "";
    references = [last ? header(last, "References") : "", inReplyTo].filter(Boolean).join(" ");
  }
  const draft = await gmail.createDraft(mimeMessage({ ...input, inReplyTo, references }), threadId);
  return gmailDraftUrl(account.email, draft.message.id);
}
