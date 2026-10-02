"use client";

import { Check, Flag, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { markTask } from "@/app/(app)/tasks/actions";
import { Sparkle } from "@/components/sparkle";
import { AreaChip } from "@/components/tasks/task-parts";
import { useToast } from "@/components/toast";
import { calendarFor } from "@/lib/calendar/calendars";
import { dayOfMonth, timeLabel, weekdayLongName } from "@/lib/calendar/dates";
import type { Task } from "@/lib/life/tasks";
import type { CalendarState } from "./use-calendar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayHeading = (day: string) => `${weekdayLongName(day)} ${dayOfMonth(day)} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/**
 * The week on a phone: a day-by-day list in readable type, each day's events and then
 * its tasks. Days already gone are faded; it opens at today.
 */
export function WeekList({ cal, days, tasks: initialTasks }: { cal: CalendarState; days: string[]; tasks: Task[] }) {
  const toast = useToast();
  const [tasks, setTasks] = useState(initialTasks);
  const todayRef = useRef<HTMLElement>(null);
  const weekStart = days[0];

  // Open at today when it's in this week (the page itself scrolls on a phone). Only when
  // the week changes, not on every re-render.
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: "start" });
  }, [weekStart]);

  async function toggle(task: Task) {
    const flip = (done: boolean) => setTasks((all) => all.map((t) => (t.id === task.id ? { ...t, done } : t)));
    flip(!task.done);
    const res = await markTask(task.id, !task.done).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      flip(task.done);
      return toast({ message: "Couldn't update that task" });
    }
    const { next, removedId } = res;
    setTasks((all) => [...all.filter((t) => t.id !== removedId), ...(next ? [next] : [])]);
  }

  return (
    <div className="flex flex-col px-4 pb-3">
      {days.map((day) => {
        const events = cal.eventsOn(day);
        const dayTasks = tasks.filter((t) => t.dueDay === day);
        const isToday = day === cal.today;
        const past = day < cal.today;
        return (
          <section
            key={day}
            ref={isToday ? todayRef : undefined}
            aria-label={dayHeading(day)}
            className={`scroll-mt-3 border-b border-line py-3 last:border-b-0 ${past ? "opacity-55" : ""}`}
          >
            <h3 className="flex items-center gap-2 px-1 pb-1">
              <span className={`text-[17px] font-bold tracking-tight ${isToday ? "text-ink" : "text-ink-soft"}`}>{dayHeading(day)}</span>
              {isToday && <span className="rounded-full border border-ink/80 px-2 py-px text-[12px] font-semibold">Today</span>}
            </h3>

            {events.length === 0 && dayTasks.length === 0 ? (
              <button
                type="button"
                onClick={() => cal.openNew({ date: day })}
                className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left text-[15px] text-muted hover:text-ink"
              >
                Nothing on
                <Plus aria-label="Add an event" className="size-4" />
              </button>
            ) : (
              <ul>
                {events.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => cal.openEvent(event)}
                      className="grid w-full grid-cols-[4.75rem_0.6rem_minmax(0,1fr)] items-baseline gap-x-2.5 rounded-lg px-1 py-2.5 text-left hover:bg-white/[0.03]"
                    >
                      <span className="text-[14px] whitespace-nowrap text-muted tabular-nums">{event.start ? timeLabel(event.start) : "All day"}</span>
                      <span aria-hidden="true" className={`size-2.5 translate-y-px rounded-full ${calendarFor(event.calendar).dot}`} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[16px] font-semibold text-ink">
                          <span className="truncate">{event.title}</span>
                          {event.fromAtlas && <Sparkle className="size-3.5" />}
                        </span>
                        {event.location && <span className="mt-0.5 block truncate text-[14px] text-muted">{event.location}</span>}
                      </span>
                    </button>
                  </li>
                ))}
                {dayTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      aria-pressed={task.done}
                      onClick={() => void toggle(task)}
                      className="grid w-full grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-2.5 rounded-lg px-1 py-2 text-left hover:bg-white/[0.03]"
                    >
                      <span className="flex items-center gap-2 text-[14px] text-muted">
                        <span className={`grid size-[18px] place-items-center rounded-md border ${task.done ? "border-green bg-green" : "border-line-strong"}`}>
                          {task.done && <Check className="size-3 text-canvas" strokeWidth={3} />}
                        </span>
                        Task
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`truncate text-[15.5px] ${task.done ? "text-muted line-through decoration-faint" : "text-ink"}`}>
                          {task.priority && !task.done && <Flag aria-label="Flagged" className="mr-1 inline size-3.5 -translate-y-px fill-current text-ink-soft" />}
                          {task.title}
                        </span>
                        {task.area && !task.done && <AreaChip area={task.area} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
