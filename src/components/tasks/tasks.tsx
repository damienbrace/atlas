"use client";

import { Check, ChevronDown, Ellipsis, Flag, Mail, Plus, Repeat as RepeatIcon, Search, StickyNote, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  approveSuggestion,
  createTask,
  dismissSuggestion,
  editTask,
  findTasks,
  markTask,
  removeTask,
  undoRemoveTask,
} from "@/app/(app)/tasks/actions";
import { iconButtonClass } from "@/components/icon-button";
import { Menu } from "@/components/menu";
import { Sparkle } from "@/components/sparkle";
import { useToast } from "@/components/toast";
import { addDays, shortDay } from "@/lib/life/days";
import { AREA_COLORS, GROUP_LABELS, REPEAT_LABELS, TASK_AREAS, taskGroup, type TaskArea, type TaskGroup } from "@/lib/life/task-rules";
import type { TaskSuggestion } from "@/lib/life/task-suggestions";
import type { Task } from "@/lib/life/tasks";
import { TaskDialog, type TaskDraft } from "./task-dialog";
import { AreaChip, DueChip, quickDays } from "./task-parts";

// The Tasks page: everything to do, grouped by when, with Atlas's suggestions from
// email waiting on top for Approve / Edit / Dismiss.

const GROUP_ORDER: TaskGroup[] = ["overdue", "today", "week", "later", "someday"];

/** Flagged first, then soonest, then oldest. */
function byPriorityThenDate(a: Task, b: Task) {
  if (a.priority !== b.priority) return a.priority ? -1 : 1;
  return (a.dueDay ?? "9999").localeCompare(b.dueDay ?? "9999");
}

const toDraft = (t: Task): TaskDraft => ({ title: t.title, dueDay: t.dueDay, area: t.area, priority: t.priority, notes: t.notes, repeat: t.repeat });

type Editing = { kind: "task"; task: Task } | { kind: "suggestion"; suggestion: TaskSuggestion } | null;

interface TasksProps {
  tasks: Task[];
  suggestions: TaskSuggestion[];
  today: string;
}

export function Tasks({ tasks: initialTasks, suggestions: initialSuggestions, today }: TasksProps) {
  const toast = useToast();
  const [tasks, setTasks] = useState(initialTasks);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [area, setArea] = useState<TaskArea | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Task[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);

  // Search runs on the server so it covers the whole Done history, not just what's loaded.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => {
      void findTasks(q).then((res) => setFound(res.ok ? res.tasks : []));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const replace = (task: Task) => setTasks((all) => (all.some((t) => t.id === task.id) ? all.map((t) => (t.id === task.id ? task : t)) : [...all, task]));
  const inArea = (t: Task) => !area || t.area === area;
  const open = tasks.filter((t) => !t.done && inArea(t)).sort(byPriorityThenDate);
  const done = tasks.filter((t) => t.done && inArea(t)).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const groups = GROUP_ORDER.map((g) => ({ group: g, items: open.filter((t) => taskGroup(t.dueDay, today) === g) })).filter((g) => g.items.length);
  const overdue = open.filter((t) => taskGroup(t.dueDay, today) === "overdue").length;
  const dueToday = open.filter((t) => t.dueDay === today).length;

  async function toggle(task: Task) {
    const flip = (value: boolean) => replace({ ...task, done: value, doneAt: value ? Date.now() : null });
    flip(!task.done);
    const res = await markTask(task.id, !task.done).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      flip(task.done);
      return toast({ message: "Couldn't update that task" });
    }
    if (res.next) {
      replace(res.next);
      toast({ message: `Next one due ${res.next.dueDay === today ? "today" : shortDay(res.next.dueDay!)}` });
    }
    if (res.removedId) setTasks((all) => all.filter((t) => t.id !== res.removedId));
  }

  async function change(task: Task, draft: Partial<TaskDraft>) {
    const res = await editTask(task.id, draft).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      toast({ message: "Couldn't save that change" });
      return false;
    }
    replace(res.task);
    return true;
  }

  async function snooze(task: Task, day: string) {
    if (await change(task, { dueDay: day })) toast({ message: `Snoozed to ${day === addDays(today, 1) ? "tomorrow" : "next week"}` });
  }

  async function remove(task: Task) {
    setTasks((all) => all.filter((t) => t.id !== task.id));
    setEditing(null);
    const res = await removeTask(task.id).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      replace(task);
      return toast({ message: "Couldn't delete that task" });
    }
    toast({
      message: "Task deleted",
      onAction: () =>
        void undoRemoveTask(task.id).then((r) => (r.ok ? replace(r.task) : toast({ message: "Couldn't bring it back" }))),
    });
  }

  async function approve(s: TaskSuggestion, draft: Partial<TaskDraft> = {}) {
    const res = await approveSuggestion(s.key, draft).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      toast({ message: "Couldn't add that task" });
      return false;
    }
    setSuggestions((all) => all.filter((x) => x.key !== s.key));
    replace(res.task);
    return true;
  }

  async function dismiss(s: TaskSuggestion) {
    setSuggestions((all) => all.filter((x) => x.key !== s.key));
    const res = await dismissSuggestion(s.key).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      setSuggestions((all) => [s, ...all]);
      toast({ message: "Couldn't dismiss that" });
    }
  }

  const rowProps = { today, onToggle: toggle, onOpen: (task: Task) => setEditing({ kind: "task", task }), onSnooze: snooze, onChange: change, onDelete: remove };
  const searching = query.trim().length > 0;

  return (
    <div className="h-full overflow-y-auto p-3 pb-[84px] scroll-thin md:pb-3 lg:p-5">
      <div className="mx-auto flex max-w-[780px] flex-col gap-4">
        <header className="px-1">
          <h1 className="text-[30px] leading-tight font-bold tracking-tight md:text-[34px]">Tasks</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {open.length === 0
              ? "Nothing to do. A clear run."
              : [overdue && `${overdue} overdue`, dueToday && `${dueToday} today`, `${open.length} open`].filter(Boolean).join(" · ")}
          </p>
        </header>

        <AddTask today={today} area={area} onAdded={replace} />

        <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip on={area === null} onClick={() => setArea(null)}>
              All
            </FilterChip>
            {TASK_AREAS.map((a) => (
              <FilterChip key={a} on={area === a} color={AREA_COLORS[a]} onClick={() => setArea(area === a ? null : a)}>
                {a}
              </FilterChip>
            ))}
          </div>
          <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-line-strong px-3 sm:max-w-60">
            <Search className="size-4 shrink-0 text-faint" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value.trim()) setFound(null);
              }}
              placeholder="Search all tasks"
              aria-label="Search all tasks"
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            />
            {searching && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setFound(null);
                }}
                className="text-faint hover:text-ink"
              >
                <X className="size-4" />
              </button>
            )}
          </label>
        </div>

        {searching ? (
          <section aria-label="Search results" className="rounded-2xl border border-line bg-panel p-2">
            {found === null ? (
              <p className="px-3 py-4 text-[14px] text-muted">Searching…</p>
            ) : found.length === 0 ? (
              <p className="px-3 py-4 text-[14px] text-muted">No tasks mention that.</p>
            ) : (
              <ul>
                {found.filter(inArea).map((t) => (
                  <TaskRow key={t.id} task={tasks.find((x) => x.id === t.id) ?? t} {...rowProps} />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            {suggestions.length > 0 && (
              <section aria-label="Suggested by Atlas" className="rounded-2xl border border-l-[3px] border-line border-l-teal bg-card p-4">
                <h2 className="flex items-center gap-2 text-[14px] font-semibold text-teal">
                  <Sparkle className="size-4" /> Suggested by Atlas from your email · {suggestions.length}
                </h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {suggestions.map((s) => (
                    <li key={s.key} className="rounded-xl border border-line bg-panel p-3">
                      <p className="text-[15px] font-semibold">{s.title}</p>
                      <Link href={`/inbox?thread=${s.threadId}`} className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
                        <Mail className="size-3.5 shrink-0" />
                        <span className="truncate">{[s.emailFrom, s.emailHeadline].filter(Boolean).join(" · ")}</span>
                      </Link>
                      {(s.dueDay || s.area) && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-2">
                          {s.dueDay && <DueChip dueDay={s.dueDay} today={today} />}
                          {s.area && <AreaChip area={s.area} />}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void approve(s)}
                          className="h-9 rounded-lg bg-teal px-4 text-[14px] font-semibold text-canvas hover:opacity-90"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing({ kind: "suggestion", suggestion: s })}
                          className="h-9 rounded-lg border border-teal/60 px-3 text-[14px] hover:bg-teal/10"
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => void dismiss(s)} className="h-9 rounded-lg px-3 text-[14px] text-muted hover:text-ink">
                          Dismiss
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {groups.length === 0 && (
              <p className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-[15px] text-muted">
                {area ? `No open ${area} tasks.` : "No open tasks. Add one above, or say it in a voice note."}
              </p>
            )}

            {groups.map(({ group, items }) => (
              <section key={group} aria-label={GROUP_LABELS[group]} className="rounded-2xl border border-line bg-panel p-2">
                <h2
                  className={`px-3 pt-2 pb-1 text-[12.5px] font-semibold tracking-wide uppercase ${
                    group === "overdue" ? "text-red" : group === "today" ? "text-amber" : "text-faint"
                  }`}
                >
                  {GROUP_LABELS[group]} · {items.length}
                </h2>
                <ul>
                  {items.map((t) => (
                    <TaskRow key={t.id} task={t} {...rowProps} />
                  ))}
                </ul>
              </section>
            ))}

            {done.length > 0 && (
              <section aria-label="Done" className="rounded-2xl border border-line bg-panel p-2">
                <button
                  type="button"
                  aria-expanded={showDone}
                  onClick={() => setShowDone((s) => !s)}
                  className="flex w-full items-center justify-between px-3 py-2 text-[12.5px] font-semibold tracking-wide text-faint uppercase hover:text-ink"
                >
                  Done in the last 30 days · {done.length}
                  <ChevronDown className={`size-4 transition-transform ${showDone ? "rotate-180" : ""}`} />
                </button>
                {showDone && (
                  <ul>
                    {done.map((t) => (
                      <TaskRow key={t.id} task={t} {...rowProps} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {editing?.kind === "task" && (
        <TaskDialog
          mode="edit"
          initial={toDraft(editing.task)}
          threadId={editing.task.threadId}
          today={today}
          onClose={() => setEditing(null)}
          onSave={(draft) => change(editing.task, draft)}
          onDelete={() => void remove(editing.task)}
        />
      )}
      {editing?.kind === "suggestion" && (
        <TaskDialog
          mode="suggestion"
          initial={{ title: editing.suggestion.title, dueDay: editing.suggestion.dueDay, area: editing.suggestion.area, priority: false, notes: "", repeat: null }}
          threadId={editing.suggestion.threadId}
          today={today}
          onClose={() => setEditing(null)}
          onSave={(draft) => approve(editing.suggestion, draft)}
        />
      )}
    </div>
  );
}

function FilterChip({ on, color, onClick, children }: { on: boolean; color?: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="h-8 rounded-full border px-3 text-[13.5px]"
      style={
        on
          ? { color: "#0b0d11", backgroundColor: color ?? "#e8eaf0", borderColor: color ?? "#e8eaf0" }
          : { color: color ?? "#c3c8d2", borderColor: color ? `${color}55` : "#2a2f3a" }
      }
    >
      {children}
    </button>
  );
}

interface TaskRowProps {
  task: Task;
  today: string;
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onSnooze: (task: Task, day: string) => void;
  onChange: (task: Task, change: Partial<TaskDraft>) => Promise<boolean>;
  onDelete: (task: Task) => void;
}

function TaskRow({ task: t, today, onToggle, onOpen, onSnooze, onChange, onDelete }: TaskRowProps) {
  return (
    <li className="group flex items-start gap-1 rounded-xl hover:bg-white/[0.03]">
      <button
        type="button"
        aria-label={t.done ? `Mark "${t.title}" not done` : `Tick off "${t.title}"`}
        aria-pressed={t.done}
        onClick={() => onToggle(t)}
        className="grid size-11 shrink-0 place-items-center"
      >
        <span className={`grid size-5 place-items-center rounded-md border ${t.done ? "border-green bg-green" : "border-line-strong"}`}>
          {t.done && <Check className="size-3.5 text-canvas" strokeWidth={3} />}
        </span>
      </button>
      <button type="button" onClick={() => onOpen(t)} className="min-w-0 flex-1 py-2.5 text-left">
        <span className={`block text-[15.5px] [overflow-wrap:anywhere] ${t.done ? "text-muted line-through decoration-faint" : ""}`}>
          {t.priority && !t.done && <Flag aria-label="Flagged" className="mr-1.5 inline size-3.5 -translate-y-px fill-current text-ink-soft" />}
          {t.title}
        </span>
        {(t.dueDay || t.area || t.repeat || t.threadId || t.notes) && !t.done && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {t.dueDay && <DueChip dueDay={t.dueDay} today={today} />}
            {t.area && <AreaChip area={t.area} />}
            {t.repeat && (
              <span className="flex items-center gap-1 text-[12.5px] text-muted">
                <RepeatIcon className="size-3.5" /> {REPEAT_LABELS[t.repeat]}
              </span>
            )}
            {t.threadId && <Mail aria-label="From an email" className="size-3.5 text-muted" />}
            {t.notes && <StickyNote aria-label="Has notes" className="size-3.5 text-muted" />}
          </span>
        )}
      </button>
      {!t.done && (
        <Menu
          label={`More for "${t.title}"`}
          trigger={<Ellipsis className="size-5" />}
          triggerClassName={`${iconButtonClass} mt-1 mr-1 size-9`}
          items={[
            { label: "Snooze to tomorrow", onSelect: () => onSnooze(t, addDays(today, 1)) },
            { label: "Snooze to next week", onSelect: () => onSnooze(t, addDays(today, 7)) },
            { label: "Pick a date…", onSelect: () => onOpen(t) },
            { label: t.priority ? "Remove flag" : "Flag as important", onSelect: () => void onChange(t, { priority: !t.priority }) },
            { label: "Delete", danger: true, onSelect: () => onDelete(t) },
          ]}
        />
      )}
    </li>
  );
}

/** The add bar: type, pick when and area, Enter. */
function AddTask({ today, area: filterArea, onAdded }: { today: string; area: TaskArea | null; onAdded: (task: Task) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [dueDay, setDueDay] = useState<string | null>(today);
  const [area, setArea] = useState<TaskArea | null>(null);
  const [priority, setPriority] = useState(false);
  // New tasks land in the area being looked at, unless one is picked.
  const chosenArea = area ?? filterArea;

  async function add(e: FormEvent) {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle("");
    const res = await createTask({ title: text, dueDay, area: chosenArea, priority }).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      setTitle(text);
      return toast({ message: "Couldn't add that task" });
    }
    onAdded(res.task);
    setPriority(false);
  }

  const chip = (on: boolean) =>
    `h-8 rounded-full border px-3 text-[13px] ${on ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-soft hover:border-faint"}`;

  return (
    <form onSubmit={add} className="rounded-2xl border border-line bg-panel p-3">
      <div className="flex items-center gap-2">
        <Plus aria-hidden="true" className="ml-1 size-5 shrink-0 text-faint" />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          aria-label="Add a task"
          maxLength={200}
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="h-10 rounded-xl bg-ink px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90 disabled:opacity-30"
        >
          Add
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {quickDays(today).map((q) => (
          <button key={q.label} type="button" onClick={() => setDueDay(q.day)} className={chip(dueDay === q.day)}>
            {q.label}
          </button>
        ))}
        <input
          type="date"
          aria-label="Pick a date"
          value={dueDay ?? ""}
          onChange={(e) => setDueDay(e.target.value || null)}
          className="h-8 rounded-full border border-line-strong bg-transparent px-2 text-[13px] text-ink-soft outline-none [color-scheme:dark]"
        />
        <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden="true" />
        <select
          aria-label="Area"
          value={chosenArea ?? ""}
          onChange={(e) => setArea((e.target.value || null) as TaskArea | null)}
          className="h-8 rounded-full border border-line-strong bg-card px-2 text-[13px] text-ink-soft outline-none [color-scheme:dark]"
        >
          <option value="">No area</option>
          {TASK_AREAS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={priority}
          aria-label="Flag as important"
          title="Flag as important"
          onClick={() => setPriority((p) => !p)}
          className={`grid size-8 place-items-center rounded-full border ${priority ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-soft"}`}
        >
          <Flag className={`size-4 ${priority ? "fill-current" : ""}`} />
        </button>
      </div>
    </form>
  );
}
