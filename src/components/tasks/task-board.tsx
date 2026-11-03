"use client";

import { ArrowRight, Check, Ellipsis, Flag, Mail, Repeat as RepeatIcon, StickyNote } from "lucide-react";
import { useState, type DragEvent } from "react";
import { iconButtonClass } from "@/components/icon-button";
import { Menu, type MenuItem } from "@/components/menu";
import { addDays } from "@/lib/life/days";
import { REPEAT_LABELS } from "@/lib/life/task-rules";
import type { Task } from "@/lib/life/tasks";
import type { TaskDraft } from "./task-dialog";
import { SwipeRow } from "./swipe-row";
import { AreaChip, DueChip } from "./task-parts";

// The Tasks page as a board: To do, Doing, Done. On a computer cards drag between
// columns; on the phone one column shows at a time and cards move with Start, the
// tick and their menu.

export type BoardColumn = "todo" | "doing" | "done";

const COLUMNS: { id: BoardColumn; label: string; empty: string }[] = [
  { id: "todo", label: "To do", empty: "Nothing waiting." },
  { id: "doing", label: "Doing", empty: "Nothing on the go. Start a task, or drag one here." },
  { id: "done", label: "Done", empty: "Nothing done in the last 30 days." },
];

const COLUMN_LABELS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.label])) as Record<BoardColumn, string>;

export const boardColumn = (t: Task): BoardColumn => (t.done ? "done" : t.startedAt ? "doing" : "todo");

/** Done shows its latest few until "Show all". */
const DONE_SHOWN = 10;

interface TaskBoardProps {
  /** Open tasks, already filtered and sorted. */
  open: Task[];
  /** Done in the last 30 days, newest first. */
  done: Task[];
  today: string;
  onMove: (task: Task, to: BoardColumn) => void;
  onToggle: (task: Task) => void;
  /** Opens Atlas's summary of the task. */
  onOpen: (task: Task) => void;
  onEdit: (task: Task) => void;
  onSnooze: (task: Task, day: string) => void;
  onChange: (task: Task, change: Partial<TaskDraft>) => Promise<boolean>;
  onDelete: (task: Task) => void;
}

export function TaskBoard({ open, done, today, onMove, ...cardProps }: TaskBoardProps) {
  const [tab, setTab] = useState<BoardColumn>("todo");
  const [dragging, setDragging] = useState<Task | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);
  const [allDone, setAllDone] = useState(false);

  const items: Record<BoardColumn, Task[]> = {
    todo: open.filter((t) => !t.startedAt),
    doing: open.filter((t) => t.startedAt),
    done: allDone ? done : done.slice(0, DONE_SHOWN),
  };
  const counts: Record<BoardColumn, number> = { todo: items.todo.length, doing: items.doing.length, done: done.length };

  // A column takes a drop from any other column; dropping back where it came from does nothing.
  const dropProps = (col: BoardColumn) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragging || boardColumn(dragging) === col) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== col) setOver(col);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === col ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging) onMove(dragging, col);
      setDragging(null);
      setOver(null);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Board column" className="grid grid-cols-3 rounded-xl border border-line-strong p-1 md:hidden">
        {COLUMNS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={tab === c.id}
            onClick={() => setTab(c.id)}
            className={`h-10 rounded-lg text-[14px] font-medium ${tab === c.id ? "bg-white/[0.08] text-ink" : "text-muted"}`}
          >
            {c.label} <span className="text-faint tabular-nums">{counts[c.id]}</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-3 md:grid-cols-3">
        {COLUMNS.map((c) => (
          <section
            key={c.id}
            aria-label={c.label}
            {...dropProps(c.id)}
            className={`flex min-w-0 flex-col rounded-2xl border bg-panel p-2 transition-colors md:min-h-64 ${
              over === c.id ? "border-faint bg-white/[0.03]" : "border-line"
            } ${tab === c.id ? "" : "max-md:hidden"}`}
          >
            {/* On the phone the tabs above already say which column this is. */}
            <h2
              className={`px-2 pt-1.5 pb-2 text-[12.5px] font-semibold tracking-wide uppercase max-md:sr-only ${
                c.id === "doing" ? "text-ink-soft" : "text-faint"
              }`}
            >
              {c.label} · {counts[c.id]}
            </h2>
            {items[c.id].length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-[13.5px] text-muted">{c.empty}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items[c.id].map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    column={c.id}
                    today={today}
                    dragging={dragging?.id === t.id}
                    onDragStart={() => setDragging(t)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onMove={onMove}
                    {...cardProps}
                  />
                ))}
              </ul>
            )}
            {c.id === "done" && done.length > DONE_SHOWN && (
              <button type="button" onClick={() => setAllDone((a) => !a)} className="mt-2 h-9 rounded-lg text-[13.5px] text-muted hover:text-ink">
                {allDone ? "Show fewer" : `Show all ${done.length}`}
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

interface TaskCardProps extends Omit<TaskBoardProps, "open" | "done"> {
  task: Task;
  column: BoardColumn;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function TaskCard({
  task: t,
  column,
  today,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onToggle,
  onOpen,
  onEdit,
  onSnooze,
  onChange,
  onDelete,
}: TaskCardProps) {
  const moves: MenuItem[] = (["todo", "doing", "done"] as const)
    .filter((to) => to !== column)
    .map((to) => ({ label: `Move to ${COLUMN_LABELS[to]}`, onSelect: () => onMove(t, to) }));
  const items: MenuItem[] = t.done
    ? [...moves, { label: "Delete", danger: true, onSelect: () => onDelete(t) }]
    : [
        ...moves,
        { label: "Snooze to tomorrow", onSelect: () => onSnooze(t, addDays(today, 1)) },
        { label: "Snooze to next week", onSelect: () => onSnooze(t, addDays(today, 7)) },
        { label: "Pick a date…", onSelect: () => onEdit(t) },
        { label: "Edit", onSelect: () => onEdit(t) },
        { label: t.priority ? "Remove flag" : "Flag as important", onSelect: () => void onChange(t, { priority: !t.priority }) },
        { label: "Delete", danger: true, onSelect: () => onDelete(t) },
      ];
  const meta = !t.done && (t.dueDay || t.area || t.repeat || t.threadId || t.notes);

  return (
    <SwipeRow
      enabled={!t.done}
      onSwipe={() => onToggle(t)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.title);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`rounded-xl border border-line bg-card md:cursor-grab md:active:cursor-grabbing ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start">
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
          <span className={`block text-[15px] [overflow-wrap:anywhere] ${t.done ? "text-muted line-through decoration-faint" : ""}`}>
            {t.priority && !t.done && <Flag aria-label="Flagged" className="mr-1.5 inline size-3.5 -translate-y-px fill-current text-ink-soft" />}
            {t.title}
          </span>
        </button>
        <Menu
          label={`More for "${t.title}"`}
          trigger={<Ellipsis className="size-5" />}
          triggerClassName={`${iconButtonClass} mt-1 mr-1 size-9`}
          items={items}
        />
      </div>
      {(meta || column === "todo") && (
        <div className="-mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pr-2 pb-2 pl-11">
          {t.dueDay && !t.done && <DueChip dueDay={t.dueDay} today={today} />}
          {t.area && !t.done && <AreaChip area={t.area} />}
          {t.repeat && !t.done && (
            <span className="flex items-center gap-1 text-[12.5px] text-muted">
              <RepeatIcon className="size-3.5" /> {REPEAT_LABELS[t.repeat]}
            </span>
          )}
          {t.threadId && !t.done && <Mail aria-label="From an email" className="size-3.5 text-muted" />}
          {t.notes && !t.done && <StickyNote aria-label="Has notes" className="size-3.5 text-muted" />}
          {column === "todo" && (
            <button
              type="button"
              aria-label={`Start "${t.title}"`}
              onClick={() => onMove(t, "doing")}
              className="ml-auto flex h-8 items-center gap-1 rounded-full border border-line-strong px-3 text-[13px] text-ink-soft hover:border-faint hover:text-ink"
            >
              Start <ArrowRight className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </SwipeRow>
  );
}
