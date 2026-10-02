import "server-only";
import type { Contact } from "@/lib/inbox/types";
import type { GmailMessage, GmailPart, GmailThread } from "./client";
import { isDesigned } from "./email-html";

// Turns raw Gmail threads into plain messages: headers, readable body, labels.

export interface ParsedMessage {
  id: string;
  threadId: string;
  /** Gmail label ids, e.g. INBOX, UNREAD, SENT. The flags below are derived from these. */
  labels: string[];
  /** Gmail's short plain-text preview. */
  snippet: string;
  from: Contact;
  to: Contact[];
  subject: string;
  date: string;
  body: string;
  sentByMe: boolean;
  unread: boolean;
  inInbox: boolean;
  /** Has an HTML version with images or a table layout, worth showing as designed. */
  designed: boolean;
}

export interface ParsedThread {
  id: string;
  subject: string;
  messages: ParsedMessage[];
}

const MAX_BODY_CHARS = 20_000;

function header(part: GmailPart, name: string) {
  return part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** Parses an address list like `"Chen, Mark" <mark@x.com>, sarah@y.com`. */
export function parseAddresses(value: string): Contact[] {
  const parts = value.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  return parts
    .map((raw) => {
      const text = raw.trim();
      const angle = text.match(/^(.*)<([^>]+)>$/);
      if (angle) {
        const name = angle[1].trim().replace(/^"|"$/g, "");
        const email = angle[2].trim();
        return { name: name || email, email };
      }
      return { name: text, email: text };
    })
    .filter((c) => c.email.includes("@"));
}

function decode(data: string) {
  return Buffer.from(data, "base64url").toString("utf8");
}

function findPart(part: GmailPart, mimeType: string): GmailPart | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

/** The message's HTML version, if it has one. */
export function htmlOf(message: GmailMessage) {
  const part = findPart(message.payload, "text/html");
  return part ? decode(part.body!.data!) : null;
}

// Character sets are built from code points: invisible characters typed into source are easy to lose or mangle.
const chars = (...codes: number[]) => String.fromCharCode(...codes);

// Named HTML entities that turn up in real mail, as code points.
const ENTITIES: Record<string, number> = {
  nbsp: 0xa0, amp: 0x26, lt: 0x3c, gt: 0x3e, quot: 0x22, apos: 0x27,
  zwnj: 0x200c, zwj: 0x200d, shy: 0xad, ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009,
  ndash: 0x2013, mdash: 0x2014, hellip: 0x2026, bull: 0x2022, middot: 0xb7,
  lsquo: 0x2018, rsquo: 0x2019, ldquo: 0x201c, rdquo: 0x201d, laquo: 0xab, raquo: 0xbb,
  copy: 0xa9, reg: 0xae, trade: 0x2122, deg: 0xb0, times: 0xd7,
  euro: 0x20ac, pound: 0xa3, cent: 0xa2, yen: 0xa5,
};

/** Decodes `&amp;`, `&#39;`, `&#x2019;`, `&zwnj;` and friends. Unknown names are left as they are. */
export function decodeEntities(text: string) {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = hex ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    const code = ENTITIES[entity.toLowerCase()];
    return code ? chars(code) : match;
  });
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

/** Drops the quoted history replies carry ("On Thu, Mark wrote:" and "> " lines). */
export function stripQuoted(text: string) {
  const cut = text.search(/^(On .{0,200}?wrote:|-{2,}\s*Original Message\s*-{2,}|From: .+\n(Sent|Date): )/im);
  const kept = cut > 0 ? text.slice(0, cut) : text;
  return kept
    .split("\n")
    .filter((line) => !line.startsWith(">"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Zero-width and soft-hyphen padding that marketing mail uses to pad previews.
const INVISIBLE = new RegExp(`[${chars(0x034f, 0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2060, 0xfeff)}]`, "g");
// Runs of spaces, tabs and the wider Unicode spaces.
const SPACES = new RegExp(`[${chars(0x20, 0x09, 0xa0, 0x2002, 0x2003, 0x2009, 0x202f)}]+`, "g");
// Lines that are nothing but layout leftovers: lone dots, bullets, bars, rules.
const JUNK_LINE = new RegExp(
  `^[${chars(0x20, 0x09, 0x2e, 0x7c, 0x2a, 0x5f, 0x7e, 0x3d, 0xb7, 0x2022, 0x2013, 0x2014, 0x2d)}]+$`,
  "gm",
);

/** Removes the junk marketing mail carries: HTML comments and entities, invisible padding, layout leftovers. */
export function tidyText(text: string) {
  return decodeEntities(text.replace(/\r\n/g, "\n").replace(/<!--[\s\S]*?-->/g, ""))
    .replace(INVISIBLE, "")
    .replace(/\[(image|cid):[^\]]*\]/gi, "")
    .replace(SPACES, " ")
    .replace(/ *\n */g, "\n")
    .replace(JUNK_LINE, "");
}

function bodyOf(message: GmailMessage, html: string | null) {
  const plain = findPart(message.payload, "text/plain");
  const raw = plain ? decode(plain.body!.data!) : html ? htmlToText(html) : message.snippet;
  const text = stripQuoted(tidyText(raw)) || message.snippet;
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text;
}

/** Flags that come straight from a message's Gmail labels. */
export function labelFlags(labels: string[]) {
  return { sentByMe: labels.includes("SENT"), unread: labels.includes("UNREAD"), inInbox: labels.includes("INBOX") };
}

export function parseMessage(message: GmailMessage): ParsedMessage {
  const labels = message.labelIds ?? [];
  const from = parseAddresses(header(message.payload, "From"))[0] ?? { name: "Unknown sender", email: "" };
  const html = htmlOf(message);
  return {
    id: message.id,
    threadId: message.threadId,
    labels,
    snippet: decodeEntities(message.snippet ?? ""),
    from,
    to: parseAddresses([header(message.payload, "To"), header(message.payload, "Cc")].filter(Boolean).join(", ")),
    subject: header(message.payload, "Subject") || "(no subject)",
    date: new Date(Number(message.internalDate)).toISOString(),
    body: bodyOf(message, html),
    ...labelFlags(labels),
    designed: html !== null && isDesigned(html),
  };
}

export function parseThread(thread: GmailThread): ParsedThread {
  const messages = thread.messages
    .filter((m) => !(m.labelIds ?? []).includes("DRAFT"))
    .sort((a, b) => Number(a.internalDate) - Number(b.internalDate))
    .map(parseMessage);
  return { id: thread.id, subject: messages[0]?.subject ?? "(no subject)", messages };
}
