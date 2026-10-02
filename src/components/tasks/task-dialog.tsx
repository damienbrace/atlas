"use client";

import { Flag, Mail } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { Sparkle } from "@/components/sparkle";
import { REPEAT_LABELS, REPEATS, TASK_AREAS, AREA_COLORS, type Repeat, type TaskArea } from "@/lib/life/task-rules";
import { quickDays } from "./task-parts";

export interface TaskDraft {
  title: string;
  dueDay: string | null;
  area: TaskArea | null;
  priority: boolean;
  notes: string;
  repeat: Repeat | null;
}

interface TaskDialogProps {
  /** "suggestion": editing one of Atlas's suggestions before approving it. */
  mode: "edit" | "suggestion";
  initial: TaskDraft;
  threadId: string | null;
  today: string;
  onClose: () => void;
  onSave: (draft: TaskDraft) => Promise<boolean>;
  onDelete?: () => void;
}

const field = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-[15px] outline-none focus:border-faint";
const chip = (on: boolean) =>
  `h-8 rounded-full border px-3 text-[13.5px] ${on ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-soft hover:border-faint"}`;

export function TaskDialog({ mode, initial, threadId, today, onClose, onSave, onDelete }: TaskDialogProps) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (change: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...change }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setSaving(true);
    const ok = await onSave({ ...draft, title: draft.title.trim() });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onClose={onClose} title={mode === "edit" ? "Edit task" : "Edit Atlas's suggestion"}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="flex items-center gap-2 text-[19px] font-bold tracking-tight">
          {mode === "suggestion" && <Sparkle className="size-5" />}
          {mode === "edit" ? "Edit task" : "Suggested task"}
        </h2>

        <input
          autoFocus
          aria-label="Task"
          value={draft.title}
          maxLength={200}
          onChange={(e) => set({ title: e.target.value })}
          className={field}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold text-muted">When</legend>
          <div className="flex flex-wrap gap-1.5">
            {quickDays(today).map((q) => (
              <button key={q.label} type="button" onClick={() => set({ dueDay: q.day })} className={chip(draft.dueDay === q.day)}>
                {q.label}
              </button>
            ))}
          </div>
          <input
            type="date"
            aria-label="Due date"
            value={draft.dueDay ?? ""}
            onChange={(e) => set({ dueDay: e.target.value || null })}
            className={`${field} [color-scheme:dark]`}
          />
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-muted">Area</legend>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set({ area: null })} className={chip(draft.area === null)}>
              None
            </button>
            {TASK_AREAS.map((area) => (
              <button
                key={area}
                type="button"
                onClick={() => set({ area })}
                className="h-8 rounded-full border px-3 text-[13.5px]"
                style={
                  draft.area === area
                    ? { color: "#0b0d11", backgroundColor: AREA_COLORS[area], borderColor: AREA_COLORS[area] }
                    : { color: AREA_COLORS[area], borderColor: `${AREA_COLORS[area]}66` }
                }
              >
                {area}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={draft.priority}
            onClick={() => set({ priority: !draft.priority })}
            className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-[14px] ${
              draft.priority ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink-soft hover:border-faint"
            }`}
          >
            <Flag className={`size-4 ${draft.priority ? "fill-current" : ""}`} /> {draft.priority ? "Flagged" : "Flag as important"}
          </button>
          <label className="flex items-center gap-2 text-[14px] text-muted">
            Repeat
            <select
              value={draft.repeat ?? ""}
              onChange={(e) => set({ repeat: (e.target.value || null) as Repeat | null })}
              className="h-9 rounded-lg border border-line-strong bg-card px-2 text-[14px] text-ink outline-none [color-scheme:dark] focus:border-faint"
            >
              <option value="">Never</option>
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {REPEAT_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <textarea
          aria-label="Notes"
          placeholder="Notes: measurements, phone numbers, details…"
          value={draft.notes}
          maxLength={10_000}
          rows={3}
          onChange={(e) => set({ notes: e.target.value })}
          className={`${field} resize-none`}
        />

        {threadId && (
          <Link href={`/inbox?thread=${threadId}`} className="flex items-center gap-2 text-[14px] text-muted hover:text-ink">
            <Mail className="size-4" /> Open the email this came from
          </Link>
        )}

        <div className="mt-1 flex items-center gap-2">
          {onDelete && (
            <button type="button" onClick={onDelete} className="h-11 rounded-xl px-3 text-[15px] text-red hover:bg-red/10">
              Delete
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-[15px] text-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !draft.title.trim()}
            className={`h-11 rounded-xl px-5 text-[15px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40 ${
              mode === "suggestion" ? "bg-teal" : "bg-ink"
            }`}
          >
            {saving ? "Saving…" : mode === "suggestion" ? "Approve" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
