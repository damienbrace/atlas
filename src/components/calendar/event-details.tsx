"use client";

import { CalendarDays, Clock, ExternalLink, MapPin } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { calendarFor } from "@/lib/calendar/calendars";
import { durationLabel, longDate, timeLabel, toMinutes } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/calendar/types";

/** A Google Calendar event, read-only in Atlas: details plus a link to edit it in Google Calendar. */
export function EventDetails({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  return (
    <Dialog open={event !== null} onClose={onClose} title={event?.title ?? "Event"}>
      {event && (
        <div>
          <h2 className="pr-2 text-[22px] leading-tight font-bold tracking-tight [overflow-wrap:anywhere]">{event.title}</h2>
          <dl className="mt-5 space-y-3 text-[15px]">
            <div className="flex gap-3">
              <dt className="sr-only">When</dt>
              <Clock aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-muted" />
              <dd>
                {longDate(event.date)}
                <span className="block text-muted">
                  {event.start && event.end
                    ? `${timeLabel(event.start)} – ${timeLabel(event.end)} · ${durationLabel(toMinutes(event.end) - toMinutes(event.start))}`
                    : "All day"}
                </span>
              </dd>
            </div>
            {event.location && (
              <div className="flex gap-3">
                <dt className="sr-only">Where</dt>
                <MapPin aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-muted" />
                <dd className="[overflow-wrap:anywhere]">{event.location}</dd>
              </div>
            )}
            <div className="flex gap-3">
              <dt className="sr-only">Calendar</dt>
              <CalendarDays aria-hidden="true" className="mt-0.5 size-[18px] shrink-0 text-muted" />
              <dd className="flex items-center gap-2">
                <span aria-hidden="true" className={`size-2.5 rounded-full ${calendarFor(event.calendar).dot}`} />
                {event.calendarName ?? calendarFor(event.calendar).label}
              </dd>
            </div>
          </dl>
          {event.notes && (
            <p className="mt-5 max-h-60 overflow-y-auto rounded-xl bg-card px-4 py-3 text-[14.5px] leading-relaxed whitespace-pre-line text-ink-soft scroll-thin [overflow-wrap:anywhere]">
              {event.notes}
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-[15px] text-muted hover:text-ink">
              Close
            </button>
            {event.link && (
              <a
                href={event.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-[15px] hover:border-faint"
              >
                <ExternalLink className="size-[18px]" /> Edit in Google Calendar
              </a>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
