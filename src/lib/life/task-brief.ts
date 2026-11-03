import "server-only";
import { briefTask, writeTaskHelp, type HelpKind, type TaskBriefText } from "@/lib/ai/claude";
import { getGoogleAccount } from "@/lib/auth/account";
import { sql } from "@/lib/db";
import { GmailClient, GmailHttpError, type GmailMessage, type GmailThread } from "@/lib/gmail/client";
import { gmailDraftUrl, gmailThreadUrl } from "@/lib/gmail/links";
import { COMPOSE_SCOPE } from "@/lib/gmail/oauth";
import { parseThread, type ParsedThread } from "@/lib/gmail/parse";
import type { Task } from "./tasks";

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

/** Hermes puts the sender on a "From: Name <address>" line in the notes of the tasks it makes from email. */
function senderOf(notes: string) {
  const line = notes.split("\n").find((l) => l.trim().toLowerCase().startsWith("from:"));
  return line?.match(/[^\s<>"',;]+@[^\s<>"',;]+/)?.[0] ?? null;
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
  const after = Math.floor((task.createdAt - 45 * DAY) / 1000);
  const before = Math.floor((task.createdAt + 2 * DAY) / 1000);
  const { ids } = await gmail.listMessages(`from:${sender} after:${after} before:${before}`, undefined, 6);
  if (ids.length === 0) return null;
  const want = words(task.title);
  const messages = await Promise.all(ids.map((id) => gmail.message(id)));
  const score = (m: GmailMessage) => [...words(`${header(m, "Subject")} ${m.snippet}`)].filter((w) => want.has(w)).length;
  // Most words in common with the title; a tie goes to the newer one (ids come newest first).
  const best = messages.reduce((a, b) => (score(b) > score(a) ? b : a));
  return gmail.thread(best.threadId);
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

/** The kept summary, or a fresh one when there's none yet, the title changed, or `refresh` asks for it. */
export async function taskBrief(task: Task, refresh: boolean): Promise<StoredBrief> {
  const kept = refresh ? null : await stored(task.id);
  if (kept && kept.brief.title === task.title) return kept;

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
