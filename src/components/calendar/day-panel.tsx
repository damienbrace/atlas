"use client";

import { Check, Pencil, Plus, X } from "lucide-react";
import { Sparkle } from "@/components/sparkle";
import { calendarFor } from "@/lib/calendar/calendars";
import { durationLabel, longDate, timeLabel, toMinutes } from "@/lib/calendar/dates";
import type { Suggestion } from "@/lib/calendar/types";
import type { CalendarState } from "./use-calendar";

const outlineButton =
  "flex h-11 items-center gap-1.5 rounded-xl border border-line-strong px-3 text-[15px] text-ink transition-colors hover:border-faint hover:bg-white/[0.03] sm:px-3.5";

/** The selected day's agenda, with Atlas's suggestion underneath. */
export function DayPanel({ cal, className = "" }: { cal: CalendarState; className?: string }) {
  const events = cal.eventsOn(cal.date);

  return (
    <div className={`flex min-w-0 flex-col gap-3 md:flex-row md:items-start lg:gap-4 xl:min-h-0 xl:flex-col xl:items-stretch ${className}`}>
      <section
        aria-label="Selected day"
        className="min-w-0 rounded-2xl border border-line bg-panel px-4 pt-4 pb-2 md:flex-1 xl:min-h-0 xl:flex-none xl:overflow-y-auto scroll-thin"
      >
        <h2 className="px-1 pb-3 text-[22px] font-bold tracking-tight">{longDate(cal.date)}</h2>
        {events.length > 0 ? (
          <ul>
            {events.map((event) => (
              <li key={event.id} className="border-t border-line">
                <button
                  type="button"
                  onClick={() => cal.openEvent(event)}
                  className="grid w-full grid-cols-[5.25rem_0.75rem_minmax(0,1fr)] items-baseline gap-x-3 rounded-lg px-1 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className="text-[14.5px] whitespace-nowrap text-muted tabular-nums">
                    {event.start ? timeLabel(event.start) : "All day"}
                  </span>
                  <span aria-hidden="true" className={`size-2.5 translate-y-px rounded-full ${calendarFor(event.calendar).dot}`} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[16.5px] font-semibold text-ink">
                      <span className="truncate">{event.title}</span>
                      {event.fromAtlas && (
                        <span title="Suggested by Atlas">
                          <Sparkle className="size-3.5" />
                          <span className="sr-only">Suggested by Atlas</span>
                        </span>
                      )}
                    </span>
                    {event.location && <span className="mt-0.5 block truncate text-[14.5px] text-muted">{event.location}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t border-line px-1 py-6 text-[15px] text-muted">
            Nothing planned.
            <button
              type="button"
              onClick={() => cal.openNew({ date: cal.date })}
              className="mt-3 flex items-center gap-1.5 font-medium text-ink hover:underline"
            >
              <Plus className="size-4" /> Add an event
            </button>
          </div>
        )}
      </section>

      {cal.suggestion && <SuggestionCard cal={cal} suggestion={cal.suggestion} />}
    </div>
  );
}

function SuggestionCard({ cal, suggestion }: { cal: CalendarState; suggestion: Suggestion }) {
  const { event } = suggestion;
  const length = event.start && event.end ? durationLabel(toMinutes(event.end) - toMinutes(event.start)) : null;
  const day = event.date === cal.date ? "" : event.date === cal.today ? " today" : ` on ${longDate(event.date)}`;
  const question = length && event.start ? `Add ${length}${day} at ${timeLabel(event.start)}?` : `Add it${day}?`;

  return (
    <section
      aria-label="Atlas suggestion"
      className="min-w-0 rounded-2xl border border-l-[3px] border-line border-l-teal bg-panel p-4 shadow-[0_0_32px_-14px_rgba(45,212,191,0.5)] md:flex-1 sm:p-5 xl:flex-none"
    >
      <div className="flex gap-4">
        <Sparkle className="mt-0.5 size-8" glow />
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-tight">{suggestion.heading}</h2>
          <p className="mt-1 text-[15px] text-muted">{question}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => cal.approve(suggestion)}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-teal px-3.5 text-[15px] font-semibold text-canvas shadow-[0_0_24px_-8px_rgba(45,212,191,0.6)] transition-opacity hover:opacity-90"
        >
          <Check className="size-[18px]" strokeWidth={2.5} /> Approve
        </button>
        <button type="button" onClick={() => cal.editSuggestion(suggestion)} className={outlineButton}>
          <Pencil className="size-[17px]" strokeWidth={1.75} /> Edit
        </button>
        <button type="button" onClick={() => cal.dismiss(suggestion)} className={outlineButton}>
          <X className="size-[18px]" strokeWidth={1.75} /> Dismiss
        </button>
      </div>
    </section>
  );
}
