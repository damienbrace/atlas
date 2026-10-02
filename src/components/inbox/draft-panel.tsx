"use client";

import {
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  ExternalLink,
  Pencil,
  Reply,
  Send,
  Shield,
  Smile,
  TextAlignStart,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";
import { Menu, type MenuItem } from "@/components/menu";
import { Sparkle } from "@/components/sparkle";
import { clock, headerTime } from "@/lib/format";
import { categoryLabel } from "@/lib/inbox/categories";
import type { Email, Tone } from "@/lib/inbox/types";
import { useHydrated } from "@/lib/use-hydrated";
import { counterpart, type DraftState, type InboxState } from "./use-inbox";

const TONES: { id: Exclude<Tone, "original">; label: string; icon: LucideIcon }[] = [
  { id: "shorter", label: "Shorter", icon: TextAlignStart },
  { id: "friendlier", label: "Friendlier", icon: Smile },
  { id: "firmer", label: "Firmer", icon: Shield },
];

const outlineButton =
  "flex h-12 items-center gap-2.5 rounded-xl border border-teal/70 px-5 text-[15px] font-medium text-ink transition-colors hover:bg-teal/10";
const textButton = "h-12 rounded-xl px-4 text-[15px] text-muted hover:text-ink";

export function DraftPanel({ inbox, className = "" }: { inbox: InboxState; className?: string }) {
  const email = inbox.composing ? null : inbox.selected;
  const draft = email ? inbox.draftFor(email) : null;
  const status = draft?.status;

  // Atlas writes the first draft as soon as an email that needs a reply is opened.
  const requestFirstDraft = useEffectEvent((e: Email) => inbox.ensureDraft(e));
  useEffect(() => {
    if (email && status === "pending") requestFirstDraft(email);
  }, [email, status]);

  const menuItems: MenuItem[] = email
    ? [
        { label: "Regenerate", onSelect: () => inbox.regenerate(email) },
        ...(inbox.canModify ? [{ label: "Save to drafts", onSelect: inbox.saveAsDraft }] : []),
        { label: "Discard draft", onSelect: () => inbox.dismiss(email), danger: true },
      ]
    : [];

  return (
    <aside
      aria-label="Atlas draft"
      className={`${className} min-w-0 shrink-0 flex-col rounded-2xl border border-line bg-panel p-4 [overflow-wrap:anywhere] xl:min-h-0 xl:flex-[0.95] xl:overflow-y-auto scroll-thin`}
    >
      <header className="flex items-center justify-between gap-3 px-1 pt-1 pb-4">
        <div className="flex items-center gap-3">
          <Sparkle className="size-9" glow />
          <h2 className="text-[22px] font-bold tracking-tight">Atlas draft</h2>
        </div>
        {email && status === "ready" && (
          <Menu
            label="Draft options"
            trigger={
              <>
                Draft <ChevronDown className="size-4" />
              </>
            }
            triggerClassName="flex h-9 items-center gap-2 rounded-full border border-amber/60 bg-amber/[0.06] px-4 text-[14px] font-medium text-amber hover:bg-amber/10"
            items={menuItems}
          />
        )}
      </header>

      <PanelBody email={email} draft={draft} inbox={inbox} />
    </aside>
  );
}

function PanelBody({ email, draft, inbox }: { email: Email | null; draft: DraftState | null; inbox: InboxState }) {
  if (!email || !draft) {
    return (
      <Placeholder>
        <p className="text-[15px] text-muted">
          {inbox.composing ? "Atlas drafts appear here when you reply to an email." : "Open an email to see Atlas's draft."}
        </p>
      </Placeholder>
    );
  }

  switch (draft.status) {
    case "sent":
      return <SentCard draft={draft} />;
    case "replied":
      return <RepliedCard email={email} draft={draft} inbox={inbox} />;
    case "error":
      return (
        <Placeholder>
          <p className="font-semibold">Atlas couldn&apos;t write this draft</p>
          <p className="max-w-72 text-[14.5px] text-muted">{draft.error}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => inbox.regenerate(email)} className={outlineButton}>
              Try again
            </button>
            <button type="button" onClick={() => inbox.writeOwn(email)} className={textButton}>
              Write my own
            </button>
          </div>
        </Placeholder>
      );
    case "dismissed":
    case "none": {
      const noAi = !inbox.aiEnabled;
      return (
        <Placeholder>
          <p className="font-semibold">{draft.status === "none" ? "No reply needed" : "Draft dismissed"}</p>
          <p className="max-w-64 text-[14.5px] text-muted">
            {noAi
              ? "Add an Anthropic API key to .env.local and Atlas will write replies."
              : draft.status === "dismissed"
                ? "Ask Atlas for a fresh one, or write your own."
                : email.category === "unsorted"
                  ? "Atlas only sorts the last 2 weeks, so it hasn't read this one."
                  : `Atlas filed this under ${categoryLabel(email.category)}, so it didn't draft a reply.`}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {!noAi && (
              <button type="button" onClick={() => inbox.regenerate(email)} className={outlineButton}>
                <Sparkle className="size-[18px]" />
                {draft.status === "none" ? "Draft a reply anyway" : "New draft"}
              </button>
            )}
            <button type="button" onClick={() => inbox.writeOwn(email)} className={textButton}>
              Write my own
            </button>
          </div>
        </Placeholder>
      );
    }
    default:
      // ready, rewriting, pending. Keyed so edit focus resets per email.
      return <DraftEditor key={email.id} email={email} draft={draft} inbox={inbox} />;
  }
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-8 text-center">
      {children}
    </div>
  );
}

function SentCard({ draft }: { draft: DraftState }) {
  const hydrated = useHydrated();
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <p className="flex items-center gap-2.5 font-semibold text-green">
        <CircleCheck className="size-5" />
        Sent{hydrated && draft.sentAt ? ` at ${clock(new Date(draft.sentAt))}` : ""}
      </p>
      <p className="mt-4 text-[15.5px] leading-relaxed whitespace-pre-line text-ink-soft">{draft.text}</p>
    </div>
  );
}

function RepliedCard({ email, draft, inbox }: { email: Email; draft: DraftState; inbox: InboxState }) {
  const hydrated = useHydrated();
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      <p className="flex items-center gap-2.5 font-semibold text-green">
        <Reply className="size-5" />
        You replied{hydrated && email.repliedAt ? ` · ${headerTime(email.repliedAt, new Date())}` : ""}
      </p>
      <p className="mt-4 text-[15.5px] leading-relaxed whitespace-pre-line text-ink-soft">{draft.text}</p>
      <button type="button" onClick={() => inbox.openInGmail(email)} className={`${outlineButton} mt-5`}>
        <ExternalLink className="size-[18px]" /> Open in Gmail
      </button>
    </div>
  );
}

function DraftEditor({ email, draft, inbox }: { email: Email; draft: DraftState; inbox: InboxState }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const editing = inbox.editingId === email.id;
  const busy = draft.status === "rewriting" || draft.status === "pending";
  const outgoing = email.direction === "out";

  useEffect(() => {
    const el = textRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  return (
    <div className="flex flex-1 flex-col">
      {draft.author === "atlas" ? (
        <section
          aria-label="Why this draft"
          className="flex gap-4 rounded-xl border border-l-[3px] border-line border-l-teal bg-card p-5"
        >
          <Sparkle className="mt-0.5 size-7" glow />
          <div className="text-[15.5px] leading-relaxed">
            <p className="text-ink">{outgoing ? "Follow-up for an email with no reply." : "Draft reply based on this email."}</p>
            <p className="text-muted">{draft.rationale ?? (busy ? "Reading the thread…" : "")}</p>
          </div>
        </section>
      ) : (
        <p className="px-1 text-[14.5px] text-muted">Your reply to {counterpart(email).name}</p>
      )}

      <div
        className={`relative mt-3 flex flex-1 rounded-xl border transition-colors ${
          editing ? "border-teal/60 ring-1 ring-teal/25" : "border-line"
        }`}
      >
        <textarea
          ref={textRef}
          value={draft.text}
          readOnly={!editing}
          onChange={(e) => inbox.editText(email, e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && inbox.setEditingId(null)}
          onDoubleClick={() => !busy && inbox.setEditingId(email.id)}
          aria-label={`Draft reply to ${counterpart(email).name}`}
          placeholder="Write your reply"
          className="block min-h-[260px] w-full flex-1 resize-none bg-transparent p-5 text-[16.5px] leading-[1.75] text-ink outline-none placeholder:text-faint [field-sizing:content]"
        />
        {busy && <Rewriting tone={draft.tone} />}
      </div>

      <p className="mt-5 px-1 text-[14px] text-muted">Tone</p>
      <div role="group" aria-label="Tone" className="mt-2.5 flex flex-wrap gap-2.5">
        {TONES.map(({ id, label, icon: Icon }) => {
          const active = draft.tone === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              disabled={busy}
              onClick={() => inbox.setTone(email, id)}
              className={`flex h-12 items-center gap-2.5 rounded-xl border px-4 text-[15px] transition-colors disabled:opacity-60 ${
                active ? "border-teal/70 bg-teal/10 text-teal" : "border-line-strong text-ink hover:border-faint"
              }`}
            >
              <Icon className="size-5" strokeWidth={1.75} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button
          type="button"
          disabled={busy || draft.text.trim() === ""}
          onClick={() => void inbox.approve(email)}
          className="flex h-14 items-center gap-2.5 rounded-xl bg-teal px-6 text-[16px] font-semibold text-canvas shadow-[0_0_24px_-8px_rgba(45,212,191,0.6)] transition-opacity hover:opacity-90 disabled:opacity-40 disabled:shadow-none"
        >
          {inbox.live ? (
            <>
              {draft.copied ? <Check className="size-5" /> : <Copy className="size-5" />}
              {draft.copied ? "Copied · open again" : "Copy & open Gmail"}
            </>
          ) : (
            <>
              <Send className="size-5" /> Approve &amp; send
            </>
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => inbox.setEditingId(editing ? null : email.id)}
          className={`${outlineButton} h-14 disabled:opacity-40`}
        >
          {editing ? <Check className="size-5" /> : <Pencil className="size-5" />}
          {editing ? "Done" : "Edit"}
        </button>
        <button type="button" onClick={() => inbox.dismiss(email)} className="h-14 rounded-xl px-4 text-[15px] text-ink-soft hover:text-ink">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Rewriting({ tone }: { tone: Tone }) {
  return (
    <div role="status" className="absolute inset-0 flex flex-col gap-3 rounded-xl bg-panel/90 p-5 backdrop-blur-[1px]">
      <p className="flex items-center gap-2 text-[14.5px] text-teal">
        <Sparkle className="size-4 animate-shimmer" />
        {tone === "original" ? "Writing a draft…" : `Making it ${tone}…`}
      </p>
      {[72, 92, 56, 84, 40].map((w, i) => (
        <span
          key={i}
          className="h-3 animate-shimmer rounded-full bg-raised"
          style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
