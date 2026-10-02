"use client";

import { Archive, ArrowLeft, ChevronDown, Ellipsis, ExternalLink, Folder, Mail, Reply, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { IconButton, iconButtonClass } from "@/components/icon-button";
import { LinkifiedText } from "@/components/linkified-text";
import { Menu } from "@/components/menu";
import { Sparkle } from "@/components/sparkle";
import { fullTime, headerTime } from "@/lib/format";
import { CATEGORIES, LABELS } from "@/lib/inbox/categories";
import type { Email } from "@/lib/inbox/types";
import { useHydrated } from "@/lib/use-hydrated";
import { EmailFrame } from "./email-frame";
import { useEmailBody } from "./use-email-body";
import { counterpart, type InboxState } from "./use-inbox";

export const paneClass =
  "flex min-w-0 shrink-0 flex-col rounded-2xl border border-line bg-panel xl:min-h-0 xl:flex-1 xl:overflow-y-auto scroll-thin";

export function EmailView({ inbox }: { inbox: InboxState }) {
  const email = inbox.selected;

  if (!email) {
    return (
      <article className={`${paneClass} items-center justify-center gap-3 p-10 text-center`}>
        <Mail className="size-9 text-faint" strokeWidth={1.4} />
        <p className="text-[15px] text-muted">Pick an email from the list.</p>
      </article>
    );
  }

  return (
    <article aria-label={email.subject} className={paneClass}>
      <Toolbar email={email} inbox={inbox} />
      <div className="border-b border-line px-6 pt-2 pb-5">
        <h2 className="text-[28px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere]">{email.subject}</h2>
        {email.labels.length > 0 && (
          <ul aria-label="Labels" className="mt-3 flex flex-wrap gap-1.5">
            {email.labels.map((label) => (
              <li key={label} className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-ink-soft">
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Keyed so the details toggle resets when switching emails. Sibling keys must differ. */}
      <SenderRow key={`sender-${email.id}`} email={email} inbox={inbox} />
      {email.summary && (
        <section
          aria-label="Atlas summary"
          className="mx-6 mt-5 flex items-center gap-4 rounded-xl border border-l-[3px] border-line border-l-teal bg-card px-5 py-4"
        >
          <Sparkle className="size-7" glow />
          <p className="text-[15.5px] leading-relaxed text-ink">{email.summary}</p>
        </section>
      )}
      {/* Keyed so each email starts in its default view. */}
      <EmailBody key={`body-${email.id}`} email={email} live={inbox.live} />
    </article>
  );
}

/** Designed emails show as their sender laid them out; everything else as clean text. */
function EmailBody({ email, live }: { email: Email; live: boolean }) {
  const canShowDesigned = live && email.designed && email.messageId;
  const [asText, setAsText] = useState(false);

  return (
    <>
      {canShowDesigned && (
        <div className="mx-6 mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => setAsText((t) => !t)}
            className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-white/5 hover:text-ink"
          >
            {asText ? "Show original" : "Show as text"}
          </button>
        </div>
      )}
      {canShowDesigned && !asText ? (
        <EmailFrame src={`/api/gmail/messages/${email.messageId}`} title={`Email: ${email.subject}`} />
      ) : (
        <TextBody email={email} />
      )}
    </>
  );
}

function TextBody({ email }: { email: Email }) {
  const { body, loading, failed } = useEmailBody(email);
  return (
    <div className="px-6 py-6 text-[16.5px] leading-[1.75] whitespace-pre-line text-ink/90 [overflow-wrap:anywhere]">
      <LinkifiedText text={body} />
      {loading && <p className="mt-3 animate-shimmer text-[14px] text-muted">Loading the full email…</p>}
      {failed && <p className="mt-3 text-[14px] text-muted">Couldn&apos;t load the full email. Open it in Gmail instead.</p>}
    </div>
  );
}

function Toolbar({ email, inbox }: { email: Email; inbox: InboxState }) {
  return (
    <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between rounded-t-2xl bg-panel px-4">
      <IconButton label="Back to list" onClick={inbox.closeDetail}>
        <ArrowLeft className="size-[22px]" strokeWidth={1.75} />
      </IconButton>
      <div className="flex items-center gap-1">
        {inbox.canModify ? (
          <>
            <IconButton label="Archive" onClick={() => inbox.archive(email)}>
              <Archive className="size-[21px]" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Delete" onClick={() => inbox.remove(email)}>
              <Trash2 className="size-[21px]" strokeWidth={1.75} />
            </IconButton>
          </>
        ) : (
          // Read-only Gmail access: archiving and deleting happen in Gmail.
          <IconButton label="Open in Gmail" onClick={() => inbox.openInGmail(email)}>
            <ExternalLink className="size-[21px]" strokeWidth={1.75} />
          </IconButton>
        )}
        <Menu
          label="Move to"
          heading="Move to"
          trigger={<Folder className="size-[21px]" strokeWidth={1.75} />}
          triggerClassName={iconButtonClass}
          items={CATEGORIES.map((c) => ({
            label: c.label,
            checked: email.category === c.id,
            onSelect: () => inbox.moveTo(email, c.id),
          }))}
        />
        <Menu
          label="Labels"
          heading="Labels"
          trigger={<Tag className="size-[21px]" strokeWidth={1.75} />}
          triggerClassName={iconButtonClass}
          items={LABELS.map((label) => ({
            label,
            checked: email.labels.includes(label),
            onSelect: () => inbox.toggleLabel(email, label),
          }))}
        />
        {inbox.canModify && (
          <Menu
            label="More actions"
            trigger={<Ellipsis className="size-[21px]" strokeWidth={1.75} />}
            triggerClassName={iconButtonClass}
            items={[
              { label: "Mark as unread", onSelect: () => inbox.markUnread(email) },
              { label: "Snooze until tomorrow", onSelect: () => inbox.snooze(email) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function SenderRow({ email, inbox }: { email: Email; inbox: InboxState }) {
  const [showDetails, setShowDetails] = useState(false);
  const hydrated = useHydrated();
  const person = counterpart(email);
  const outgoing = email.direction === "out";

  return (
    <div className="px-6 pt-5">
      <div className="flex items-start gap-3.5">
        <Avatar name={email.from.name} className="size-12 text-[18px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{outgoing ? "You" : email.from.name}</p>
          <button
            type="button"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((s) => !s)}
            className="mt-0.5 flex items-center gap-1 rounded text-[14px] text-muted hover:text-ink"
          >
            {outgoing ? `to ${person.name}` : "to me"}
            <ChevronDown className={`size-4 transition-transform ${showDetails ? "rotate-180" : ""}`} />
          </button>
        </div>
        <span className="pt-0.5 text-[14px] text-muted tabular-nums">
          {hydrated ? headerTime(email.receivedAt, new Date()) : ""}
        </span>
        <div className="-mt-1.5 flex">
          <IconButton label={outgoing ? "Write a follow-up" : "Reply"} onClick={() => inbox.startReply(email)}>
            <Reply className="size-[21px]" strokeWidth={1.75} />
          </IconButton>
          <Menu
            label={`More for ${person.name}`}
            trigger={<Ellipsis className="size-[21px]" strokeWidth={1.75} />}
            triggerClassName={iconButtonClass}
            items={[
              { label: "Copy email address", onSelect: () => void inbox.copyAddress(email) },
              { label: `Show all with ${person.name.split(" ")[0]}`, onSelect: () => inbox.showAllFrom(email) },
            ]}
          />
        </div>
      </div>
      {showDetails && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-card px-4 py-3 text-[13.5px]">
          <dt className="text-muted">From</dt>
          <dd className="truncate">
            {email.from.name} &lt;{email.from.email}&gt;
          </dd>
          <dt className="text-muted">To</dt>
          <dd className="truncate">{email.to.map((c) => `${c.name} <${c.email}>`).join(", ")}</dd>
          <dt className="text-muted">Date</dt>
          <dd>{hydrated ? fullTime(email.receivedAt) : ""}</dd>
        </dl>
      )}
    </div>
  );
}
