"use client";

import { calendarFor } from "@/lib/calendar/calendars";
import { dayOfMonth, isWeekend, longDate, monthWeeks, sameMonth, shortTime, timeLabel, WEEKDAYS } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { CalendarState } from "./use-calendar";

/** Up to this many events show in a day; past that, two plus "+N more". */
const MAX_CHIPS = 3;

export function eventTime(event: CalendarEvent) {
  return event.start && event.end ? `${timeLabel(event.start)} – ${timeLabel(event.end)}` : "All day";
}

export function EventChip({ event, onOpen, dim = false }: { event: CalendarEvent; onOpen: () => void; dim?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={`${event.title} · ${eventTime(event)}`}
      className={`flex h-[26px] w-full min-w-0 shrink-0 items-center gap-1 rounded-md border px-1.5 text-left text-[13px] font-medium transition-[filter] hover:brightness-125 ${
        calendarFor(event.calendar).chip
      } ${dim ? "opacity-55" : ""}`}
    >
      {event.start && <span className="shrink-0 text-[12px] font-normal tabular-nums opacity-80">{shortTime(event.start)}</span>}
      <span className="truncate">{event.title}</span>
    </button>
  );
}

export function MonthView({ cal }: { cal: CalendarState }) {
  const weeks = monthWeeks(cal.date);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div aria-hidden="true" className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((day, i) => (
          <div
            key={day}
            className={`py-3 text-center text-[14px] text-ink-soft sm:text-[15px] ${i < 6 ? "border-r border-line" : ""} ${i >= 5 ? "bg-white/[0.022]" : ""}`}
          >
            {day}
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto scroll-thin [--row-min:4.5rem] sm:[--row-min:7rem] xl:[--row-min:6.25rem]"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(var(--row-min), 1fr))` }}
      >
        {weeks.flat().map((key, i) => (
          <DayCell key={key} cal={cal} day={key} lastColumn={i % 7 === 6} lastRow={i >= (weeks.length - 1) * 7} />
        ))}
      </div>
    </div>
  );
}

interface DayCellProps {
  cal: CalendarState;
  day: string;
  lastColumn: boolean;
  lastRow: boolean;
}

function DayCell({ cal, day, lastColumn, lastRow }: DayCellProps) {
  const events = cal.eventsOn(day);
  const inMonth = sameMonth(day, cal.date);
  const isToday = day === cal.today;
  const selected = day === cal.date;
  const shown = events.length > MAX_CHIPS ? events.slice(0, MAX_CHIPS - 1) : events;
  const hidden = events.length - shown.length;
  const count = events.length ? `, ${events.length} event${events.length === 1 ? "" : "s"}` : "";

  return (
    // Clicking anywhere in the day selects it; the date button is the keyboard route.
    <div
      onClick={() => cal.select(day)}
      onDoubleClick={() => cal.openNew({ date: day })}
      className={`relative flex min-w-0 cursor-default flex-col gap-1 p-1.5 sm:p-2 ${lastColumn ? "" : "border-r"} ${
        lastRow ? "" : "border-b"
      } border-line ${isWeekend(day) ? "bg-white/[0.022]" : ""}`}
    >
      {(isToday || selected) && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-[3px] rounded-lg border-[1.5px] ${
            isToday ? "border-ink/90 shadow-[0_0_18px_-6px_rgba(232,234,240,0.35)]" : "border-muted/45"
          }`}
        />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          cal.select(day);
        }}
        aria-label={`${longDate(day)}${count}`}
        aria-pressed={selected}
        className={`relative self-start rounded-md px-1 text-[16px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-ink sm:text-[18px] ${
          inMonth ? "font-medium text-ink" : "text-muted"
        } ${isToday ? "font-semibold" : ""}`}
      >
        {dayOfMonth(day)}
      </button>

      <div className="relative hidden min-w-0 flex-col gap-[5px] sm:flex">
        {shown.map((event) => (
          <EventChip key={event.id} event={event} dim={!inMonth} onOpen={() => cal.openEvent(event)} />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cal.select(day);
            }}
            className="self-start rounded px-1.5 text-[13px] text-muted hover:text-ink"
          >
            +{hidden} more
          </button>
        )}
      </div>

      {/* Phones: coloured dots instead of chips. */}
      {events.length > 0 && (
        <div aria-hidden="true" className="relative flex flex-wrap gap-1 px-1 sm:hidden">
          {events.slice(0, 4).map((event) => (
            <span key={event.id} className={`size-1.5 rounded-full ${calendarFor(event.calendar).dot}`} />
          ))}
        </div>
      )}
    </div>
  );
}
