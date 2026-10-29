"use client";

import { ExternalLink, Landmark, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { connectUp, disconnectUp, syncUpNow } from "@/app/(app)/money/actions";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { clock } from "@/lib/format";
import { dayKey, shortDay } from "@/lib/life/days";
import { money } from "@/lib/money/types";

// Up Bank, pulled in by itself: connecting with a personal access token (pasted in by me,
// stored sealed on the server, never sent back to the page), and what's synced since.

export interface UpStatus {
  /** Up calls Atlas on every transaction; otherwise Atlas catches up each morning and on Sync now. */
  live: boolean;
  lastSyncAt: number | null;
  accounts: { name: string; type: string; balanceCents: number }[];
  error: string | null;
}

function syncedLabel(at: number | null, today: string) {
  if (at === null) return "not synced yet";
  const day = dayKey(new Date(at));
  return `synced ${day === today ? clock(new Date(at)) : shortDay(day)}`;
}

const button = "flex h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[14.5px] font-medium hover:border-faint hover:bg-white/[0.03]";

interface UpConnectProps {
  status: UpStatus | null;
  today: string;
  onChanged: () => void;
}

export function UpConnect({ status, today, onChanged }: UpConnectProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sure, setSure] = useState(false);

  function close() {
    setOpen(false);
    setProblem(null);
    setSure(false);
  }

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const token = String(new FormData(form).get("token") ?? "").trim();
    if (!token || busy) return;
    setBusy("connect");
    setProblem(null);
    const res = await connectUp(token).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    setBusy(null);
    if (!res.ok) return setProblem(res.error);
    form.reset();
    close();
    const matched = res.linked ? `, ${res.linked} matched to your CSVs` : "";
    toast({ message: `Up connected: ${res.added} new${matched}${res.done ? "" : ", more coming"}` });
    onChanged();
  }

  async function sync() {
    setBusy("sync");
    const res = await syncUpNow().catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    setBusy(null);
    if (!res.ok) return setProblem(res.error);
    toast({ message: res.added ? `Synced: ${res.added} new` : "Up is up to date" });
    onChanged();
  }

  async function disconnect() {
    if (!sure) return setSure(true);
    setBusy("disconnect");
    const res = await disconnectUp().catch(() => ({ ok: false as const }));
    setBusy(null);
    if (!res.ok) return setProblem("Couldn't disconnect. Try again.");
    close();
    toast({ message: "Up disconnected. Your transactions stay." });
    onChanged();
  }

  const accounts = status ? [...status.accounts].sort((a, b) => Number(b.type === "TRANSACTIONAL") - Number(a.type === "TRANSACTIONAL")) : [];

  return (
    <>
      {status ? (
        <button type="button" onClick={() => setOpen(true)} className={button} title="Up Bank sync">
          <span aria-hidden="true" className={`size-2 rounded-full ${status.error ? "bg-amber" : "bg-green"}`} />
          Up · {syncedLabel(status.lastSyncAt, today)}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={button}>
          <Landmark className="size-[18px]" strokeWidth={1.75} /> Connect Up
        </button>
      )}

      <Dialog open={open} onClose={close} title={status ? "Up Bank" : "Connect Up Bank"} width={500}>
        {status ? (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-[19px] font-bold tracking-tight">Up Bank</h2>
              <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
                {status.live ? "New transactions arrive as they happen" : "Atlas catches up each morning and when you sync"}, and new merchants get
                sorted. Last {syncedLabel(status.lastSyncAt, today)}.
              </p>
            </div>
            {status.error && <p className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[13.5px] text-ink">{status.error}</p>}
            {accounts.length > 0 && (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {accounts.map((a) => (
                  <li key={a.name} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[14.5px]">
                    <span className="min-w-0 truncate">{a.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-soft">{money(a.balanceCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {problem && (
              <p role="alert" className="text-[13.5px] text-amber">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={busy !== null}
                className={`h-10 rounded-xl px-3 text-[14.5px] disabled:opacity-40 ${sure ? "text-red" : "text-ink-soft hover:text-red"}`}
              >
                {busy === "disconnect" ? "Disconnecting…" : sure ? "Sure? Disconnect" : "Disconnect"}
              </button>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={close} className="h-10 rounded-xl px-4 text-[14.5px] text-ink-soft hover:text-ink">
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void sync()}
                  disabled={busy !== null}
                  className="flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
                >
                  <RefreshCw className={`size-4 ${busy === "sync" ? "animate-spin" : ""}`} /> {busy === "sync" ? "Syncing…" : "Sync now"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void connect(e)} className="flex flex-col gap-4">
            <div>
              <h2 className="text-[19px] font-bold tracking-tight">Connect Up Bank</h2>
              <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
                Atlas pulls in your Up transactions by itself, each one as it happens, plus a catch-up every morning. No more CSVs.
              </p>
            </div>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14.5px] leading-relaxed text-ink-soft">
              <li>
                Open{" "}
                <a
                  href="https://api.up.com.au/getting_started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-teal underline underline-offset-2"
                >
                  api.up.com.au/getting_started <ExternalLink className="size-3.5" />
                </a>{" "}
                and follow the steps with your Up app.
              </li>
              <li>
                Copy the personal access token it gives you. It starts with <span className="font-mono text-[13.5px] text-ink">up:yeah:</span>
              </li>
              <li>Paste it here.</li>
            </ol>
            <input
              name="token"
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="up:yeah:…"
              aria-label="Up personal access token"
              className="h-11 rounded-xl border border-line-strong bg-card px-3.5 font-mono text-[14px] text-ink outline-none placeholder:text-faint focus:border-ink/40"
            />
            {problem && (
              <p role="alert" className="-mt-2 text-[13.5px] text-amber">
                {problem}
              </p>
            )}
            <p className="-mt-1 text-[12.5px] leading-relaxed text-faint">
              Atlas keeps the token encrypted and only reads your accounts and transactions. Disconnect here any time; making a new token in Up also
              switches this one off.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="h-10 rounded-xl px-4 text-[14.5px] text-ink-soft hover:text-ink">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy !== null}
                className="h-10 rounded-xl bg-ink px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
              >
                {busy === "connect" ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
