"use client";

import { ArrowUp, FileText, Mail, Plus, StickyNote, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { askAtlas, removeNote, saveNote, type AskResult } from "@/app/(app)/notes/actions";
import { IconButton } from "@/components/icon-button";
import { Sparkle } from "@/components/sparkle";
import { useToast } from "@/components/toast";
import { daysBetween, listTime } from "@/lib/format";
import type { Note, NoteTag } from "@/lib/life/notes";
import { searchWords } from "@/lib/search-words";
import { SAVE_LABEL, useAutosave } from "@/lib/use-autosave";
import { useHydrated } from "@/lib/use-hydrated";

const TAG_COLORS: Record<NoteTag, string> = {
  Bricklaying: "#f5a524",
  "Henty Lodge": "#a78bfa",
  Trading: "#60a5fa",
  Home: "#4ade80",
  Ideas: "#f472b6",
};

const EXAMPLE_QUESTION = "What did the supplier quote for face bricks?";

function TagChip({ tag }: { tag: NoteTag }) {
  const color = TAG_COLORS[tag];
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[11.5px] font-medium"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}14` }}
    >
      {tag}
    </span>
  );
}

function shortDate(iso: string | number, now: Date | null) {
  if (!now) return "";
  const d = new Date(iso);
  if (daysBetween(d, now) === 0) return "Today";
  return listTime(d.toISOString(), now);
}

interface NotesProps {
  notes: Note[];
  tags: NoteTag[];
  emailConnected: boolean;
  openNoteId: string | null;
}

type Draft = { title: string; body: string; tag: NoteTag | null };

export function Notes({ notes: initial, tags, emailConnected, openNoteId }: NotesProps) {
  const toast = useToast();
  const hydrated = useHydrated();
  const now = hydrated ? new Date() : null;
  const [notes, setNotes] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(openNoteId && initial.some((n) => n.id === openNoteId) ? openNoteId : null);
  const [tag, setTag] = useState<NoteTag | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; result: AskResult } | null>(null);

  const { state, queue, flush } = useAutosave<Draft>(async (id, draft) => {
    const res = await saveNote({ id, ...draft });
    return res.ok;
  });

  const open = notes.find((n) => n.id === openId) ?? null;
  // Filter on the question's key words, so "what did the supplier quote" still finds the supplier note.
  const words = searchWords(question);
  const shown = notes.filter((n) => {
    if (tag && n.tag !== tag) return false;
    const text = `${n.title}\n${n.body}`.toLowerCase();
    return words.length === 0 || words.some((w) => text.includes(w));
  });

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    const result = await askAtlas(q).catch((): AskResult => ({ ok: false, error: "Couldn't reach Atlas. Try again." }));
    setAnswer({ question: question, result });
    setAsking(false);
  }

  async function newNote() {
    await flush();
    const res = await saveNote({ title: "", body: "", tag }).catch(() => ({ ok: false as const }));
    if (!res.ok || !("createdAt" in res)) return toast({ message: "Couldn't create a note" });
    const note: Note = { id: res.id, title: "", body: "", tag, createdAt: res.createdAt, updatedAt: res.createdAt };
    setNotes((all) => [note, ...all]);
    setOpenId(note.id);
  }

  function edit(patch: Partial<Draft>) {
    if (!open) return;
    const next = { ...open, ...patch, updatedAt: Date.now() };
    setNotes((all) => all.map((n) => (n.id === open.id ? next : n)));
    queue(open.id, { title: next.title, body: next.body, tag: next.tag });
  }

  async function close() {
    await flush();
    // A note left completely empty isn't worth keeping.
    if (open && !open.title.trim() && !open.body.trim()) {
      await removeNote(open.id).catch(() => null);
      setNotes((all) => all.filter((n) => n.id !== open.id));
    }
    setOpenId(null);
  }

  async function remove(note: Note) {
    if (!window.confirm(`Delete "${note.title || "Untitled note"}"? This can't be undone.`)) return;
    const res = await removeNote(note.id).catch(() => ({ ok: false as const }));
    if (!res.ok) return toast({ message: "Couldn't delete that note" });
    setNotes((all) => all.filter((n) => n.id !== note.id));
    setOpenId(null);
    toast({ message: "Note deleted" });
  }

  const counts = Object.fromEntries(tags.map((t) => [t, notes.filter((n) => n.tag === t).length]));

  return (
    <div className="flex h-full min-h-0 gap-3 p-3 pb-[84px] md:pb-3">
      <section
        aria-label="Notes"
        className={`${open ? "hidden xl:flex" : "flex"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-5 scroll-thin md:p-6`}
      >
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-[34px] leading-none font-bold tracking-tight">Notes</h1>
          <button
            type="button"
            onClick={() => void newNote()}
            className="flex h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[14.5px] hover:border-faint"
          >
            <Plus className="size-[18px]" /> New note
          </button>
        </header>

        <form onSubmit={ask} className="mt-5">
          <label htmlFor="ask" className="sr-only">
            Ask Atlas, or filter your notes
          </label>
          <div className="flex items-center gap-3 rounded-2xl border border-line-strong bg-card px-4 py-2 focus-within:border-teal/60">
            <Sparkle className="size-6" glow />
            <input
              id="ask"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Ask about your notes${emailConnected ? " and email" : ""}, e.g. "${EXAMPLE_QUESTION}"`}
              className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
            />
            {question && (
              <IconButton
                label="Clear"
                onClick={() => {
                  setQuestion("");
                  setAnswer(null);
                }}
              >
                <X className="size-4" />
              </IconButton>
            )}
            <button
              type="submit"
              aria-label="Ask Atlas"
              disabled={!question.trim() || asking}
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal text-canvas transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              <ArrowUp className="size-5" strokeWidth={2.5} />
            </button>
          </div>
          <p className="mt-2 px-1 text-[12.5px] text-faint">
            Typing filters your notes. Press Enter to ask Atlas, which answers from your notes
            {emailConnected ? " and the last year of email" : ""}.
          </p>
        </form>

        {(asking || answer) && <AnswerCard asking={asking} answer={answer} onOpenNote={setOpenId} now={now} />}

        <div className="mt-6 flex flex-col gap-5 lg:flex-row">
          <nav aria-label="Filter by tag" className="flex shrink-0 flex-wrap gap-1.5 lg:w-40 lg:flex-col lg:gap-0.5">
            {[null, ...tags].map((t) => {
              const active = tag === t;
              return (
                <button
                  key={t ?? "all"}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTag(t)}
                  className={`flex h-9 items-center justify-between gap-3 rounded-lg px-3 text-left text-[14px] transition-colors ${
                    active ? "bg-active text-ink" : "text-ink-soft hover:bg-white/[0.04] hover:text-ink"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {t && <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: TAG_COLORS[t] }} />}
                    {t ?? "All notes"}
                  </span>
                  <span className="text-[12.5px] text-faint tabular-nums">{t ? counts[t] : notes.length}</span>
                </button>
              );
            })}
          </nav>

          <ul className="grid min-w-0 flex-1 content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {shown.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(n.id)}
                  aria-current={n.id === openId ? "true" : undefined}
                  className={`flex h-full w-full flex-col rounded-xl border bg-card p-4 text-left transition-colors ${
                    n.id === openId ? "border-teal/70" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="truncate text-[15.5px] font-semibold">{n.title.trim() || "Untitled note"}</span>
                  <span className="mt-1.5 line-clamp-2 min-h-[2.6em] text-[13.5px] leading-snug text-muted">
                    {n.body.trim() || "Empty note"}
                  </span>
                  <span className="mt-3 flex items-center justify-between gap-2 text-[12.5px] text-faint">
                    {shortDate(n.updatedAt, now)}
                    {n.tag && <TagChip tag={n.tag} />}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="col-span-full rounded-xl border border-dashed border-line-strong p-8 text-center">
                <StickyNote className="mx-auto size-8 text-faint" strokeWidth={1.4} />
                <p className="mt-3 font-semibold">{notes.length === 0 ? "No notes yet" : "No notes match"}</p>
                <p className="mt-1 text-[14px] text-muted">
                  {notes.length === 0
                    ? "Jot down supplier prices, job details, ideas. Atlas can answer questions from them later."
                    : "Try another word or tag, or press Enter to ask Atlas."}
                </p>
              </li>
            )}
          </ul>
        </div>
      </section>

      {open && (
        <aside
          aria-label="Note"
          className="flex min-h-0 w-full min-w-0 flex-col rounded-2xl border border-line bg-panel xl:w-[480px] xl:shrink-0"
        >
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
            <IconButton label="Close note" onClick={() => void close()}>
              <X className="size-[22px]" strokeWidth={1.75} />
            </IconButton>
            <p role="status" className={`text-[13px] ${state === "error" ? "text-amber" : "text-muted"}`}>
              {SAVE_LABEL[state]}
            </p>
            <IconButton label="Delete note" onClick={() => void remove(open)}>
              <Trash2 className="size-[20px]" strokeWidth={1.75} />
            </IconButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 scroll-thin">
            <input
              key={`title-${open.id}`}
              autoFocus={!open.title}
              value={open.title}
              maxLength={300}
              onChange={(e) => edit({ title: e.target.value })}
              placeholder="Title"
              aria-label="Title"
              className="w-full bg-transparent text-[24px] font-bold tracking-tight outline-none placeholder:text-faint"
            />
            <div role="group" aria-label="Tag" className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const active = open.tag === t;
                const color = TAG_COLORS[t];
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    onClick={() => edit({ tag: active ? null : t })}
                    className="rounded-full border px-2.5 py-1 text-[12.5px] transition-colors"
                    style={
                      active
                        ? { color, borderColor: `${color}99`, backgroundColor: `${color}1f` }
                        : { color: "#8b93a3", borderColor: "#2a2f3a" }
                    }
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <textarea
              key={`body-${open.id}`}
              value={open.body}
              onChange={(e) => edit({ body: e.target.value })}
              placeholder="Write anything…"
              aria-label="Note"
              className="mt-5 min-h-[40vh] w-full flex-1 resize-none bg-transparent text-[16.5px] leading-[1.75] text-ink outline-none placeholder:text-faint [field-sizing:content]"
            />
          </div>
        </aside>
      )}
    </div>
  );
}

interface AnswerCardProps {
  asking: boolean;
  answer: { question: string; result: AskResult } | null;
  onOpenNote: (id: string) => void;
  now: Date | null;
}

function AnswerCard({ asking, answer, onOpenNote, now }: AnswerCardProps) {
  if (asking) {
    return (
      <section role="status" aria-label="Atlas answer" className="mt-4 rounded-xl border border-l-[3px] border-line border-l-teal bg-card p-5">
        <p className="flex items-center gap-2 text-[14.5px] text-teal">
          <Sparkle className="size-4 animate-shimmer" /> Looking through your notes and email…
        </p>
        <span className="mt-3 block h-3 w-3/4 animate-shimmer rounded-full bg-raised" />
      </section>
    );
  }
  if (!answer) return null;
  const { result } = answer;
  if (!result.ok) {
    return <p className="mt-4 rounded-xl border border-amber/40 bg-amber/[0.07] px-4 py-3 text-[14px]">{result.error}</p>;
  }
  return (
    <section aria-label="Atlas answer" className="mt-4 rounded-xl border border-l-[3px] border-line border-l-teal bg-card p-5">
      <div className="flex gap-4">
        <Sparkle className="mt-0.5 size-7" glow />
        <div className="min-w-0 flex-1">
          <p className={`text-[16px] leading-relaxed ${result.found ? "text-ink" : "text-ink-soft"}`}>{result.answer}</p>
          {result.sources.length > 0 && (
            <ul aria-label="Sources" className="mt-3 flex flex-wrap gap-2">
              {result.sources.map((s) => (
                <li key={s.ref}>
                  {s.kind === "email" ? (
                    <Link
                      href={`/inbox?thread=${s.threadId}`}
                      title={s.title}
                      className="flex max-w-72 items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ink-soft hover:border-faint hover:text-ink"
                    >
                      <Mail className="size-3.5 shrink-0" />
                      <span className="truncate">
                        Email · {s.from} · {shortDate(s.date, now)}
                      </span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenNote(s.noteId)}
                      className="flex max-w-72 items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ink-soft hover:border-faint hover:text-ink"
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">
                        Note · {s.title} · {shortDate(s.date, now)}
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
