"use client";

import { Check, ListPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { approveSuggestion, dismissSuggestion, makeTaskFromEmail } from "@/app/(app)/tasks/actions";
import { Sparkle } from "@/components/sparkle";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { AreaChip, DueChip } from "@/components/tasks/task-parts";
import { useToast } from "@/components/toast";
import { dayKey } from "@/lib/life/days";
import type { Email } from "@/lib/inbox/types";

/**
 * Under Atlas's summary of an open email: the task made from it, Atlas's suggested
 * task waiting for Approve / Edit / Dismiss, or a "Make a task" button.
 */
export function EmailTask({ email }: { email: Email }) {
  const toast = useToast();
  const [task, setTask] = useState(email.task ?? null);
  const [suggestion, setSuggestion] = useState(email.taskSuggestion ?? null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const today = dayKey(new Date());

  if (!email.threadId) return null;
  const threadId = email.threadId;

  async function run(action: () => Promise<{ ok: true; task: { id: string; title: string; done: boolean } } | { ok: false }>) {
    setBusy(true);
    const res = await action().catch(() => ({ ok: false as const }));
    setBusy(false);
    if (!res.ok) {
      toast({ message: "Couldn't add that task" });
      return false;
    }
    setTask({ id: res.task.id, title: res.task.title, done: res.task.done });
    setSuggestion(null);
    toast({ message: "Added to Tasks" });
    return true;
  }

  if (task) {
    return (
      <Link
        href="/tasks"
        className="mx-6 mt-3 flex items-center gap-2.5 rounded-xl border border-line bg-card px-4 py-3 text-[14.5px] text-ink-soft hover:border-line-strong"
      >
        <Check className="size-4 shrink-0 text-green" />
        <span className="min-w-0 truncate">
          {task.done ? "Done" : "Task"}: {task.title}
        </span>
      </Link>
    );
  }

  if (suggestion) {
    return (
      <section aria-label="Suggested task" className="mx-6 mt-3 rounded-xl border border-l-[3px] border-line border-l-teal bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-teal">
          <Sparkle className="size-4" /> Atlas suggests a task
        </p>
        <p className="mt-1.5 text-[15px] font-semibold">{suggestion.title}</p>
        {(suggestion.dueDay || suggestion.area) && (
          <p className="mt-1 flex flex-wrap items-center gap-2">
            {suggestion.dueDay && <DueChip dueDay={suggestion.dueDay} today={today} />}
            {suggestion.area && <AreaChip area={suggestion.area} />}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => approveSuggestion(suggestion.key))}
            className="h-9 rounded-lg bg-teal px-4 text-[14px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
          >
            Approve
          </button>
          <button type="button" onClick={() => setEditing(true)} className="h-9 rounded-lg border border-teal/60 px-3 text-[14px] hover:bg-teal/10">
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setSuggestion(null);
              void dismissSuggestion(suggestion.key).then((r) => !r.ok && setSuggestion(suggestion));
            }}
            className="h-9 rounded-lg px-3 text-[14px] text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </div>
        {editing && (
          <TaskDialog
            mode="suggestion"
            initial={{ title: suggestion.title, dueDay: suggestion.dueDay, area: suggestion.area, priority: false, notes: "", repeat: null }}
            threadId={null}
            today={today}
            onClose={() => setEditing(false)}
            onSave={(draft) => run(() => approveSuggestion(suggestion.key, draft))}
          />
        )}
      </section>
    );
  }

  return (
    <div className="mx-6 mt-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => makeTaskFromEmail(threadId))}
        className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-[14px] text-ink-soft hover:border-faint hover:text-ink disabled:opacity-50"
      >
        <ListPlus className="size-4" /> {busy ? "Adding…" : "Make a task"}
      </button>
    </div>
  );
}
