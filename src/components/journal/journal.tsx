"use client";

import { ChevronLeft, ChevronRight, Flame, NotebookPen } from "lucide-react";
import { useMemo, useState } from "react";
import { saveJournalEntry } from "@/app/(app)/journal/actions";
import { IconButton } from "@/components/icon-button";
import { addDays, longDay, parseDay, shortDay, streak } from "@/lib/life/days";
import type { JournalEntry } from "@/lib/life/journal";
import { SAVE_LABEL, useAutosave } from "@/lib/use-autosave";

export const MOODS = [
  { value: 1, label: "Rough", dot: "bg-red", active: "border-red/60 bg-red/10 text-red" },
  { value: 2, label: "Meh", dot: "bg-amber", active: "border-amber/60 bg-amber/10 text-amber" },
  { value: 3, label: "Okay", dot: "bg-muted", active: "border-muted/60 bg-white/5 text-ink" },
  { value: 4, label: "Good", dot: "bg-blue", active: "border-blue/60 bg-blue/10 text-blue" },
  { value: 5, label: "Great", dot: "bg-green", active: "border-green/60 bg-green/10 text-green" },
];

// One gentle prompt per day, the same all day. Written prompts, no AI involved.
const PROMPTS = [
  "What went well today?",
  "What's taking up most of your head right now?",
  "What did you learn today, on site or off it?",
  "Who did you talk to today, and how did it go?",
  "What would make tomorrow a good day?",
  "What are you grateful for today?",
  "What drained you today, and what gave you energy?",
  "What's one thing you've been putting off, and why?",
  "How did your body feel today?",
  "What decision is on your mind?",
  "What made you laugh today?",
  "If today had a headline, what would it be?",
];

function promptFor(day: string) {
  const d = parseDay(day);
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000);
  return PROMPTS[dayOfYear % PROMPTS.length];
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

interface Page {
  body: string;
  mood: number | null;
}

export function Journal({ entries, today }: { entries: JournalEntry[]; today: string }) {
  const [pages, setPages] = useState(() => new Map<string, Page>(entries.map((e) => [e.day, { body: e.body, mood: e.mood }])));
  const [day, setDay] = useState(today);
  const [listOpenOnMobile, setListOpenOnMobile] = useState(false);
  const { state, queue } = useAutosave<Page>(async (key, page) => (await saveJournalEntry(key, page.body, page.mood)).ok);

  const page = pages.get(day) ?? { body: "", mood: null };
  const written = useMemo(
    () => new Set([...pages].filter(([, p]) => p.body.trim() !== "").map(([d]) => d)),
    [pages],
  );
  const currentStreak = streak(written, today);

  // Today first, then every day with writing, newest first, grouped by month.
  const days = [...new Set([today, ...[...pages.keys()].filter((d) => written.has(d) || pages.get(d)?.mood)])]
    .filter((d) => d <= today)
    .sort((a, b) => b.localeCompare(a));
  const groups = new Map<string, string[]>();
  for (const d of days) {
    const date = parseDay(d);
    const label = `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
    groups.set(label, [...(groups.get(label) ?? []), d]);
  }

  function update(patch: Partial<Page>) {
    const next = { ...page, ...patch };
    setPages((all) => new Map(all).set(day, next));
    queue(day, next);
  }

  function go(to: string) {
    setDay(to > today ? today : to);
    setListOpenOnMobile(false);
  }

  return (
    <div className="flex h-full min-h-0 gap-3 p-3 pb-[84px] md:pb-3">
      <aside
        aria-label="Journal entries"
        className={`${listOpenOnMobile ? "flex" : "hidden md:flex"} min-h-0 w-full min-w-0 flex-col rounded-2xl border border-line bg-panel md:w-[300px] md:shrink-0 lg:w-[340px]`}
      >
        <header className="px-5 pt-5 pb-3">
          <h1 className="text-[34px] leading-none font-bold tracking-tight">Journal</h1>
          <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted">
            <Flame className={`size-4 ${currentStreak > 0 ? "text-amber" : "text-faint"}`} />
            {currentStreak > 0 ? `${currentStreak}-day streak` : "No streak yet"} · {written.size}{" "}
            {written.size === 1 ? "entry" : "entries"}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 scroll-thin">
          {[...groups].map(([month, monthDays]) => (
            <section key={month} aria-label={month} className="mt-2">
              <h2 className="px-3 py-2 text-[12px] font-semibold tracking-wide text-faint uppercase">{month}</h2>
              <ul>
                {monthDays.map((d) => {
                  const p = pages.get(d);
                  const mood = MOODS.find((m) => m.value === p?.mood);
                  const selected = d === day;
                  return (
                    <li key={d}>
                      <button
                        type="button"
                        onClick={() => go(d)}
                        aria-current={selected ? "true" : undefined}
                        className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                          selected ? "border-teal/70 bg-teal/[0.06]" : "border-transparent hover:bg-white/[0.03]"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[14.5px] font-semibold">{d === today ? "Today" : shortDay(d)}</span>
                          {mood && <span aria-label={`Mood: ${mood.label}`} className={`size-2 rounded-full ${mood.dot}`} />}
                          {p?.body.trim() && (
                            <span className="ml-auto text-[12.5px] text-faint tabular-nums">{words(p.body)} words</span>
                          )}
                        </span>
                        <span className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-muted">
                          {p?.body.trim() || "Not written yet"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>

      <section
        aria-label="Journal page"
        className={`${listOpenOnMobile ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-line bg-panel scroll-thin`}
      >
        <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-2 rounded-t-2xl bg-panel px-4">
          <div className="flex items-center gap-1">
            <IconButton label="All entries" className="md:hidden" onClick={() => setListOpenOnMobile(true)}>
              <NotebookPen className="size-[21px]" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Previous day" onClick={() => go(addDays(day, -1))}>
              <ChevronLeft className="size-[22px]" strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Next day" disabled={day >= today} onClick={() => go(addDays(day, 1))}>
              <ChevronRight className="size-[22px]" strokeWidth={1.75} />
            </IconButton>
            {day !== today && (
              <button
                type="button"
                onClick={() => go(today)}
                className="ml-1 rounded-lg border border-line-strong px-3 py-1.5 text-[13.5px] text-ink-soft hover:border-faint hover:text-ink"
              >
                Today
              </button>
            )}
          </div>
          <p role="status" className={`text-[13px] ${state === "error" ? "text-amber" : "text-muted"}`}>
            {SAVE_LABEL[state]}
          </p>
        </div>

        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-6 pt-4 pb-10 md:px-10">
          <h2 className="text-[30px] leading-tight font-bold tracking-tight">{longDay(day)}</h2>
          <p className="mt-2 text-[15.5px] text-muted italic">{promptFor(day)}</p>

          <div role="group" aria-label="Mood" className="mt-5 flex flex-wrap gap-2">
            {MOODS.map((m) => {
              const active = page.mood === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ mood: active ? null : m.value })}
                  className={`flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13.5px] transition-colors ${
                    active ? m.active : "border-line-strong text-ink-soft hover:border-faint"
                  }`}
                >
                  <span aria-hidden="true" className={`size-2 rounded-full ${m.dot}`} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <textarea
            // Keyed per day so the cursor and scroll start fresh on each page.
            key={day}
            value={page.body}
            onChange={(e) => update({ body: e.target.value })}
            autoFocus={day === today}
            aria-label={`Journal for ${longDay(day)}`}
            placeholder="Start writing…"
            className="mt-6 min-h-[50vh] w-full flex-1 resize-none bg-transparent text-[18px] leading-[1.8] text-ink outline-none placeholder:text-faint [field-sizing:content]"
          />
          <p className="mt-4 text-[13px] text-faint tabular-nums">{words(page.body)} words</p>
        </div>
      </section>
    </div>
  );
}
