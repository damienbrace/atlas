"use client";

import { Check, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import { Sparkle } from "@/components/sparkle";
import { CALENDARS } from "@/lib/calendar/calendars";
import { fromMinutes, toMinutes } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/calendar/types";

interface EventDialogProps {
  event: CalendarEvent;
  isNew: boolean;
  /** Adjusting an Atlas suggestion: saving it is the approval. */
  suggested: boolean;
  onSave: (event: CalendarEvent) => void;
  onDelete: () => void;
  onClose: () => void;
}

const input =
  "h-11 w-full rounded-xl border border-line-strong bg-card px-3.5 text-[15px] text-ink outline-none placeholder:text-faint focus:border-ink/40";

const LAST_MINUTE = 23 * 60 + 59;

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] text-muted">{label}</span>
      {children}
    </label>
  );
}

export function EventDialog({ event, isNew, suggested, onSave, onDelete, onClose }: EventDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({
    ...event,
    allDay: !event.start,
    start: event.start ?? "09:00",
    end: event.end ?? "10:00",
    location: event.location ?? "",
    notes: event.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    titleRef.current?.focus();
  }, []);

  function update(patch: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  }

  // Moving the start keeps the event's length, like most calendars.
  function setStart(start: string) {
    if (!start || !draft.start || !draft.end) return update({ start });
    const length = Math.max(toMinutes(draft.end) - toMinutes(draft.start), 15);
    update({ start, end: fromMinutes(Math.min(toMinutes(start) + length, LAST_MINUTE)) });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const title = draft.title.trim();
    if (!title) return setError("Give the event a title.");
    if (!draft.date) return setError("Pick a date.");
    if (!draft.allDay && (!draft.start || !draft.end || toMinutes(draft.end) <= toMinutes(draft.start))) {
      return setError("The end time needs to be after the start.");
    }
    const location = draft.location.trim();
    const notes = draft.notes.trim();
    onSave({
      id: draft.id,
      title,
      calendar: draft.calendar,
      date: draft.date,
      ...(draft.allDay ? {} : { start: draft.start, end: draft.end }),
      ...(location ? { location } : {}),
      ...(notes ? { notes } : {}),
      ...(draft.fromAtlas ? { fromAtlas: true } : {}),
    });
  }

  const close = () => dialogRef.current?.close();
  const heading = suggested ? "Atlas suggestion" : isNew ? "New event" : "Edit event";

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={heading}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line-strong bg-panel p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60 backdrop:backdrop-blur-[2px] scroll-thin"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-5 sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2.5 text-[20px] font-bold tracking-tight">
            {suggested && <Sparkle className="size-6" glow />}
            {heading}
          </h2>
          <IconButton label="Close" onClick={close}>
            <X className="size-5" />
          </IconButton>
        </header>

        <input
          ref={titleRef}
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Add a title"
          aria-label="Title"
          className={`${input} h-12 text-[17px] font-medium`}
        />

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
          <Field label="Date">
            <input type="date" required value={draft.date} onChange={(e) => update({ date: e.target.value })} className={input} />
          </Field>
          <label className="flex h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-line-strong px-3.5 text-[15px] has-focus-visible:outline-2 has-focus-visible:outline-ink">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(e) => update({ allDay: e.target.checked })}
              className="size-4 accent-ink outline-none"
            />
            All day
          </label>
        </div>

        {!draft.allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input type="time" step={300} value={draft.start} onChange={(e) => setStart(e.target.value)} className={input} />
            </Field>
            <Field label="Ends">
              <input type="time" step={300} value={draft.end} onChange={(e) => update({ end: e.target.value })} className={input} />
            </Field>
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] text-muted">Calendar</legend>
          <div className="flex flex-wrap gap-2">
            {CALENDARS.map((c) => (
              <label
                key={c.id}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line-strong px-3.5 text-[14.5px] text-ink-soft transition-colors hover:border-faint has-checked:border-ink/50 has-checked:bg-white/[0.06] has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-ink"
              >
                <input
                  type="radio"
                  name="calendar"
                  value={c.id}
                  checked={draft.calendar === c.id}
                  onChange={() => update({ calendar: c.id })}
                  className="sr-only"
                />
                <span aria-hidden="true" className={`size-2.5 rounded-full ${c.dot}`} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Location">
          <input value={draft.location} onChange={(e) => update({ location: e.target.value })} placeholder="Optional" className={input} />
        </Field>
        <Field label="Notes">
          <textarea
            value={draft.notes}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="Optional"
            rows={2}
            className={`${input} h-auto min-h-[4.5rem] resize-none py-2.5 leading-relaxed [field-sizing:content]`}
          />
        </Field>

        {error && (
          <p role="alert" className="text-[14px] text-red">
            {error}
          </p>
        )}

        <footer className="mt-1 flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
          {!isNew && (
            <button
              type="button"
              onClick={onDelete}
              className="flex h-11 items-center gap-2 rounded-xl px-3 text-[15px] text-red transition-colors hover:bg-red/10"
            >
              <Trash2 className="size-[18px]" strokeWidth={1.75} /> Delete
            </button>
          )}
          <button type="button" onClick={close} className="ml-auto h-11 rounded-xl px-4 text-[15px] text-ink-soft hover:text-ink">
            Cancel
          </button>
          {suggested ? (
            <button
              type="submit"
              className="flex h-11 items-center gap-2 rounded-xl bg-teal px-5 text-[15px] font-semibold text-canvas shadow-[0_0_24px_-8px_rgba(45,212,191,0.6)] hover:opacity-90"
            >
              <Check className="size-[18px]" strokeWidth={2.5} /> Approve
            </button>
          ) : (
            <button type="submit" className="h-11 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas hover:opacity-90">
              {isNew ? "Add event" : "Save"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
