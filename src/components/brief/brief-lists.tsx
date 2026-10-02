"use client";

import { Check, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createTask, markTask } from "@/app/(app)/brief/actions";
import { markHabit } from "@/app/(app)/habits/actions";
import { useToast } from "@/components/toast";
import { shortDay } from "@/lib/life/days";
import type { Habit } from "@/lib/life/habits";
import type { Task } from "@/lib/life/tasks";

/** Today's habits, tickable from the Brief. */
export function BriefHabits({ habits, done: initial, today }: { habits: Habit[]; done: string[]; today: string }) {
  const toast = useToast();
  const [done, setDone] = useState(() => new Set(initial));

  async function toggle(habit: Habit) {
    const value = !done.has(habit.id);
    const apply = (on: boolean) =>
      setDone((all) => {
        const next = new Set(all);
        if (on) next.add(habit.id);
        else next.delete(habit.id);
        return next;
      });
    apply(value);
    const res = await markHabit(habit.id, today, value).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      apply(!value);
      toast({ message: "Couldn't save that tick" });
    }
  }

  return (
    <ul className="flex flex-col gap-1">
      {habits.map((h) => {
        const ticked = done.has(h.id);
        return (
          <li key={h.id}>
            <button
              type="button"
              aria-pressed={ticked}
              onClick={() => void toggle(h)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.03]"
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-full border-2"
                style={ticked ? { backgroundColor: h.color, borderColor: h.color } : { borderColor: `${h.color}99` }}
              >
                {ticked && <Check className="size-4 text-canvas" strokeWidth={3} />}
              </span>
              <span className={`text-[15px] ${ticked ? "text-muted line-through decoration-faint" : ""}`}>{h.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Open tasks with a quick-add line. Ticked tasks stay until tomorrow, struck through. */
export function BriefTasks({ tasks: initial, today }: { tasks: Task[]; today: string }) {
  const toast = useToast();
  const [tasks, setTasks] = useState(initial);
  const [draft, setDraft] = useState("");

  async function toggle(task: Task) {
    const flip = (done: boolean) => setTasks((all) => all.map((t) => (t.id === task.id ? { ...t, done } : t)));
    flip(!task.done);
    const res = await markTask(task.id, !task.done).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      flip(task.done);
      toast({ message: "Couldn't update that task" });
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const res = await createTask(title, null).catch(() => ({ ok: false as const }));
    if (!res.ok || !("id" in res)) {
      setDraft(title);
      return toast({ message: "Couldn't add that task" });
    }
    setTasks((all) => [...all, { id: res.id, title, dueDay: null, done: false }]);
  }

  return (
    <div>
      <ul className="flex flex-col gap-0.5">
        {tasks.map((t) => {
          const overdue = !t.done && t.dueDay !== null && t.dueDay < today;
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={t.done}
                onClick={() => void toggle(t)}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.03]"
              >
                <span
                  className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${
                    t.done ? "border-green bg-green" : "border-line-strong"
                  }`}
                >
                  {t.done && <Check className="size-3.5 text-canvas" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] ${t.done ? "text-muted line-through decoration-faint" : ""}`}>{t.title}</span>
                  {t.dueDay && !t.done && (
                    <span className={`text-[12.5px] ${overdue ? "text-red" : t.dueDay === today ? "text-amber" : "text-faint"}`}>
                      {overdue ? `Overdue · ${shortDay(t.dueDay)}` : t.dueDay === today ? "Due today" : shortDay(t.dueDay)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add} className="mt-1 flex items-center gap-3 px-2">
        <Plus aria-hidden="true" className="size-5 shrink-0 text-faint" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task"
          aria-label="Add a task"
          maxLength={200}
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
      </form>
    </div>
  );
}
