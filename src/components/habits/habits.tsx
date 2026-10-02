"use client";

import { Check, ChevronLeft, ChevronRight, Ellipsis, Flame, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { markHabit, removeHabit, saveHabit } from "@/app/(app)/habits/actions";
import { Dialog } from "@/components/dialog";
import { IconButton, iconButtonClass } from "@/components/icon-button";
import { Menu } from "@/components/menu";
import { useToast } from "@/components/toast";
import { DAYS } from "@/lib/format";
import { addDays, dayKey, parseDay, shortDay, streak } from "@/lib/life/days";
import type { Habit, HabitsData } from "@/lib/life/habits";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Monday-first, as people say them.
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SUGGESTIONS = ["Workout", "Stretch", "Read 20 minutes", "Journal", "No alcohol", "Trading review"];

function scheduleLabel(days: number[]) {
  if (days.length === 7) return "Every day";
  if (days.join("") === "12345") return "Weekdays";
  return WEEK.filter((d) => days.includes(d))
    .map((d) => DAYS[d])
    .join(", ");
}

/** Due on its weekdays, from the day it was added. Ticks on other days still count. */
const isDue = (habit: Habit, day: string) => day >= habit.since && habit.days.includes(parseDay(day).getDay());

interface HabitsProps {
  data: HabitsData;
  today: string;
  colors: string[];
}

export function Habits({ data, today, colors }: HabitsProps) {
  const toast = useToast();
  const [habits, setHabits] = useState(data.habits);
  const [done, setDone] = useState(() => new Map(Object.entries(data.done).map(([id, days]) => [id, new Set(days)])));
  const [editing, setEditing] = useState<Habit | "new" | null>(null);

  const doneOn = (habit: Habit, day: string) => done.get(habit.id)?.has(day) ?? false;
  const dueToday = habits.filter((h) => isDue(h, today));
  const doneToday = dueToday.filter((h) => doneOn(h, today)).length;

  function setTick(habitId: string, day: string, value: boolean) {
    setDone((all) => {
      const next = new Map(all);
      const days = new Set(next.get(habitId) ?? []);
      if (value) days.add(day);
      else days.delete(day);
      next.set(habitId, days);
      return next;
    });
  }

  async function toggle(habit: Habit, day: string) {
    const value = !doneOn(habit, day);
    setTick(habit.id, day, value);
    const res = await markHabit(habit.id, day, value).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      setTick(habit.id, day, !value);
      toast({ message: "Couldn't save that tick. Try again." });
    }
  }

  async function save(input: { id?: string; name: string; color: string; days: number[] }) {
    const res = await saveHabit(input).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      toast({ message: "Couldn't save that habit" });
      return false;
    }
    const since = habits.find((h) => h.id === input.id)?.since ?? ("since" in res && res.since ? res.since : today);
    const habit: Habit = { id: res.id, name: input.name.trim(), color: input.color, days: [...input.days].sort(), since };
    setHabits((all) => (input.id ? all.map((h) => (h.id === input.id ? habit : h)) : [...all, habit]));
    if (!input.id) setDone((all) => new Map(all).set(habit.id, new Set()));
    return true;
  }

  async function archive(habit: Habit) {
    const res = await removeHabit(habit.id).catch(() => ({ ok: false as const }));
    if (!res.ok) return toast({ message: "Couldn't remove that habit" });
    setHabits((all) => all.filter((h) => h.id !== habit.id));
    toast({ message: `Removed "${habit.name}". Its history is kept.` });
  }

  function quickAdd(name: string) {
    void save({ name, color: colors[habits.length % colors.length], days: [0, 1, 2, 3, 4, 5, 6] });
  }

  return (
    <div className="h-full overflow-y-auto p-3 pb-[84px] scroll-thin md:pb-3">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3">
        <section aria-label="Today" className="rounded-2xl border border-line bg-panel p-5 md:p-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[34px] leading-none font-bold tracking-tight">Habits</h1>
              <p className="mt-3 text-[14px] text-muted">
                {dueToday.length === 0
                  ? "Nothing due today."
                  : doneToday === dueToday.length
                    ? `All ${dueToday.length} done today. Nice work.`
                    : `${doneToday} of ${dueToday.length} done today`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="flex h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[14.5px] text-ink hover:border-faint"
            >
              <Plus className="size-[18px]" /> Add habit
            </button>
          </header>

          {habits.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-line-strong p-6 text-center">
              <p className="font-semibold">No habits yet</p>
              <p className="mt-1 text-[14px] text-muted">Pick a few to start, or add your own.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => quickAdd(name)}
                    className="flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13.5px] text-ink-soft hover:border-faint hover:text-ink"
                  >
                    <Plus className="size-3.5" /> {name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="mt-5 grid gap-2.5 lg:grid-cols-2">
              {habits.map((h) => (
                <HabitRow
                  key={h.id}
                  habit={h}
                  today={today}
                  doneOn={(day) => doneOn(h, day)}
                  streakDays={streak(done.get(h.id) ?? new Set(), today, (day) => isDue(h, day))}
                  onToggle={() => void toggle(h, today)}
                  onEdit={() => setEditing(h)}
                  onArchive={() => void archive(h)}
                />
              ))}
            </ul>
          )}
        </section>

        {habits.length > 0 && <MonthGrid habits={habits} today={today} doneOn={doneOn} onToggle={(h, d) => void toggle(h, d)} />}
      </div>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add habit" : "Edit habit"}>
        {editing !== null && (
          <HabitForm
            habit={editing === "new" ? null : editing}
            colors={colors}
            defaultColor={colors[habits.length % colors.length]}
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              if (await save(input)) setEditing(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

interface HabitRowProps {
  habit: Habit;
  today: string;
  doneOn: (day: string) => boolean;
  streakDays: number;
  onToggle: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

function HabitRow({ habit, today, doneOn, streakDays, onToggle, onEdit, onArchive }: HabitRowProps) {
  const ticked = doneOn(today);
  const due = isDue(habit, today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  return (
    <li className={`flex items-center gap-4 rounded-xl border border-line bg-card px-4 py-3.5 ${!due && !ticked ? "opacity-60" : ""}`}>
      <button
        type="button"
        aria-pressed={ticked}
        aria-label={`${habit.name}: ${ticked ? "done today" : "not done today"}`}
        onClick={onToggle}
        className="grid size-11 shrink-0 place-items-center rounded-full border-2 transition-colors"
        style={ticked ? { backgroundColor: habit.color, borderColor: habit.color } : { borderColor: `${habit.color}99` }}
      >
        {ticked && <Check className="size-5 text-canvas" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-semibold">{habit.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
          <Flame className={`size-3.5 ${streakDays > 0 ? "text-amber" : "text-faint"}`} />
          {streakDays > 0 ? `${streakDays}-day streak` : "No streak yet"}
          <span className="text-faint">·</span>
          {due ? scheduleLabel(habit.days) : "Not due today"}
        </p>
      </div>
      <div aria-label="Last 7 days" className="hidden gap-1 sm:flex">
        {week.map((day) => (
          <span
            key={day}
            title={`${shortDay(day)}: ${doneOn(day) ? "done" : isDue(habit, day) ? "missed" : "not due"}`}
            className="size-2.5 rounded-full border"
            style={
              doneOn(day)
                ? { backgroundColor: habit.color, borderColor: habit.color }
                : { borderColor: isDue(habit, day) ? "#3a4150" : "transparent", backgroundColor: isDue(habit, day) ? "transparent" : "#232831" }
            }
          />
        ))}
      </div>
      <Menu
        label={`Options for ${habit.name}`}
        trigger={<Ellipsis className="size-5" strokeWidth={1.75} />}
        triggerClassName={iconButtonClass}
        items={[
          { label: "Edit", onSelect: onEdit },
          { label: "Remove", onSelect: onArchive, danger: true },
        ]}
      />
    </li>
  );
}

interface MonthGridProps {
  habits: Habit[];
  today: string;
  doneOn: (habit: Habit, day: string) => boolean;
  onToggle: (habit: Habit, day: string) => void;
}

function MonthGrid({ habits, today, doneOn, onToggle }: MonthGridProps) {
  const [month, setMonth] = useState(() => {
    const d = parseDay(today);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const days = Array.from({ length: new Date(year, monthIndex + 1, 0).getDate() }, (_, i) => dayKey(new Date(year, monthIndex, i + 1)));
  const isCurrentMonth = today.startsWith(days[0].slice(0, 7));

  return (
    <section aria-label="Month" className="rounded-2xl border border-line bg-panel p-5 md:p-6">
      <header className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold tracking-tight">
          {MONTHS_LONG[monthIndex]} {year}
        </h2>
        <div className="flex gap-1">
          <IconButton label="Previous month" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton label="Next month" disabled={isCurrentMonth} onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>
            <ChevronRight className="size-5" />
          </IconButton>
        </div>
      </header>

      <div className="mt-4 overflow-x-auto scroll-thin">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-36 bg-panel pr-3 text-left text-[12px] font-medium text-faint">
                Habit
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={`w-6 text-center text-[11px] font-medium tabular-nums ${day === today ? "text-ink" : "text-faint"}`}
                >
                  <span className="block">{DAYS[parseDay(day).getDay()][0]}</span>
                  {parseDay(day).getDate()}
                </th>
              ))}
              <th scope="col" className="pl-3 text-right text-[12px] font-medium text-faint">
                Done
              </th>
            </tr>
          </thead>
          <tbody>
            {habits.map((h) => {
              const dueSoFar = days.filter((d) => d <= today && isDue(h, d));
              const hits = days.filter((d) => doneOn(h, d)).length;
              return (
                <tr key={h.id}>
                  <th scope="row" className="sticky left-0 z-10 max-w-44 truncate bg-panel pr-3 text-left text-[14px] font-medium">
                    {h.name}
                  </th>
                  {days.map((day) => {
                    const ticked = doneOn(h, day);
                    const future = day > today;
                    const due = isDue(h, day);
                    return (
                      <td key={day}>
                        <button
                          type="button"
                          disabled={future}
                          aria-pressed={ticked}
                          aria-label={`${h.name}, ${shortDay(day)}: ${ticked ? "done" : "not done"}`}
                          onClick={() => onToggle(h, day)}
                          className="grid size-6 place-items-center rounded-md border transition-colors disabled:cursor-default"
                          style={
                            ticked
                              ? { backgroundColor: h.color, borderColor: h.color }
                              : future
                                ? { borderColor: "transparent", backgroundColor: "#171a20" }
                                : { borderColor: due ? "#3a4150" : "#232831", backgroundColor: due ? "transparent" : "#171a20" }
                          }
                        />
                      </td>
                    );
                  })}
                  <td className="pl-3 text-right text-[13px] text-muted tabular-nums">
                    {hits}/{dueSoFar.length || "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-faint">Tap any past day to fix a tick you missed.</p>
    </section>
  );
}

interface HabitFormProps {
  habit: Habit | null;
  colors: string[];
  defaultColor: string;
  onCancel: () => void;
  onSave: (input: { id?: string; name: string; color: string; days: number[] }) => Promise<void>;
}

function HabitForm({ habit, colors, defaultColor, onCancel, onSave }: HabitFormProps) {
  const [name, setName] = useState(habit?.name ?? "");
  const [color, setColor] = useState(habit?.color ?? defaultColor);
  const [days, setDays] = useState<number[]>(habit?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || days.length === 0) return;
    setSaving(true);
    await onSave({ id: habit?.id, name, color, days });
    setSaving(false);
  }

  return (
    <form onSubmit={submit}>
      <h2 className="text-[20px] font-bold tracking-tight">{habit ? "Edit habit" : "Add habit"}</h2>
      <label className="mt-5 block text-[13px] font-medium text-muted" htmlFor="habit-name">
        Name
      </label>
      <input
        id="habit-name"
        autoFocus
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Stretch before site"
        className="mt-1.5 h-11 w-full rounded-xl border border-line-strong bg-card px-4 text-[15px] outline-none placeholder:text-faint focus:border-faint"
      />

      <p className="mt-5 text-[13px] font-medium text-muted">Colour</p>
      <div role="radiogroup" aria-label="Colour" className="mt-2 flex gap-2.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`size-8 rounded-full ring-offset-2 ring-offset-raised transition ${color === c ? "ring-2 ring-ink" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <p className="mt-5 text-[13px] font-medium text-muted">Days</p>
      <div role="group" aria-label="Days" className="mt-2 flex gap-1.5">
        {WEEK.map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={DAYS[d]}
              onClick={() => setDays((all) => (on ? all.filter((x) => x !== d) : [...all, d]))}
              className={`size-10 rounded-xl border text-[13px] font-semibold transition-colors ${
                on ? "border-ink/40 bg-white/10 text-ink" : "border-line-strong text-faint hover:text-ink-soft"
              }`}
            >
              {DAYS[d][0]}
            </button>
          );
        })}
      </div>
      {days.length === 0 && <p className="mt-2 text-[13px] text-amber">Pick at least one day.</p>}

      <div className="mt-7 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-11 rounded-xl px-4 text-[15px] text-muted hover:text-ink">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim() || days.length === 0}
          className="h-11 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : habit ? "Save" : "Add habit"}
        </button>
      </div>
    </form>
  );
}
