"use client";

import { Check, RotateCw, Search, SquarePen, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { IconButton } from "@/components/icon-button";
import { daysBetween, listTime, previewText } from "@/lib/format";
import { CATEGORIES } from "@/lib/inbox/categories";
import type { Email } from "@/lib/inbox/types";
import { useHydrated } from "@/lib/use-hydrated";
import { AccountBar } from "./account-bar";
import { counterpart, type InboxState } from "./use-inbox";

interface EmailListProps {
  inbox: InboxState;
  className: string;
  notice?: string;
}

export function EmailList({ inbox, className, notice }: EmailListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const hydrated = useHydrated();
  const now = hydrated ? new Date() : null;
  const searching = searchOpen || inbox.query !== "";

  function toggleSearch() {
    if (searching) {
      inbox.setQuery("");
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }

  return (
    <section
      aria-label="Email list"
      className={`${className} min-h-0 w-full min-w-0 flex-col rounded-2xl border border-line bg-panel md:w-[340px] md:shrink-0 lg:w-[380px] xl:w-auto xl:flex-1 xl:shrink`}
    >
      <header className="px-5 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="text-[34px] leading-none font-bold tracking-tight">Inbox</h1>
          <div className="flex gap-1">
            {inbox.live && (
              <IconButton label={refreshing ? "Checking for new mail" : "Check for new mail"} onClick={() => startRefresh(() => router.refresh())}>
                <RotateCw className={`size-[21px] ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.75} />
              </IconButton>
            )}
            <IconButton label={searching ? "Close search" : "Search"} onClick={toggleSearch}>
              {searching ? <X className="size-[22px]" /> : <Search className="size-[22px]" strokeWidth={1.75} />}
            </IconButton>
            <IconButton label={inbox.live ? "Compose in Gmail" : "Compose"} onClick={inbox.startCompose}>
              <SquarePen className="size-[22px]" strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>

        <AccountBar inbox={inbox} notice={notice} />

        {searching && (
          <input
            ref={searchRef}
            type="search"
            value={inbox.query}
            onChange={(e) => inbox.setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && toggleSearch()}
            placeholder="Search people, subjects, text"
            aria-label="Search email"
            className="mt-4 h-11 w-full rounded-xl border border-line-strong bg-card px-4 text-[15px] text-ink outline-none placeholder:text-faint focus:border-teal/60"
          />
        )}

        <div role="group" aria-label="Filter by category" className="mt-4 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const active = inbox.filter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => inbox.setFilter(active ? null : c.id)}
                className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors ${
                  active ? "border-teal/60 bg-teal/10 text-ink" : "border-line-strong text-ink-soft hover:border-faint"
                }`}
              >
                <span aria-hidden="true" className={`size-[7px] rounded-full ${c.dot}`} />
                {c.label}
                <span className="text-muted tabular-nums">{inbox.counts[c.id]}</span>
              </button>
            );
          })}
        </div>
      </header>

      <ul className="mt-3 min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 scroll-thin">
        {inbox.visible.map((email, i) => {
          const selected = inbox.selected?.id === email.id;
          const showDivider = i > 0 && !selected && inbox.visible[i - 1].id !== inbox.selected?.id;
          return (
            <li key={email.id}>
              <div aria-hidden="true" className={`mx-4 h-px ${showDivider ? "bg-line" : "bg-transparent"}`} />
              <EmailRow
                email={email}
                selected={selected}
                done={inbox.isDone(email)}
                now={now}
                onSelect={() => inbox.select(email.id)}
              />
            </li>
          );
        })}
        {inbox.visible.length === 0 && (inbox.data.source === "sample" || inbox.data.status === "ok") && (
          <li className="px-4 py-16 text-center text-[15px] text-muted">
            {inbox.searchPending
              ? "Searching…"
              : inbox.query
                ? "No emails match your search."
                : inbox.data.source === "gmail" && inbox.data.sync.downloading
                  ? "Fetching your mail from Gmail…"
                  : "Nothing here. Nice work."}
          </li>
        )}
        {inbox.hasOlder && (
          <li className="px-2 pt-3">
            <button
              type="button"
              onClick={() => void inbox.loadOlder()}
              disabled={inbox.loadingOlder}
              className="h-11 w-full rounded-xl border border-line-strong text-[14px] text-ink-soft transition-colors hover:border-faint hover:text-ink disabled:opacity-60"
            >
              {inbox.loadingOlder ? "Loading…" : "Show older emails"}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function StatusMark({ email, done }: { email: Email; done: boolean }) {
  if (done)
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-muted">
        <Check className="size-3.5" /> Replied
      </span>
    );
  if (email.category === "action")
    return (
      <span className="size-2 shrink-0 rounded-full bg-amber">
        <span className="sr-only">Needs action</span>
      </span>
    );
  if (email.unread)
    return (
      <span className="size-2 shrink-0 rounded-full bg-blue">
        <span className="sr-only">Unread</span>
      </span>
    );
  return null;
}

interface EmailRowProps {
  email: Email;
  selected: boolean;
  done: boolean;
  now: Date | null;
  onSelect: () => void;
}

function EmailRow({ email, selected, done, now, onSelect }: EmailRowProps) {
  const person = counterpart(email);
  const waitingDays = now ? daysBetween(new Date(email.receivedAt), now) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full gap-3.5 rounded-xl border px-3.5 py-4 text-left transition-colors ${
        selected
          ? "border-teal/80 bg-teal/[0.06] shadow-[0_0_28px_-12px_rgba(45,212,191,0.7)]"
          : "border-transparent hover:bg-white/[0.03]"
      }`}
    >
      <Avatar name={person.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`truncate text-[15.5px] ${email.unread ? "font-semibold text-ink" : "font-medium text-ink-soft"}`}>
            {email.direction === "out" ? `To: ${person.name}` : person.name}
          </span>
          <StatusMark email={email} done={done} />
          <span className="ml-auto shrink-0 pl-2 text-[13.5px] text-muted tabular-nums">
            {now ? listTime(email.receivedAt, now) : ""}
          </span>
        </div>
        <p className="mt-1 truncate text-[15px] font-medium text-ink">{email.headline}</p>
        <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-muted [overflow-wrap:anywhere]">
          {email.category === "waiting" && waitingDays !== null && (
            <span className="text-violet">
              {waitingDays === 0 ? "No reply yet. " : `No reply in ${waitingDays} day${waitingDays === 1 ? "" : "s"}. `}
            </span>
          )}
          {/* Atlas's one-line summary reads far better than raw mail; fall back to the body. */}
          {email.summary || previewText(email.preview ?? email.body ?? "")}
        </p>
      </div>
    </button>
  );
}
