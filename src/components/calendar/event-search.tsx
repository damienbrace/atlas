"use client";

import { Search } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { calendarFor } from "@/lib/calendar/calendars";
import { shortDate, timeLabel } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { CalendarState } from "./use-calendar";

const MAX_RESULTS = 8;

/** Finds events by title, place or notes and jumps to the day. */
export function EventSearch({ cal, className = "" }: { cal: CalendarState; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const showResults = open && cal.query.trim() !== "";
  const results = cal.results.slice(0, MAX_RESULTS);

  function pick(event: CalendarEvent) {
    cal.select(event.date);
    cal.setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent) {
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      cal.setQuery("");
      setOpen(false);
      inputRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (e.key === "ArrowUp" && index <= 0) return inputRef.current?.focus();
      options[Math.min(index + (e.key === "ArrowDown" ? 1 : -1), options.length - 1)]?.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      onBlur={(e) => !rootRef.current?.contains(e.relatedTarget) && setOpen(false)}
      className={`relative ${className}`}
    >
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" strokeWidth={1.75} />
      <input
        ref={inputRef}
        type="search"
        value={cal.query}
        onChange={(e) => {
          cal.setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search events"
        aria-label="Search events"
        aria-controls={showResults ? listId : undefined}
        className="h-12 w-full rounded-xl border border-line-strong bg-panel pr-4 pl-12 text-[15.5px] text-ink outline-none placeholder:text-muted focus:border-ink/40"
      />
      {showResults && (
        <ul
          ref={listRef}
          id={listId}
          aria-label="Matching events"
          className="absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-line-strong bg-raised p-1.5 shadow-2xl shadow-black/50"
        >
          {results.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => pick(event)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none hover:bg-white/5 focus-visible:bg-white/8"
              >
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${calendarFor(event.calendar).dot}`} />
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{event.title}</span>
                <span className="shrink-0 text-[13.5px] text-muted tabular-nums">
                  {shortDate(event.date)}
                  {event.start ? `, ${timeLabel(event.start)}` : ""}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-2.5 text-[14.5px] text-muted">No events match.</li>}
        </ul>
      )}
    </div>
  );
}
