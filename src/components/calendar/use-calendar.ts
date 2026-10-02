"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { calendarFor } from "@/lib/calendar/calendars";
import { addDays, addMonths, fromMinutes, timeLabel, toKey } from "@/lib/calendar/dates";
import { buildSampleCalendar } from "@/lib/calendar/sample-data";
import type { CalendarEvent, CalendarSource, Suggestion, View } from "@/lib/calendar/types";

type GoogleCalendarInfo = Extract<CalendarSource, { kind: "google" }>["calendars"][number];

/** Google Calendar's "new event" page, prefilled with the day and time. */
function googleNewEventUrl(day: string, start: string, end?: string) {
  const compact = (time: string) => `${day.replaceAll("-", "")}T${time.replace(":", "")}00`;
  const finish = end ?? fromMinutes(Math.min(Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 60, 23 * 60 + 59));
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${compact(start)}/${compact(finish)}`;
}

export interface EditorState {
  event: CalendarEvent;
  isNew: boolean;
  /** Set while I'm adjusting an Atlas suggestion before adding it. */
  suggestion?: Suggestion;
}

/** All-day events first, then by start time. */
export const byTime = (a: CalendarEvent, b: CalendarEvent) => (a.start ?? "").localeCompare(b.start ?? "");

// crypto.randomUUID needs a secure context, which a phone on the LAN doesn't get.
const newId = () => `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function matches(event: CalendarEvent, query: string) {
  const fields = [event.title, event.location, event.notes, event.calendarName ?? calendarFor(event.calendar).label];
  return fields.some((field) => field?.toLowerCase().includes(query));
}

/** The current time, refreshed every 30 seconds for the "now" line and the date rolling over. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Client-only: dates come from the viewer's clock, so this mounts after hydration. */
export function useCalendar() {
  const toast = useToast();
  const now = useNow();
  const today = toKey(now);

  const [sample] = useState(() => buildSampleCalendar(toKey(new Date())));
  const [events, setEvents] = useState(sample.events);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(sample.suggestion);
  const [view, setView] = useState<View>("month");
  /** The selected day. It also decides which month, week or day is on screen. */
  const [date, setDate] = useState(today);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [details, setDetails] = useState<CalendarEvent | null>(null);
  const [query, setQuery] = useState("");

  // Google Calendar, loaded a month either side of whatever's on screen. Falls back to the sample.
  const [source, setSource] = useState<CalendarSource>({ kind: "loading" });
  const [googleMonths, setGoogleMonths] = useState<Map<string, CalendarEvent[]>>(() => new Map());
  const requestedMonths = useRef(new Set<string>());
  const wantedMonths = [addMonths(date, -1), date, addMonths(date, 1)].map((d) => d.slice(0, 7)).join(",");

  useEffect(() => {
    if (source.kind === "sample") return;
    const missing = wantedMonths.split(",").filter((m) => !requestedMonths.current.has(m));
    if (missing.length === 0) return;
    missing.forEach((m) => requestedMonths.current.add(m));
    const from = `${missing[0]}-01`;
    const to = addMonths(`${missing.at(-1)}-01`, 1);
    fetch(`/api/calendar?from=${from}&to=${to}`)
      .then((res) => res.json())
      .then((res: { status: string; calendars?: GoogleCalendarInfo[]; events?: CalendarEvent[] }) => {
        if (res.status !== "ok") {
          setSource({ kind: "sample", reason: res.status as Extract<CalendarSource, { kind: "sample" }>["reason"] });
          return;
        }
        setSource({ kind: "google", calendars: res.calendars ?? [] });
        setGoogleMonths((prev) => {
          const next = new Map(prev);
          for (const m of missing) next.set(m, []);
          for (const e of res.events ?? []) next.set(e.date.slice(0, 7), [...(next.get(e.date.slice(0, 7)) ?? []), e]);
          return next;
        });
      })
      .catch(() => {
        missing.forEach((m) => requestedMonths.current.delete(m));
        setSource((s) => (s.kind === "loading" ? { kind: "sample", reason: "error" } : s));
      });
  }, [wantedMonths, source.kind]);

  const live = source.kind === "google";
  const shownEvents = useMemo(
    () => (source.kind === "google" ? [...googleMonths.values()].flat() : source.kind === "sample" ? events : []),
    [source.kind, googleMonths, events],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of [...shownEvents].sort(byTime)) map.set(event.date, [...(map.get(event.date) ?? []), event]);
    return map;
  }, [shownEvents]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shownEvents.filter((e) => matches(e, q)).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
  }, [shownEvents, query]);

  function step(direction: 1 | -1) {
    setDate((d) => {
      if (view === "month") return addMonths(d, direction);
      return addDays(d, view === "week" ? 7 * direction : direction);
    });
  }

  function showDay(key: string) {
    setDate(key);
    setView("day");
  }

  function openNew(at: Partial<CalendarEvent> = {}) {
    const day = at.date ?? date;
    // Today, start at the next whole hour; other days, 9 AM.
    const startHour = day === today ? Math.min(now.getHours() + 1, 23) : 9;
    if (live) {
      // Read-only access: new events are created in Google Calendar, then show up here.
      window.open(googleNewEventUrl(day, at.start ?? fromMinutes(startHour * 60), at.end), "_blank", "noopener");
      return;
    }
    setEditor({
      isNew: true,
      event: {
        id: newId(),
        title: "",
        calendar: "work",
        date: day,
        start: fromMinutes(startHour * 60),
        end: fromMinutes(Math.min(startHour * 60 + 60, 23 * 60 + 59)),
        ...at,
      },
    });
  }

  function save(event: CalendarEvent) {
    const fromSuggestion = editor?.suggestion;
    const isNew = editor?.isNew;
    setEvents((list) => [...list.filter((e) => e.id !== event.id), event]);
    setEditor(null);
    setDate(event.date);
    if (fromSuggestion) {
      setSuggestion(null);
      toast({ message: `Added ${event.title}`, onAction: () => undoAdd(event, fromSuggestion) });
    } else {
      toast({ message: isNew ? `Added ${event.title}` : "Event updated" });
    }
  }

  function remove(event: CalendarEvent) {
    setEvents((list) => list.filter((e) => e.id !== event.id));
    setEditor(null);
    toast({ message: "Event deleted", onAction: () => setEvents((list) => [...list, event]) });
  }

  function undoAdd(event: CalendarEvent, from: Suggestion) {
    setEvents((list) => list.filter((e) => e.id !== event.id));
    setSuggestion(from);
  }

  function approve(s: Suggestion) {
    const event: CalendarEvent = { ...s.event, id: newId(), fromAtlas: true };
    setEvents((list) => [...list, event]);
    setSuggestion(null);
    const when = event.start ? ` at ${timeLabel(event.start)}` : "";
    toast({ message: `Added to your calendar${when}`, onAction: () => undoAdd(event, s) });
  }

  function editSuggestion(s: Suggestion) {
    setEditor({ isNew: true, suggestion: s, event: { ...s.event, id: newId(), fromAtlas: true } });
  }

  function dismiss(s: Suggestion) {
    setSuggestion(null);
    toast({ message: "Suggestion dismissed", onAction: () => setSuggestion(s) });
  }

  return {
    source,
    live,
    now,
    today,
    date,
    select: setDate,
    view,
    setView,
    step,
    goToday: () => setDate(today),
    showDay,
    eventsOn: (key: string) => byDay.get(key) ?? [],
    query,
    setQuery,
    results,
    editor,
    closeEditor: () => setEditor(null),
    openNew,
    openEvent: (event: CalendarEvent) => (event.readOnly ? setDetails(event) : setEditor({ isNew: false, event })),
    details,
    closeDetails: () => setDetails(null),
    save,
    remove,
    // Atlas's sample suggestion only belongs with the sample calendar.
    suggestion: source.kind === "sample" ? suggestion : null,
    approve,
    editSuggestion,
    dismiss,
  };
}

export type CalendarState = ReturnType<typeof useCalendar>;
