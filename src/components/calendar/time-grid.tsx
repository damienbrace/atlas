"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { Sparkle } from "@/components/sparkle";
import { calendarFor } from "@/lib/calendar/calendars";
import { dayOfMonth, fromMinutes, hourLabel, isWeekend, longDate, timeLabel, toMinutes, weekdayLongName, weekdayName } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/calendar/types";
import { EventChip } from "./month-view";
import type { CalendarState } from "./use-calendar";

const HOUR_PX = 56;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** Opens scrolled to here, so the working day is in view. */
const FIRST_VISIBLE_HOUR = 6;

interface Placed {
  event: CalendarEvent;
  from: number;
  to: number;
  column: number;
  columns: number;
}

/** Side-by-side columns for events that overlap, Google Calendar style. */
function layoutDay(events: CalendarEvent[]): Placed[] {
  const timed = events
    .filter((e) => e.start && e.end)
    .map((event) => {
      const from = toMinutes(event.start!);
      return { event, from, to: Math.max(toMinutes(event.end!), from + 20) };
    })
    .sort((a, b) => a.from - b.from || b.to - a.to);

  const placed: Placed[] = [];
  let group: Omit<Placed, "columns">[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;

  const closeGroup = () => {
    for (const item of group) placed.push({ ...item, columns: columnEnds.length });
    group = [];
    columnEnds = [];
  };

  for (const item of timed) {
    if (item.from >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((end) => end <= item.from);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = item.to;
    group.push({ ...item, column });
    groupEnd = Math.max(groupEnd, item.to);
  }
  closeGroup();
  return placed;
}

/** Week and Day views: an all-day row above a scrolling 24-hour grid. */
export function TimeGrid({ cal, days }: { cal: CalendarState; days: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const single = days.length === 1;
  const columns = { gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))` };
  const hasAllDay = days.some((day) => cal.eventsOn(day).some((e) => !e.start));
  const nowMinutes = cal.now.getHours() * 60 + cal.now.getMinutes();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_PX - 12;
  }, []);

  function newEventAt(day: string, e: MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const half = Math.floor((e.nativeEvent.offsetY / HOUR_PX) * 2) * 30;
    cal.openNew({ date: day, start: fromMinutes(half), end: fromMinutes(Math.min(half + 60, 23 * 60 + 59)) });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col [--gutter:2.75rem] sm:[--gutter:3.5rem]">
      {/* Headings and the all-day row reserve the scrollbar's width so columns line up. */}
      <div className="grid overflow-hidden border-b border-line [scrollbar-gutter:stable]" style={columns}>
        <div />
        {days.map((day) => {
          const isToday = day === cal.today;
          return (
            <button
              key={day}
              type="button"
              onClick={() => (single ? cal.select(day) : cal.showDay(day))}
              aria-label={single ? longDate(day) : `Show ${longDate(day)}`}
              className={`flex min-w-0 flex-col items-center justify-center gap-0.5 border-l border-line py-2 text-ink-soft hover:text-ink sm:flex-row sm:gap-2 sm:py-2.5 ${
                isWeekend(day) ? "bg-white/[0.022]" : ""
              }`}
            >
              <span className="text-[12.5px] sm:text-[15px]">{single ? weekdayLongName(day) : weekdayName(day)}</span>
              <span
                className={`grid size-8 place-items-center rounded-full text-[16px] font-semibold tabular-nums sm:text-[18px] ${
                  isToday ? "text-ink ring-[1.5px] ring-ink/90" : day === cal.date && !single ? "bg-white/[0.07] text-ink" : ""
                }`}
              >
                {dayOfMonth(day)}
              </span>
            </button>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="grid overflow-hidden border-b border-line [scrollbar-gutter:stable]" style={columns}>
          <div className="self-center pr-2 text-right text-[11.5px] text-faint">All day</div>
          {days.map((day) => (
            <div key={day} className={`flex min-w-0 flex-col gap-1 border-l border-line p-1 ${isWeekend(day) ? "bg-white/[0.022]" : ""}`}>
              {cal
                .eventsOn(day)
                .filter((e) => !e.start)
                .map((event) => (
                  <EventChip key={event.id} event={event} onOpen={() => cal.openEvent(event)} />
                ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin [scrollbar-gutter:stable]">
        <div className="grid" style={{ ...columns, height: 24 * HOUR_PX }}>
          <div aria-hidden="true" className="relative">
            {HOURS.slice(1).map((h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11.5px] whitespace-nowrap text-faint tabular-nums"
                style={{ top: h * HOUR_PX }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={day}
              onClick={(e) => newEventAt(day, e)}
              className={`relative border-l border-line ${isWeekend(day) ? "bg-white/[0.022]" : ""}`}
              style={{
                backgroundImage: "linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
                backgroundSize: `100% ${HOUR_PX}px`,
              }}
            >
              {layoutDay(cal.eventsOn(day)).map((p) => (
                <TimedEvent key={p.event.id} placed={p} onOpen={() => cal.openEvent(p.event)} />
              ))}
              {day === cal.today && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10" style={{ top: (nowMinutes / 60) * HOUR_PX }}>
                  <span className="absolute -top-[4.5px] -left-[5px] size-2.5 rounded-full bg-ink" />
                  <span className="block h-[1.5px] bg-ink/90" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimedEvent({ placed, onOpen }: { placed: Placed; onOpen: () => void }) {
  const { event, from, to, column, columns } = placed;
  const height = ((to - from) / 60) * HOUR_PX - 2;
  const width = 100 / columns;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${event.title} · ${timeLabel(event.start!)} – ${timeLabel(event.end!)}`}
      className={`@container absolute flex flex-col overflow-hidden rounded-md border px-2 py-1 text-left text-[12.5px] leading-snug transition-[filter] hover:z-20 hover:brightness-125 ${
        calendarFor(event.calendar).chip
      }`}
      style={{
        top: (from / 60) * HOUR_PX + 1,
        height,
        left: `calc(${column * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
    >
      <span className="flex min-w-0 items-center gap-1 font-semibold">
        <span className="truncate">{event.title}</span>
        {event.fromAtlas && <Sparkle className="size-3" />}
        {/* Short events have room for one line, so the time sits beside the title. */}
        {height < 36 && <span className="hidden shrink-0 font-normal opacity-80 @min-[8rem]:inline">{timeLabel(event.start!)}</span>}
      </span>
      {height >= 36 && (
        <span className="truncate opacity-80">
          {timeLabel(event.start!)} – {timeLabel(event.end!)}
        </span>
      )}
      {height >= 56 && event.location && <span className="truncate opacity-70">{event.location}</span>}
    </button>
  );
}
