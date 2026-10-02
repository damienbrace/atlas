"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { calendarFor } from "@/lib/calendar/calendars";
import { rangeLabel, weekOf } from "@/lib/calendar/dates";
import type { CalendarSource, View } from "@/lib/calendar/types";
import type { Task } from "@/lib/life/tasks";
import { useHydrated } from "@/lib/use-hydrated";
import { DayPanel } from "./day-panel";
import { EventDetails } from "./event-details";
import { EventDialog } from "./event-dialog";
import { EventSearch } from "./event-search";
import { MonthView } from "./month-view";
import { TimeGrid } from "./time-grid";
import { useCalendar, type CalendarState } from "./use-calendar";
import { WeekList } from "./week-list";

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const toolButton =
  "flex h-11 items-center rounded-xl border border-line-strong px-4 text-[15.5px] font-medium text-ink transition-colors hover:border-faint hover:bg-white/[0.03] sm:h-12 sm:px-5";

/**
 * Month grid with the selected day's agenda and Atlas's suggestion beside it.
 * Below 1280px the agenda drops under the grid and the page scrolls.
 */
export function Calendar({ tasks }: { tasks: Task[] }) {
  // Everything here depends on the viewer's clock and time zone, so it renders after hydration.
  const hydrated = useHydrated();
  return hydrated ? <CalendarScreen tasks={tasks} /> : <CalendarSkeleton />;
}

function CalendarScreen({ tasks }: { tasks: Task[] }) {
  const cal = useCalendar();
  const { editor } = cal;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 pb-[84px] scroll-thin md:pb-3 lg:gap-4 lg:p-5 xl:overflow-hidden">
      <Header cal={cal} />
      <Toolbar cal={cal} />

      <div className="flex flex-col gap-3 lg:gap-4 xl:min-h-0 xl:flex-1 xl:flex-row">
        <section
          aria-label={rangeLabel(cal.view, cal.date)}
          className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel xl:min-h-0 xl:flex-1 ${
            cal.view === "month" ? "" : cal.view === "week" ? "md:h-[72dvh] md:min-h-[28rem] xl:h-auto" : "h-[72dvh] min-h-[28rem] xl:h-auto"
          }`}
        >
          {cal.view === "month" && <MonthView cal={cal} />}
          {cal.view === "week" && (
            <>
              {/* Seven columns don't fit a phone: there the week is a readable list instead. */}
              <div className="md:hidden">
                <WeekList cal={cal} days={weekOf(cal.date)} tasks={tasks} />
              </div>
              <div className="hidden md:contents">
                <TimeGrid key="week" cal={cal} days={weekOf(cal.date)} />
              </div>
            </>
          )}
          {cal.view === "day" && <TimeGrid key="day" cal={cal} days={[cal.date]} />}
        </section>
        {/* On a phone the week list already shows every day, so the day panel would repeat it. */}
        <DayPanel cal={cal} className={`xl:w-[22rem] xl:shrink-0 2xl:w-[24rem] ${cal.view === "week" ? "max-md:hidden" : ""}`} />
      </div>

      {editor && (
        <EventDialog
          key={editor.event.id}
          event={editor.event}
          isNew={editor.isNew}
          suggested={editor.suggestion !== undefined}
          onSave={cal.save}
          onDelete={() => cal.remove(editor.event)}
          onClose={cal.closeEditor}
        />
      )}
      <EventDetails event={cal.details} onClose={cal.closeDetails} />
    </div>
  );
}

const SAMPLE_REASON: Record<Extract<CalendarSource, { kind: "sample" }>["reason"], string> = {
  "not-connected": "Showing sample events until Google is connected",
  "needs-permission": "Atlas needs permission to read your calendar",
  "api-disabled": "Turn on the Google Calendar API in your Google Cloud project, then reload",
  expired: "Your Google connection has expired",
  error: "Couldn't reach Google Calendar. Showing sample events",
};

/** Where events come from: Google (with a colour key) or the sample, with what to do about it. */
function SourceStatus({ cal }: { cal: CalendarState }) {
  const { source } = cal;
  if (source.kind === "loading") {
    return <p className="ml-auto text-[14.5px] text-muted md:ml-0">Connecting to Google Calendar…</p>;
  }
  if (source.kind === "google") {
    return (
      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-ink-soft md:ml-0">
        {source.calendars.slice(0, 4).map((c) => (
          <span key={c.id} className="flex max-w-48 items-center gap-2">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${calendarFor(c.slot).dot}`} />
            <span className="truncate">{c.name}</span>
          </span>
        ))}
        <span className="rounded-full border border-line-strong px-2 py-px text-[11.5px] text-muted">Read-only</span>
      </div>
    );
  }
  const canConnect = source.reason === "needs-permission" || source.reason === "expired";
  return (
    <p title={SAMPLE_REASON[source.reason]} className="ml-auto flex items-center gap-2 text-[14.5px] text-ink-soft md:ml-0">
      <span aria-hidden="true" className="size-2 rounded-full bg-faint" />
      Sample calendar
      {canConnect && (
        // A plain <a>: this route redirects to Google's consent screen and must not be prefetched.
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/api/auth/google" className="font-semibold text-teal hover:underline">
          Connect Google Calendar
        </a>
      )}
      {source.reason === "api-disabled" && <span className="text-amber">· Calendar API is off</span>}
    </p>
  );
}

function Header({ cal }: { cal: CalendarState }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-1">
      <h1 className="text-[34px] leading-none font-bold tracking-tight">Calendar</h1>
      <EventSearch cal={cal} className="order-last w-full md:order-none md:mx-auto md:w-auto md:max-w-[34rem] md:flex-1" />
      <SourceStatus cal={cal} />
    </header>
  );
}

function Toolbar({ cal }: { cal: CalendarState }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-3 lg:p-4">
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:gap-3">
        <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-line-strong sm:h-12 sm:flex-none">
          <button
            type="button"
            aria-label={`Previous ${cal.view}`}
            title={`Previous ${cal.view}`}
            onClick={() => cal.step(-1)}
            className="grid h-full w-11 shrink-0 place-items-center rounded-l-xl border-r border-line-strong text-ink-soft hover:bg-white/[0.04] hover:text-ink"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h2 aria-live="polite" className="min-w-0 flex-1 truncate px-2 text-center text-[16px] font-semibold tabular-nums sm:w-[15.5rem] sm:flex-none sm:px-3 sm:text-[20px]">
            <span className="sm:hidden">{rangeLabel(cal.view, cal.date, true)}</span>
            <span className="hidden sm:inline">{rangeLabel(cal.view, cal.date)}</span>
          </h2>
          <button
            type="button"
            aria-label={`Next ${cal.view}`}
            title={`Next ${cal.view}`}
            onClick={() => cal.step(1)}
            className="grid h-full w-11 shrink-0 place-items-center rounded-r-xl border-l border-line-strong text-ink-soft hover:bg-white/[0.04] hover:text-ink"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
        <button type="button" onClick={cal.goToday} className={toolButton}>
          Today
        </button>
      </div>

      <div role="group" aria-label="View" className="flex h-11 overflow-hidden rounded-xl border border-line-strong sm:h-12">
        {VIEWS.map((v, i) => {
          const active = cal.view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={active}
              onClick={() => cal.setView(v.id)}
              className={`px-4 text-[15.5px] transition-colors sm:px-6 ${i > 0 ? "border-l border-line-strong" : ""} ${
                active ? "bg-raised font-semibold text-ink" : "text-muted hover:bg-white/[0.03] hover:text-ink"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      <button type="button" onClick={() => cal.openNew()} aria-label="New event" title="New event" className={`${toolButton} gap-2.5`}>
        <Plus className="size-5" strokeWidth={1.75} />
        <span className="hidden sm:inline">New event</span>
      </button>
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full min-h-0 flex-col gap-3 p-3 pb-[84px] md:pb-3 lg:gap-4 lg:p-5">
      <h1 className="px-1 text-[34px] leading-none font-bold tracking-tight">Calendar</h1>
      <div className="mt-[2px] h-[74px] rounded-2xl border border-line bg-panel lg:h-[82px]" />
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex-1 rounded-2xl border border-line bg-panel" />
        <div className="hidden w-[22rem] rounded-2xl border border-line bg-panel xl:block 2xl:w-[24rem]" />
      </div>
    </div>
  );
}
