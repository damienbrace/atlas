"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { draftReply, saveOverride, type DraftResult } from "@/app/(app)/inbox/actions";
import { useToast } from "@/components/toast";
import { gmailComposeUrl, gmailThreadUrl } from "@/lib/gmail/links";
import { rewriteDraft } from "@/lib/inbox/assistant";
import { CATEGORIES, categoryLabel } from "@/lib/inbox/categories";
import type { Category, Email, InboxData, Label, Tone } from "@/lib/inbox/types";

export type DraftStatus =
  | "pending" // Atlas should write one; not started yet
  | "rewriting"
  | "ready"
  | "error"
  | "dismissed"
  | "sent" // sample inbox only
  | "replied" // I already replied in Gmail
  | "none"; // no reply needed

export interface DraftState {
  status: DraftStatus;
  tone: Tone;
  text: string;
  /** "me" once I start from a blank reply instead of Atlas's suggestion. */
  author: "atlas" | "me";
  rationale?: string;
  /** Tones already written for this email, so switching back is instant. */
  variants: Partial<Record<Tone, string>>;
  error?: string;
  sentAt?: string;
  /** Live mode: the draft has been copied for pasting into Gmail. */
  copied?: boolean;
}

type HiddenReason = "archived" | "deleted" | "snoozed";

const HIDDEN_MESSAGE: Record<HiddenReason, string> = {
  archived: "Archived",
  deleted: "Moved to bin",
  snoozed: "Snoozed until tomorrow",
};

// While the background sync runs, refresh often so new mail and summaries appear;
// otherwise check in now and then for new mail.
const SYNCING_REFRESH_MS = 3000;
const IDLE_REFRESH_MS = 60_000;
const SEARCH_DELAY_MS = 300;

const needsReply = (email: Email) => email.needsReply ?? email.draft !== undefined;

/** Drafts belong to the message they answer: a new message in the thread starts afresh. */
const draftKey = (email: Email) => `${email.id}:${email.messageId ?? ""}`;

function initialDraft(email: Email): DraftState {
  const base = { tone: "original" as const, author: "atlas" as const, variants: email.draft?.variants ?? {} };
  if (email.repliedAt) return { ...base, status: "replied", text: email.myReply ?? "", author: "me" };
  const original = email.draft?.variants.original;
  if (original) return { ...base, status: "ready", text: original, rationale: email.draft?.rationale };
  return { ...base, status: needsReply(email) ? "pending" : "none", text: "" };
}

/** The other party: the sender for received mail, the recipient for mail I sent. */
export function counterpart(email: Email) {
  return email.direction === "in" ? email.from : email.to[0];
}

function matches(email: Email, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [email.from.name, ...email.to.map((c) => c.name), email.subject, email.headline, email.body ?? ""].some(
    (field) => field.toLowerCase().includes(q),
  );
}

/** Live rows from the first page win over older pages fetched earlier. */
function mergeById(first: Email[], later: Email[]) {
  const seen = new Set(first.map((e) => e.id));
  return [...first, ...later.filter((e) => !seen.has(e.id))];
}

export function useInbox(data: InboxData) {
  const toast = useToast();
  const router = useRouter();
  const live = data.source === "gmail";
  const account = live ? data.account : null;
  const syncing = live && data.sync.active;

  // Server data refreshes in the background; changes made here sit on top of it.
  const [edits, setEdits] = useState<Record<string, Partial<Pick<Email, "category" | "labels" | "unread">>>>({});
  const [readMessages, setReadMessages] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<Record<string, HiddenReason>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [older, setOlder] = useState<{ emails: Email[]; cursor: number | null; hasOlder: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searchResults, setSearchResults] = useState<Email[] | null>(null);
  const focus = live ? data.focus : undefined;
  const [selectedId, setSelectedId] = useState<string | null>(focus?.id ?? data.emails[0]?.id ?? null);
  const [filter, setFilter] = useState<Category | null>(null);
  const [query, setQueryState] = useState("");
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailOpenOnMobile, setDetailOpenOnMobile] = useState(Boolean(focus));
  // Latest draft request per email, so a slow response can't overwrite a newer one.
  const draftRequests = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), syncing ? SYNCING_REFRESH_MS : IDLE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, syncing, router]);

  // Live search runs on the server, across all stored mail.
  const trimmed = query.trim();
  useEffect(() => {
    if (!live || !trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/mail/threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: trimmed }),
          signal: controller.signal,
        });
        const json = (await res.json()) as { emails?: Email[] };
        setSearchResults(json.emails ?? []);
      } catch {
        // Aborted by a newer search, or offline: keep the last results.
      }
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [live, trimmed]);

  function setQuery(value: string) {
    setQueryState(value);
    if (!value.trim()) setSearchResults(null);
  }

  const withEdits = (email: Email): Email => {
    const edit = edits[email.id];
    const read = readMessages.has(email.messageId ?? email.id);
    return { ...email, ...edit, unread: edit?.unread ?? (email.unread && !read) };
  };

  const draftFor = (email: Email) => drafts[draftKey(email)] ?? initialDraft(email);
  const isDone = (email: Email) => {
    const status = draftFor(email).status;
    return status === "sent" || status === "replied";
  };
  const inCategory = (email: Email, category: Category) =>
    email.category === category && !(category === "action" && isDone(email));

  const inbox = mergeById(data.emails, [...(older?.emails ?? []), ...(focus ? [focus] : [])])
    .filter((e) => !hidden[e.id])
    .map(withEdits);
  const counts = Object.fromEntries(
    CATEGORIES.map((c) => [c.id, inbox.filter((e) => inCategory(e, c.id)).length]),
  ) as Record<Category, number>;
  const searching = live && trimmed !== "";
  const pool = searching ? (searchResults ?? []).map(withEdits) : inbox;
  const visible = pool.filter((e) => (!filter || inCategory(e, filter)) && (live || matches(e, query)));
  const selected = inbox.find((e) => e.id === selectedId) ?? pool.find((e) => e.id === selectedId) ?? null;

  const cursor = older ? older.cursor : live ? data.cursor : null;
  const hasOlder = older ? older.hasOlder : live && data.hasOlder;

  async function loadOlder() {
    if (cursor === null || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/mail/threads?before=${cursor}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { emails: Email[]; cursor: number | null; hasOlder: boolean };
      setOlder((prev) => ({ emails: [...(prev?.emails ?? []), ...page.emails], cursor: page.cursor, hasOlder: page.hasOlder }));
    } catch {
      toast({ message: "Couldn't load older mail" });
    } finally {
      setLoadingOlder(false);
    }
  }

  function updateEmail(id: string, patch: Partial<Pick<Email, "category" | "labels" | "unread">>) {
    setEdits((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  }

  function patchDraft(email: Email, patch: Partial<DraftState>) {
    const key = draftKey(email);
    setDrafts((all) => ({ ...all, [key]: { ...(all[key] ?? initialDraft(email)), ...patch } }));
  }

  function persist(email: Email, change: { category?: Category; labels?: Label[] }) {
    if (live && email.threadId) {
      saveOverride(email.threadId, change).catch(() => toast({ message: "Couldn't save that change" }));
    }
  }

  function markRead(email: Email) {
    setReadMessages((ids) => new Set(ids).add(email.messageId ?? email.id));
    if (edits[email.id]?.unread) updateEmail(email.id, { unread: false });
  }

  function select(id: string) {
    setSelectedId(id);
    setComposing(false);
    setEditingId(null);
    setDetailOpenOnMobile(true);
    // Read-only Gmail access: this only clears the dot in Atlas, not in Gmail.
    const email = pool.find((e) => e.id === id) ?? inbox.find((e) => e.id === id);
    if (email) markRead(email);
  }

  function closeDetail() {
    setDetailOpenOnMobile(false);
    setComposing(false);
    setSelectedId(null);
  }

  function hide(email: Email, reason: HiddenReason) {
    const index = visible.findIndex((e) => e.id === email.id);
    const next = visible[index + 1] ?? visible[index - 1] ?? null;
    setHidden((h) => ({ ...h, [email.id]: reason }));
    setEditingId(null);
    setSelectedId(next?.id ?? null);
    if (next) markRead(next);
    else setDetailOpenOnMobile(false);
    toast({
      message: HIDDEN_MESSAGE[reason],
      onAction: () => {
        setHidden((h) => {
          const rest = { ...h };
          delete rest[email.id];
          return rest;
        });
        setSelectedId(email.id);
      },
    });
  }

  function moveTo(email: Email, category: Category) {
    if (email.category === category) return;
    const previous = email.category;
    updateEmail(email.id, { category });
    persist(email, { category });
    toast({
      message: `Moved to ${categoryLabel(category)}`,
      onAction: () => {
        updateEmail(email.id, { category: previous });
        persist(email, { category: previous });
      },
    });
  }

  function toggleLabel(email: Email, label: Label) {
    const labels = email.labels.includes(label) ? email.labels.filter((l) => l !== label) : [...email.labels, label];
    updateEmail(email.id, { labels });
    persist(email, { labels });
  }

  function markUnread(email: Email) {
    updateEmail(email.id, { unread: true });
    toast({ message: "Marked as unread", onAction: () => updateEmail(email.id, { unread: false }) });
  }

  async function requestDraft(email: Email, tone: Tone, fresh: boolean): Promise<DraftResult> {
    if (live && email.threadId) return draftReply(email.threadId, tone, fresh);
    const text = await rewriteDraft(email, tone);
    return { ok: true, text, rationale: email.draft?.rationale ?? "A short acknowledgement. Edit it before sending." };
  }

  async function write(email: Email, tone: Tone, fresh = false) {
    const current = draftFor(email);
    const known = fresh ? undefined : current.variants[tone];
    setEditingId(null);
    if (known) {
      patchDraft(email, { status: "ready", tone, text: known, author: "atlas", copied: false });
      return;
    }
    const request = (draftRequests.current[email.id] ?? 0) + 1;
    draftRequests.current[email.id] = request;
    patchDraft(email, {
      status: "rewriting",
      tone,
      author: "atlas",
      error: undefined,
      copied: false,
      ...(fresh ? { variants: {} } : {}),
    });
    const result = await requestDraft(email, tone, fresh).catch(
      (): DraftResult => ({ ok: false, error: "Couldn't reach Atlas. Try again." }),
    );
    if (draftRequests.current[email.id] !== request) return;
    if (!result.ok) {
      patchDraft(email, { status: "error", error: result.error });
      return;
    }
    const key = draftKey(email);
    setDrafts((all) => {
      const prev = all[key] ?? initialDraft(email);
      return {
        ...all,
        [key]: {
          ...prev,
          status: "ready",
          text: result.text,
          rationale: result.rationale,
          variants: { ...prev.variants, [tone]: result.text },
        },
      };
    });
  }

  /** Tone chips act like a radio group: picking the active tone again returns to the original. */
  function setTone(email: Email, tone: Tone) {
    void write(email, draftFor(email).tone === tone ? "original" : tone);
  }

  /** Writes the first draft for an email that needs one. */
  function ensureDraft(email: Email) {
    if (draftFor(email).status === "pending") void write(email, "original");
  }

  function regenerate(email: Email) {
    void write(email, "original", true);
  }

  function editText(email: Email, text: string) {
    patchDraft(email, { text, copied: false });
  }

  function writeOwn(email: Email) {
    patchDraft(email, { status: "ready", tone: "original", text: "", author: "me" });
    setEditingId(email.id);
  }

  function startReply(email: Email) {
    const status = draftFor(email).status;
    if (status === "ready") setEditingId(email.id);
    else if (status !== "rewriting") writeOwn(email);
  }

  function dismiss(email: Email) {
    const previous = draftFor(email);
    patchDraft(email, { status: "dismissed" });
    setEditingId(null);
    toast({ message: "Draft dismissed", onAction: () => patchDraft(email, previous) });
  }

  async function approve(email: Email) {
    const draft = draftFor(email);
    setEditingId(null);

    if (live && account && email.threadId) {
      // Read-only access: hand the approved draft to Gmail to send.
      try {
        await navigator.clipboard.writeText(draft.text);
      } catch {
        toast({ message: "Couldn't copy the draft. Select it and copy by hand." });
        return;
      }
      window.open(gmailThreadUrl(account, email.threadId), "_blank", "noopener");
      patchDraft(email, { copied: true });
      toast({ message: "Draft copied. Paste it into your reply in Gmail." });
      return;
    }

    patchDraft(email, { status: "sent", sentAt: new Date().toISOString() });
    const kind = email.direction === "out" ? "Follow-up" : "Reply";
    toast({
      message: `${kind} sent to ${counterpart(email).name}`,
      onAction: () => patchDraft(email, draft),
    });
  }

  function saveAsDraft() {
    toast({ message: "Saved to drafts" });
  }

  function startCompose() {
    if (account) {
      window.open(gmailComposeUrl(account), "_blank", "noopener");
      return;
    }
    setComposing(true);
    setEditingId(null);
    setDetailOpenOnMobile(true);
  }

  function finishCompose(sentTo?: string) {
    setComposing(false);
    if (!selected) setDetailOpenOnMobile(false);
    toast({ message: sentTo ? `Sent to ${sentTo}` : "Draft discarded" });
  }

  async function copyAddress(email: Email) {
    const address = counterpart(email).email;
    try {
      await navigator.clipboard.writeText(address);
      toast({ message: `Copied ${address}` });
    } catch {
      toast({ message: "Couldn't copy the address" });
    }
  }

  function showAllFrom(email: Email) {
    setFilter(null);
    setQuery(counterpart(email).name);
    setDetailOpenOnMobile(false);
  }

  function openInGmail(email: Email) {
    if (account && email.threadId) window.open(gmailThreadUrl(account, email.threadId), "_blank", "noopener");
  }

  return {
    data,
    live,
    /** Sample inbox only: archive, delete, send and friends are simulated. Live access is read-only. */
    canModify: !live,
    aiEnabled: live ? data.ai : true,
    visible,
    counts,
    selected,
    filter,
    query,
    searching,
    searchPending: searching && searchResults === null,
    hasOlder: hasOlder && !searching,
    loadingOlder,
    composing,
    editingId,
    detailOpenOnMobile,
    draftFor,
    isDone,
    setFilter,
    setQuery,
    setEditingId,
    select,
    closeDetail,
    loadOlder,
    archive: (e: Email) => hide(e, "archived"),
    remove: (e: Email) => hide(e, "deleted"),
    snooze: (e: Email) => hide(e, "snoozed"),
    moveTo,
    toggleLabel,
    markUnread,
    setTone,
    ensureDraft,
    regenerate,
    editText,
    writeOwn,
    startReply,
    dismiss,
    approve,
    saveAsDraft,
    startCompose,
    finishCompose,
    copyAddress,
    showAllFrom,
    openInGmail,
  };
}

export type InboxState = ReturnType<typeof useInbox>;
