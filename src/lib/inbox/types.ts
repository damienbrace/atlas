/** "unsorted" = live mail older than the fortnight Atlas sorts; it gets no category pill. */
export type Category = "action" | "waiting" | "fyi" | "receipts" | "unsorted";

export type Tone = "original" | "shorter" | "friendlier" | "firmer";

export type Label = "Bricklaying" | "Henty Lodge" | "Trading" | "Personal";

export interface Contact {
  name: string;
  email: string;
}

export interface DraftSuggestion {
  /** One-line note on what the draft does, shown above the draft text. */
  rationale: string;
  /** Sample emails carry every tone; live drafts carry the tones written so far. */
  variants: Partial<Record<Tone, string>>;
}

export interface Email {
  /** Row id. For Gmail this is the thread id. */
  id: string;
  /** Set for live Gmail threads. */
  threadId?: string;
  /** Gmail id of the message shown. */
  messageId?: string;
  /** Has a designed HTML version (images, layout), shown as the sender laid it out. */
  designed?: boolean;
  /** "in" = received; "out" = sent by me and waiting on a reply. */
  direction: "in" | "out";
  from: Contact;
  to: Contact[];
  subject: string;
  /** AI-written title shown in the list instead of the raw subject. */
  headline: string;
  /** AI summary shown at the top of the open email. Empty when Atlas hasn't read it. */
  summary: string;
  /** Full text. Sample emails carry it; live rows leave it out and the email view fetches it. */
  body?: string;
  /** Short plain-text preview for the list (Gmail's snippet for live mail). */
  preview?: string;
  receivedAt: string;
  category: Category;
  unread: boolean;
  labels: Label[];
  /** Whether Atlas should write a reply. Defaults to "has a draft". */
  needsReply?: boolean;
  /** When I last replied in Gmail, if my message is the latest in the thread. */
  repliedAt?: string;
  myReply?: string;
  draft?: DraftSuggestion;
}

export type InboxStatus = "ok" | "expired" | "error";

/** Progress of the background Gmail sync, for the status line. */
export interface SyncProgress {
  active: boolean;
  downloading: boolean;
  stored: number;
  estimate: number;
  sortingLeft: number;
}

/** Everything the inbox screen needs from the server. */
export type InboxData =
  | {
      source: "sample";
      emails: Email[];
      /** Which keys are present in .env.local. */
      setup: { google: boolean; ai: boolean };
    }
  | {
      source: "gmail";
      account: string;
      emails: Email[];
      /** A thread to open straight away (from a link), even if it's not on the first page. */
      focus?: Email;
      /** For fetching the next page of older mail. */
      cursor: number | null;
      hasOlder: boolean;
      sync: SyncProgress;
      ai: boolean;
      status: InboxStatus;
      /** Why AI sorting or Gmail fetching partly failed, if it did. */
      problem?: string;
    };
