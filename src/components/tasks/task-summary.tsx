"use client";

import { ArrowRight, Check, ExternalLink, Mail, Pencil, RefreshCw, Repeat as RepeatIcon, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { loadTaskBrief, runTaskHelp, saveHelpDraft } from "@/app/(app)/tasks/actions";
import { Dialog } from "@/components/dialog";
import { iconButtonClass } from "@/components/icon-button";
import { Sparkle } from "@/components/sparkle";
import { useToast } from "@/components/toast";
import { gmailAppUrl, isAndroid } from "@/lib/gmail/links";
import { dayKey, shortDay } from "@/lib/life/days";
import { REPEAT_LABELS } from "@/lib/life/task-rules";
import type { HelpResult, StoredBrief } from "@/lib/life/task-brief";
import type { Task } from "@/lib/life/tasks";
import { AreaChip, DueChip } from "./task-parts";

// What opens when a task is tapped: Atlas's read of it (and of the email it came from),
// what needs doing, and what Atlas can write to get it done. Atlas only ever writes:
// emails go to Gmail drafts and other writing to the task's notes, each after a look.

type Load = { state: "loading" } | { state: "failed"; error: string } | ({ state: "ready" } & StoredBrief);

interface TaskSummaryProps {
  task: Task;
  /** The summary sent with the page, if Atlas had already written it. */
  initial?: StoredBrief;
  onLoaded: (data: StoredBrief) => void;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onToggle: (task: Task) => void;
  onStart: (task: Task) => void;
  onAddNotes: (task: Task, text: string) => Promise<boolean>;
}

const button =
  "flex h-10 items-center gap-1.5 rounded-xl border border-line-strong px-3.5 text-[14px] text-ink-soft hover:border-faint hover:text-ink disabled:opacity-40";
const heading = "text-[12.5px] font-semibold tracking-wide text-faint uppercase";

/** Gmail links open the Gmail app on an Android phone, and a new tab anywhere else. */
const gmailLinkProps = (url: string) =>
  isAndroid() ? { href: gmailAppUrl(url) } : { href: url, target: "_blank", rel: "noopener noreferrer" };

const openGmail = (url: string) => {
  if (isAndroid()) window.location.href = gmailAppUrl(url);
  else window.open(url, "_blank", "noopener");
};

const fetched = (res: Awaited<ReturnType<typeof loadTaskBrief>>): Load =>
  res.ok ? { state: "ready", brief: res.brief, results: res.results } : { state: "failed", error: res.error };
const OFFLINE: Load = { state: "failed", error: "Couldn't reach Atlas. Check your connection and try again." };

export function TaskSummary({ task: t, initial, onLoaded, today, onClose, onEdit, onToggle, onStart, onAddNotes }: TaskSummaryProps) {
  // A summary sent with the page shows at once, then a quick check picks up anything newer
  // (help written on another device). Without one, Atlas writes it now.
  const [load, setLoad] = useState<Load>(initial ? { state: "ready", ...initial } : { state: "loading" });
  const [hadInitial] = useState(Boolean(initial));

  useEffect(() => {
    let live = true;
    void loadTaskBrief(t.id).then(
      (res) => {
        if (!live) return;
        if (res.ok) onLoaded({ brief: res.brief, results: res.results });
        if (res.ok || !hadInitial) setLoad(fetched(res));
      },
      () => live && !hadInitial && setLoad(OFFLINE),
    );
    return () => {
      live = false;
    };
    // Once per opening; onLoaded only stores what came back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id]);

  function rewrite() {
    setLoad({ state: "loading" });
    void loadTaskBrief(t.id, true).then(
      (res) => {
        if (res.ok) onLoaded({ brief: res.brief, results: res.results });
        setLoad(fetched(res));
      },
      () => setLoad(OFFLINE),
    );
  }

  const fromEmail = Boolean(t.threadId) || /^from:/im.test(t.notes);

  return (
    <Dialog open onClose={onClose} title={t.title} width={580}>
      <div className="flex flex-col gap-5">
        <header className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className={`text-[20px] leading-snug font-bold tracking-tight [overflow-wrap:anywhere] ${t.done ? "text-muted line-through" : ""}`}>
              {t.title}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {t.done && <span className="text-[12.5px] font-medium text-green">Done</span>}
              {t.startedAt && !t.done && <span className="text-[12.5px] font-medium text-ink-soft">Doing</span>}
              {t.dueDay && !t.done && <DueChip dueDay={t.dueDay} today={today} />}
              {t.area && <AreaChip area={t.area} />}
              {t.repeat && (
                <span className="flex items-center gap-1 text-[12.5px] text-muted">
                  <RepeatIcon className="size-3.5" /> {REPEAT_LABELS[t.repeat]}
                </span>
              )}
            </p>
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className={`${iconButtonClass} -mt-1 -mr-2`}>
            <X className="size-5" />
          </button>
        </header>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onToggle(t);
              onClose();
            }}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-ink px-4 text-[14px] font-semibold text-canvas hover:opacity-90"
          >
            <Check className="size-4" strokeWidth={3} /> {t.done ? "Not done" : "Tick off"}
          </button>
          {!t.done && !t.startedAt && (
            <button type="button" onClick={() => onStart(t)} className={button}>
              Start <ArrowRight className="size-4" />
            </button>
          )}
          <button type="button" onClick={onEdit} className={button}>
            <Pencil className="size-4" /> Edit
          </button>
        </div>

        {load.state === "loading" && (
          <section aria-busy="true" className="rounded-2xl border border-l-[3px] border-line border-l-teal bg-card p-4">
            <p className="flex items-center gap-2 text-[14px] text-muted">
              <Sparkle className="size-4 animate-pulse" /> {fromEmail ? "Reading the email…" : "Reading the task…"}
            </p>
            <div className="mt-3 flex animate-pulse flex-col gap-2" aria-hidden="true">
              <span className="h-3 w-11/12 rounded bg-white/[0.06]" />
              <span className="h-3 w-4/5 rounded bg-white/[0.06]" />
              <span className="h-3 w-2/3 rounded bg-white/[0.06]" />
            </div>
          </section>
        )}

        {load.state === "failed" && (
          <section className="rounded-2xl border border-line bg-card p-4">
            <p className="text-[14px] text-muted">{load.error}</p>
            <button type="button" onClick={rewrite} className={`${button} mt-3`}>
              <RefreshCw className="size-4" /> Try again
            </button>
          </section>
        )}

        {load.state === "ready" && (
          <Brief
            // A fresh summary, or help written elsewhere, starts the panel afresh.
            key={`${load.brief.createdAt}:${Object.keys(load.results).length}`}
            task={t}
            data={load}
            onRewrite={rewrite}
            onAddNotes={onAddNotes}
          />
        )}

        {t.notes.trim() && (
          <section>
            <h3 className={heading}>Notes</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">{t.notes}</p>
          </section>
        )}
      </div>
    </Dialog>
  );
}

function Brief({
  task: t,
  data,
  onRewrite,
  onAddNotes,
}: {
  task: Task;
  data: StoredBrief;
  onRewrite: () => void;
  onAddNotes: (task: Task, text: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const { brief } = data;
  const [results, setResults] = useState(data.results);
  const [open, setOpen] = useState<number | null>(null);
  const [writing, setWriting] = useState<number | null>(null);

  async function write(index: number) {
    setWriting(index);
    const res = await runTaskHelp(t.id, index).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    setWriting(null);
    if (!res.ok) return toast({ message: res.error });
    setResults((all) => ({ ...all, [index]: res.result }));
    setOpen(index);
  }

  return (
    <>
      <section aria-label="Atlas's summary" className="rounded-2xl border border-l-[3px] border-line border-l-teal bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[15px] leading-relaxed">{brief.about}</p>
          <button
            type="button"
            aria-label="Write a fresh summary"
            title="Write a fresh summary"
            onClick={onRewrite}
            className={`${iconButtonClass} -mt-1.5 -mr-2 shrink-0`}
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
        {brief.email && (
          <a
            {...gmailLinkProps(brief.email.url)}
            className="mt-3 flex items-center gap-3 rounded-xl border border-line-strong bg-panel px-3 py-2.5 hover:border-faint"
          >
            <Mail className="size-5 shrink-0 text-ink-soft" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold">Open the email in Gmail</span>
              <span className="block truncate text-[12.5px] text-muted">
                {brief.email.from} · {shortDay(dayKey(new Date(brief.email.date)))} · {brief.email.subject}
              </span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-muted" />
          </a>
        )}

        {brief.todo.length > 0 && (
          <>
            <h3 className={`${heading} mt-4`}>What you need to do</h3>
            <ol className="mt-2 flex flex-col gap-2">
              {brief.todo.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[14.5px] leading-snug">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/[0.07] text-[11.5px] font-semibold text-ink-soft">
                    {i + 1}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{step}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        {brief.details.length > 0 && (
          <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[14px]">
            {brief.details.map((d, i) => (
              <Fragment key={i}>
                <dt className="text-muted">{d.label}</dt>
                <dd className="[overflow-wrap:anywhere]">{d.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </section>

      {brief.help.length > 0 && (
        <section aria-label="Atlas can do this for you">
          <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-teal">
            <Sparkle className="size-4" /> Atlas can do this for you
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {brief.help.map((h, i) =>
              open === i && results[i] ? (
                <li key={i}>
                  <HelpPanel
                    key={results[i].body}
                    task={t}
                    label={h.label}
                    result={results[i]}
                    rewriting={writing === i}
                    onRewrite={() => void write(i)}
                    onClose={() => setOpen(null)}
                    onAddNotes={onAddNotes}
                  />
                </li>
              ) : (
                <li key={i}>
                  <button
                    type="button"
                    disabled={writing !== null}
                    onClick={() => (results[i] ? setOpen(i) : void write(i))}
                    className="w-full rounded-xl border border-teal/35 bg-teal/[0.05] p-3 text-left hover:bg-teal/10 disabled:opacity-60"
                  >
                    <span className="block text-[14.5px] font-semibold">{h.label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">
                      {writing === i ? "Writing it…" : results[i] ? "Written earlier. Tap to see it." : h.detail}
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
          <p className="mt-2 text-[12.5px] text-faint">Nothing is sent. You check it first, then it goes to your Gmail drafts or this task&apos;s notes.</p>
        </section>
      )}
    </>
  );
}

const field = "w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14.5px] outline-none focus:border-faint";

/** What Atlas wrote, to check and change before it goes anywhere. */
function HelpPanel({
  task,
  label,
  result,
  rewriting,
  onRewrite,
  onClose,
  onAddNotes,
}: {
  task: Task;
  label: string;
  result: HelpResult;
  rewriting: boolean;
  onRewrite: () => void;
  onClose: () => void;
  onAddNotes: (task: Task, text: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const [to, setTo] = useState(result.to);
  const [subject, setSubject] = useState(result.subject);
  const [body, setBody] = useState(result.body);
  const [busy, setBusy] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const isEmail = result.kind !== "write";

  async function saveDraft() {
    setBusy(true);
    const res = await saveHelpDraft(task.id, { kind: result.kind === "reply" ? "reply" : "email", to, subject, body }).catch(() => ({
      ok: false as const,
      error: "Couldn't reach Atlas. Try again.",
    }));
    setBusy(false);
    if (!res.ok) return toast({ message: res.error });
    setDraftUrl(res.url);
    toast({ message: "Saved to your Gmail drafts", actionLabel: "Open", onAction: () => openGmail(res.url) });
  }

  async function addToNotes() {
    setBusy(true);
    const ok = await onAddNotes(task, `${subject}\n${body}`);
    setBusy(false);
    if (ok) toast({ message: "Added to the task's notes" });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(isEmail ? body : `${subject}\n${body}`);
      toast({ message: "Copied" });
    } catch {
      toast({ message: "Couldn't copy. Select the text instead." });
    }
  }

  return (
    <div className="rounded-xl border border-teal/40 bg-card p-3">
      <p className="text-[13.5px] font-semibold text-teal">{label}</p>
      <div className="mt-2.5 flex flex-col gap-2">
        {isEmail && (
          <>
            <input aria-label="To" placeholder="To (add the address)" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
            <input aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
          </>
        )}
        {!isEmail && <p className="text-[14.5px] font-semibold">{subject}</p>}
        <textarea
          aria-label={isEmail ? "Message" : "Text"}
          value={body}
          rows={Math.min(14, Math.max(6, body.split("\n").length + 1))}
          onChange={(e) => setBody(e.target.value)}
          className={`${field} resize-y leading-relaxed`}
        />
      </div>
      {draftUrl && (
        <a {...gmailLinkProps(draftUrl)} className="mt-2 flex items-center gap-1.5 text-[13.5px] text-teal hover:underline">
          Saved. Open it in Gmail to check and send <ExternalLink className="size-3.5" />
        </a>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isEmail ? (
          <button
            type="button"
            disabled={busy || !body.trim() || draftUrl !== null}
            onClick={() => void saveDraft()}
            className="h-10 rounded-xl bg-teal px-4 text-[14px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Saving…" : draftUrl ? "Saved to drafts" : "Save to Gmail drafts"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !body.trim()}
            onClick={() => void addToNotes()}
            className="h-10 rounded-xl bg-teal px-4 text-[14px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add to notes"}
          </button>
        )}
        <button type="button" onClick={() => void copy()} className={button}>
          Copy
        </button>
        <button type="button" disabled={rewriting} onClick={onRewrite} className={button}>
          <RefreshCw className={`size-4 ${rewriting ? "animate-spin" : ""}`} /> {rewriting ? "Writing…" : "Write again"}
        </button>
        <button type="button" onClick={onClose} className="h-10 px-2 text-[14px] text-muted hover:text-ink">
          Close
        </button>
      </div>
    </div>
  );
}
