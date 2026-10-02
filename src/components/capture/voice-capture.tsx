"use client";

import { Check, CheckSquare, FileText, Flame, Keyboard, Mic, NotebookPen, Pencil, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { saveCaptureItem, understandCapture, type CaptureKind, type CaptureSuggestion } from "@/app/(app)/capture/actions";
import { Dialog } from "@/components/dialog";
import { Sparkle } from "@/components/sparkle";
import { dayKey, shortDay } from "@/lib/life/days";

// Voice capture: speak, Atlas suggests tasks / notes / journal lines / habit ticks,
// and each one waits for Approve, Edit or Dismiss. Speech-to-text is the browser's
// own (Chrome sends audio to Google to transcribe); only the text reaches Atlas.

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

// Browsers only offer the microphone on secure (https or localhost) pages; on plain
// http they refuse without ever asking, so treat voice as unavailable there.
const INSECURE_MESSAGE =
  "Voice needs a secure (https) link. On this http address the browser won't offer the microphone, so type it for now.";

function speechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type MicCheck = "missing" | "blocked" | "ok";

/**
 * Chrome answers "not-allowed" for a blocked site permission, for no microphone at all
 * (e.g. a Remote Desktop session without mic redirection) and, on Android, for a busy or
 * blocked speech service, so look at which one it really is before saying so.
 */
async function checkMic(): Promise<MicCheck> {
  const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => null);
  if (devices && !devices.some((d) => d.kind === "audioinput")) return "missing";
  const state = await navigator.permissions.query({ name: "microphone" as PermissionName }).then(
    (s) => s.state,
    () => null,
  );
  return state === "granted" ? "ok" : "blocked";
}

function voiceProblem(code: string, mic: MicCheck | null): string {
  const android = /Android/i.test(navigator.userAgent);
  if (code === "not-allowed" || code === "service-not-allowed") {
    if (mic === "missing") {
      return android
        ? "This phone isn't giving Chrome a microphone. Type it here instead."
        : "No microphone found on this computer. Plug one in, or on Remote Desktop turn on its mic (Show Options → Local Resources → Remote audio → Settings → Record from this computer). Or type it here.";
    }
    if (mic === "blocked") {
      return "The microphone is blocked for Atlas. Use the icon left of the address → Microphone → Allow, then try again. Or type it here.";
    }
    return android
      ? `Chrome has the microphone, but Android's speech-to-text refused (${code}). Check the Google app is allowed the microphone: Settings → Apps → Google → Permissions → Microphone. Meanwhile the mic key on your keyboard works in this box.`
      : `Chrome has the microphone, but its speech-to-text refused (${code}). Check Windows Settings → Privacy & security → Microphone is on for desktop apps, and no other app is holding the mic. Or type it here.`;
  }
  if (code === "audio-capture") return "Couldn't open the microphone. Another app may be using it (audio-capture).";
  if (code === "network") return "Speech-to-text needs an internet connection (network).";
  return `Voice stopped working (${code}). Tap Stop to use what was heard, or type instead.`;
}

const CaptureContext = createContext<(() => void) | null>(null);

export function useVoiceCapture() {
  const open = useContext(CaptureContext);
  if (!open) throw new Error("useVoiceCapture must be used inside <VoiceCaptureProvider>");
  return open;
}

export function VoiceCaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // A fresh session each time it opens.
  const [session, setSession] = useState(0);
  return (
    <CaptureContext.Provider
      value={() => {
        setSession((s) => s + 1);
        setOpen(true);
      }}
    >
      {children}
      <Dialog open={open} onClose={() => setOpen(false)} title="Voice note">
        {open && <CaptureFlow key={session} onClose={() => setOpen(false)} />}
      </Dialog>
    </CaptureContext.Provider>
  );
}

const KINDS: Record<CaptureKind, { label: string; icon: typeof Mic }> = {
  task: { label: "Task", icon: CheckSquare },
  note: { label: "Note", icon: FileText },
  journal: { label: "Journal", icon: NotebookPen },
  habit: { label: "Habit", icon: Flame },
};

type Phase = "listening" | "typing" | "thinking" | "review";
type ItemState = "pending" | "saving" | "saved" | "dismissed" | "failed";

function CaptureFlow({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [Recognition] = useState(speechRecognition);
  const [phase, setPhase] = useState<Phase>(Recognition ? "listening" : "typing");
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string | null>(
    Recognition ? null : window.isSecureContext ? "Voice isn't available in this browser, so type it instead." : INSECURE_MESSAGE,
  );
  const [items, setItems] = useState<{ item: CaptureSuggestion; state: ItemState; editing: boolean }[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // Phrases finished in earlier listening sessions, plus the session in progress.
  const heard = useRef({ committed: "", final: "", interim: "" });
  const [today] = useState(() => dayKey(new Date()));

  // Listen phrase by phrase and start again after each pause until Stop is tapped.
  // Chrome on Android stops "continuous" listening at the first pause and can repeat
  // words in it, so short sessions chained together behave the same on phone and PC.
  useEffect(() => {
    if (!Recognition || phase !== "listening") return;
    const Speech: SpeechRecognitionCtor = Recognition;
    let alive = true;
    let keepGoing = true;
    let quietSessions = 0;
    let refusals = 0;
    let next: ReturnType<typeof setTimeout> | undefined;

    // Android reports a speech service that's still busy as "not-allowed", the same as
    // a blocked mic, so each start waits a moment (this also stops React's dev-mode
    // double run from starting a session and aborting it straight away).
    const later = (ms: number) => {
      next = setTimeout(begin, ms);
    };

    async function giveUp(code: string) {
      keepGoing = false;
      const mic = code === "not-allowed" || code === "service-not-allowed" ? await checkMic() : null;
      if (!alive) return;
      setProblem(voiceProblem(code, mic));
      if (!heard.current.committed) setPhase("typing");
    }

    function begin() {
      if (!keepGoing) return;
      const rec = new Speech();
      let refused: string | null = null;
      rec.lang = "en-AU";
      rec.continuous = false;
      rec.interimResults = true;
      rec.onresult = (e) => {
        refusals = 0;
        let final = "";
        let pending = "";
        for (const r of Array.from(e.results)) {
          if (r.isFinal) final += r[0].transcript;
          else pending += r[0].transcript;
        }
        heard.current = { ...heard.current, final: final.trim(), interim: pending.trim() };
        setFinalText(`${heard.current.committed} ${heard.current.final}`.trim());
        setInterim(heard.current.interim);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") refused = e.error;
        else if (e.error !== "no-speech" && e.error !== "aborted") void giveUp(e.error);
      };
      rec.onend = () => {
        const { committed, final } = heard.current;
        heard.current = { committed: `${committed} ${final}`.trim(), final: "", interim: "" };
        setInterim("");
        if (!keepGoing) return;
        if (refused) {
          // Try a few times before calling it blocked: it's usually the service still busy.
          refusals += 1;
          if (refusals >= 3) void giveUp(refused);
          else later(700);
          return;
        }
        // Two silent sessions in a row: pause rather than restarting forever.
        quietSessions = final ? 0 : quietSessions + 1;
        if (quietSessions >= 2) {
          keepGoing = false;
          setProblem("Paused. Tap Stop to use what was heard, or Type instead.");
          return;
        }
        later(250);
      };
      recognition.current = rec;
      rec.start();
    }

    later(60);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      alive = false;
      keepGoing = false;
      clearTimeout(next);
      clearInterval(timer);
      const rec = recognition.current;
      if (rec) {
        rec.onend = null;
        rec.onerror = null;
        rec.abort();
      }
    };
  }, [Recognition, phase]);

  async function understand(text: string) {
    const transcript = text.trim();
    if (!transcript) {
      setProblem("Didn't catch anything. Type it, or close and tap the mic again.");
      setPhase("typing");
      return;
    }
    setPhase("thinking");
    const res = await understandCapture(transcript, today).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    if (!res.ok) {
      setProblem(res.error);
      setTyped(transcript);
      setPhase("typing");
      return;
    }
    setItems(res.items.map((item) => ({ item, state: "pending", editing: false })));
    setFinalText(transcript);
    setPhase("review");
  }

  function stopListening() {
    const { committed, final, interim: pending } = heard.current;
    const rec = recognition.current;
    if (rec) {
      rec.onend = null;
      rec.abort();
    }
    void understand(`${committed} ${final} ${pending}`);
  }

  function patch(index: number, change: Partial<{ item: CaptureSuggestion; state: ItemState; editing: boolean }>) {
    setItems((all) => all.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  async function approve(index: number) {
    patch(index, { state: "saving", editing: false });
    const res = await saveCaptureItem(items[index].item, today).catch(() => ({ ok: false as const }));
    patch(index, { state: res.ok ? "saved" : "failed" });
    if (res.ok) router.refresh();
  }

  async function approveAll() {
    for (const [i, row] of items.entries()) if (row.state === "pending" || row.state === "failed") await approve(i);
  }

  const open = items.filter((r) => r.state === "pending" || r.state === "failed").length;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Sparkle className="size-7" glow />
        <h2 className="text-[20px] font-bold tracking-tight">Voice note</h2>
      </div>

      {phase === "listening" && (
        <div className="mt-5">
          <p aria-live="polite" className="min-h-24 text-[20px] leading-snug">
            {finalText} <span className="text-muted">{interim}</span>
            {!finalText && !interim && <span className="text-muted">Listening… say a task, a note, how the day went, or a habit you did.</span>}
          </p>
          <div aria-hidden="true" className="mt-6 flex h-12 items-center justify-center gap-1.5">
            {Array.from({ length: 18 }, (_, i) => (
              <span
                key={i}
                className="w-1.5 animate-shimmer rounded-full bg-teal"
                style={{ height: `${20 + ((i * 37) % 60)}%`, animationDelay: `${(i % 6) * 110}ms` }}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-[14px] text-muted tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </p>
          {problem && <p className="mt-3 text-center text-[13.5px] text-amber">{problem}</p>}
          <div className="mt-5 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={stopListening}
              aria-label="Stop and let Atlas sort it"
              className="grid size-16 place-items-center rounded-full bg-red text-canvas shadow-lg shadow-red/20 hover:opacity-90"
            >
              <Square className="size-6" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => {
                setTyped(`${finalText} ${interim}`.trim());
                setPhase("typing");
              }}
              className="flex items-center gap-1.5 text-[13.5px] text-muted hover:text-ink"
            >
              <Keyboard className="size-4" /> Type instead
            </button>
          </div>
        </div>
      )}

      {phase === "typing" && (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void understand(typed);
          }}
        >
          {problem && <p className="mb-3 text-[13.5px] text-amber">{problem}</p>}
          <textarea
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={5000}
            placeholder="e.g. Order 2,000 bricks for Hillview tomorrow. Did my workout. Note: Coastal quoted $1.18 a brick."
            aria-label="What do you want to capture?"
            className="block min-h-36 w-full resize-none rounded-xl border border-line-strong bg-card p-4 text-[16px] leading-relaxed outline-none placeholder:text-faint focus:border-faint"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-[15px] text-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!typed.trim()}
              className="h-11 rounded-xl bg-teal px-5 text-[15px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
            >
              Sort it out
            </button>
          </div>
        </form>
      )}

      {phase === "thinking" && (
        <div role="status" className="mt-6">
          <p className="flex items-center gap-2 text-[15px] text-teal">
            <Sparkle className="size-4 animate-shimmer" /> Atlas is sorting that out…
          </p>
          <p className="mt-3 text-[15px] text-muted">&ldquo;{finalText || typed}&rdquo;</p>
        </div>
      )}

      {phase === "review" && (
        <div className="mt-5">
          <p className="text-[14px] text-muted">&ldquo;{finalText}&rdquo;</p>
          {items.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[14.5px] text-muted">
              Atlas didn&apos;t find anything to save in that.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2.5">
              {items.map((row, i) =>
                row.state === "dismissed" ? null : (
                  <CaptureCard
                    key={i}
                    row={row}
                    today={today}
                    onChange={(item) => patch(i, { item })}
                    onApprove={() => void approve(i)}
                    onEdit={() => patch(i, { editing: !row.editing })}
                    onDismiss={() => patch(i, { state: "dismissed" })}
                  />
                ),
              )}
            </ul>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="h-11 rounded-xl px-4 text-[15px] text-muted hover:text-ink">
              {open === 0 ? "Done" : "Close"}
            </button>
            {open > 1 && (
              <button
                type="button"
                onClick={() => void approveAll()}
                className="h-11 rounded-xl bg-teal px-5 text-[15px] font-semibold text-canvas hover:opacity-90"
              >
                Approve all {open}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface CaptureCardProps {
  row: { item: CaptureSuggestion; state: ItemState; editing: boolean };
  today: string;
  onChange: (item: CaptureSuggestion) => void;
  onApprove: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}

function CaptureCard({ row, today, onChange, onApprove, onEdit, onDismiss }: CaptureCardProps) {
  const { item, state, editing } = row;
  const { label, icon: Icon } = KINDS[item.kind];
  const saved = state === "saved";
  const field = "w-full rounded-lg border border-line-strong bg-card px-3 py-2 text-[14.5px] outline-none focus:border-faint";

  return (
    <li className={`rounded-xl border border-l-[3px] border-line border-l-teal bg-card p-4 ${saved ? "opacity-70" : ""}`}>
      <p className="flex items-center gap-2 text-[12.5px] font-semibold tracking-wide text-muted uppercase">
        <Icon className="size-4" /> {label}
        {item.kind === "task" && item.dueDay && (
          <span className={`rounded-full border px-2 py-px text-[11.5px] normal-case ${item.dueDay <= today ? "border-amber/50 text-amber" : "border-line-strong"}`}>
            {item.dueDay === today ? "Today" : shortDay(item.dueDay)}
          </span>
        )}
        {item.tag && (item.kind === "note" || (item.kind === "task" && item.tag !== "Ideas")) && <span className="rounded-full border border-line-strong px-2 py-px text-[11.5px] normal-case">{item.tag}</span>}
      </p>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          {item.kind !== "journal" && (
            <input aria-label="Title" value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })} disabled={item.kind === "habit"} className={field} />
          )}
          {(item.kind === "note" || item.kind === "journal") && (
            <textarea aria-label="Text" value={item.body} onChange={(e) => onChange({ ...item, body: e.target.value })} rows={3} className={`${field} resize-none`} />
          )}
          {item.kind === "task" && (
            <input
              type="date"
              aria-label="Due date"
              value={item.dueDay ?? ""}
              onChange={(e) => onChange({ ...item, dueDay: e.target.value || null })}
              className={`${field} [color-scheme:dark]`}
            />
          )}
        </div>
      ) : (
        <>
          {item.title && item.kind !== "journal" && <p className="mt-1.5 text-[15.5px] font-semibold">{item.kind === "habit" ? `Done today: ${item.title}` : item.title}</p>}
          {item.body && <p className="mt-1 text-[14.5px] leading-relaxed whitespace-pre-line text-ink-soft">{item.body}</p>}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {saved ? (
          <p className="flex items-center gap-1.5 text-[14px] text-green">
            <Check className="size-4" /> Saved
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={onApprove}
              disabled={state === "saving"}
              className="h-9 rounded-lg bg-teal px-4 text-[14px] font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
            >
              {state === "saving" ? "Saving…" : "Approve"}
            </button>
            <button type="button" onClick={onEdit} className="flex h-9 items-center gap-1.5 rounded-lg border border-teal/60 px-3 text-[14px] hover:bg-teal/10">
              <Pencil className="size-3.5" /> {editing ? "Done" : "Edit"}
            </button>
            <button type="button" onClick={onDismiss} className="h-9 rounded-lg px-3 text-[14px] text-muted hover:text-ink">
              Dismiss
            </button>
            {state === "failed" && <span className="text-[13px] text-amber">Couldn&apos;t save. Try again.</span>}
          </>
        )}
      </div>
    </li>
  );
}

/** The mic button: in the sidebar on desktop, in the middle of the bottom bar on phones. */
export function CaptureButton({ variant }: { variant: "sidebar" | "mobile" }) {
  const open = useVoiceCapture();
  if (variant === "mobile") {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Voice note"
        className="-mt-6 grid size-14 shrink-0 place-items-center rounded-full bg-teal text-canvas shadow-[0_0_24px_-6px_rgba(45,212,191,0.7)]"
      >
        <Mic className="size-6" strokeWidth={2.25} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      title="Voice note"
      className="flex h-12 w-full items-center gap-3.5 rounded-xl border border-teal/50 px-3.5 text-[15px] text-teal transition-colors hover:bg-teal/10 lg:px-4"
    >
      <Mic className="size-[22px] shrink-0" strokeWidth={1.75} />
      <span className="hidden lg:inline">Voice note</span>
    </button>
  );
}
