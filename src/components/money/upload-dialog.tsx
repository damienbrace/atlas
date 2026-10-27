"use client";

import { FileUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { beginUpload, finishUpload, removeUpload, uploadChunk } from "@/app/(app)/money/actions";
import { Dialog } from "@/components/dialog";
import { shortDay } from "@/lib/life/days";
import { detectMapping, parseCsv, readRows, type Mapping } from "@/lib/money/csv";
import { money, UPLOAD_CHUNK, type Upload } from "@/lib/money/types";

// Choose a bank CSV, check Atlas read the columns right (with a preview), then add it.
// The file is read in the browser and sent in chunks, so size isn't a problem.

interface Loaded {
  fileName: string;
  cells: string[][];
  mapping: Mapping | null;
}

const field = "h-10 w-full rounded-lg border border-line-strong bg-card px-3 text-[14.5px] text-ink outline-none focus:border-ink/40 [color-scheme:dark]";
const ROLES: { id: "date" | "description" | "amount" | "debit" | "credit" | "balance"; label: string; optional?: boolean }[] = [
  { id: "date", label: "Date" },
  { id: "description", label: "Description" },
  { id: "amount", label: "Amount (one column, minus = money out)", optional: true },
  { id: "debit", label: "Or: money out column", optional: true },
  { id: "credit", label: "And: money in column", optional: true },
  { id: "balance", label: "Balance", optional: true },
];

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  accounts: string[];
  uploads: Upload[];
  onDone: (result: { added: number; skipped: number; newMerchants: number }) => void;
  onRemoved: () => void;
}

export function UploadDialog({ open, onClose, accounts, uploads, onDone, onRemoved }: UploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [account, setAccount] = useState(accounts[0] ?? "Everyday");
  const [editColumns, setEditColumns] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  function reset() {
    setLoaded(null);
    setEditColumns(false);
    setError(null);
    setConfirmRemove(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 20_000_000) return setError("That file is over 20MB, which is more than a bank export should be.");
    const cells = parseCsv(await file.text());
    if (cells.length === 0) return setError("That file looks empty.");
    const mapping = detectMapping(cells);
    setLoaded({ fileName: file.name, cells, mapping });
    setEditColumns(mapping === null);
  }

  const parsed = loaded?.mapping ? readRows(loaded.cells, loaded.mapping) : null;
  const days = parsed?.rows.map((r) => r.day).sort() ?? [];

  function setMapping(patch: Partial<Mapping>) {
    if (!loaded) return;
    const base: Mapping = loaded.mapping ?? {
      hasHeader: false,
      date: 0,
      description: 1,
      amount: 2,
      debit: null,
      credit: null,
      balance: null,
      dateOrder: "dmy",
      flip: false,
    };
    const next = { ...base, ...patch };
    // One amount column, or a debit and credit pair: picking one clears the other.
    if ("amount" in patch && patch.amount !== null) Object.assign(next, { debit: null, credit: null });
    if (("debit" in patch && patch.debit !== null) || ("credit" in patch && patch.credit !== null)) next.amount = null;
    setLoaded({ ...loaded, mapping: next });
  }

  async function add() {
    if (!loaded || !parsed || parsed.rows.length === 0) return;
    const name = account.trim();
    if (!name) return setError("Name the account, e.g. Everyday.");
    setError(null);
    try {
      setBusy("Starting…");
      const start = await beginUpload(loaded.fileName, name, parsed.rows.length);
      if (!start.ok) throw new Error();
      let added = 0;
      for (let i = 0; i < parsed.rows.length; i += UPLOAD_CHUNK) {
        setBusy(`Adding ${Math.min(i + UPLOAD_CHUNK, parsed.rows.length).toLocaleString("en-AU")} of ${parsed.rows.length.toLocaleString("en-AU")}…`);
        const res = await uploadChunk(start.uploadId, name, parsed.rows.slice(i, i + UPLOAD_CHUNK));
        if (!res.ok) throw new Error();
        added += res.added;
      }
      setBusy("Sorting with your rules…");
      const done = await finishUpload();
      if (!done.ok) throw new Error();
      onDone({ added, skipped: parsed.rows.length - added, newMerchants: done.newMerchants });
      reset();
    } catch {
      setError("Couldn't add that file. Anything already added stays; uploading it again skips duplicates.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(u: Upload) {
    if (confirmRemove !== u.id) return setConfirmRemove(u.id);
    setBusy("Removing…");
    const res = await removeUpload(u.id).catch(() => ({ ok: false as const }));
    setBusy(null);
    setConfirmRemove(null);
    if (res.ok) onRemoved();
    else setError("Couldn't remove that upload.");
  }

  const header = loaded?.mapping?.hasHeader ? loaded.cells[0] : null;
  const columnName = (i: number) => {
    const sample = loaded?.cells[loaded.mapping?.hasHeader ? 1 : 0]?.[i] ?? "";
    return `${header?.[i] || `Column ${i + 1}`}${sample ? `: ${sample.slice(0, 28)}` : ""}`;
  };
  const width = loaded ? Math.max(...loaded.cells.slice(0, 20).map((r) => r.length)) : 0;

  return (
    <Dialog
      open={open}
      width={640}
      title="Upload a bank CSV"
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
    >
      <h2 className="text-[20px] font-bold tracking-tight">Upload a bank CSV</h2>
      <p className="mt-1 text-[14px] text-muted">
        Export transactions from your bank&apos;s website as CSV. Overlapping files are fine: anything already here is skipped.
      </p>

      {!loaded ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void choose(e.dataTransfer.files[0]);
          }}
          className="mt-5 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-faint px-6 py-10 text-center hover:border-muted hover:bg-white/[0.02]"
        >
          <FileUp className="size-8 text-muted" strokeWidth={1.5} />
          <span className="text-[15px] font-medium">Choose a CSV file</span>
          <span className="text-[13px] text-muted">or drop it here</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
        </label>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg bg-card px-3.5 py-2.5 text-[14px]">
            <span className="min-w-0 truncate">{loaded.fileName}</span>
            <button type="button" onClick={reset} disabled={busy !== null} className="shrink-0 text-muted hover:text-ink">
              Choose another
            </button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted">Account</span>
            <input list="money-accounts" value={account} onChange={(e) => setAccount(e.target.value)} maxLength={60} className={field} />
            <datalist id="money-accounts">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>

          {parsed && !editColumns && (
            <div className="text-[14px]">
              <p>
                <span className="font-semibold">{parsed.rows.length.toLocaleString("en-AU")} transactions</span>
                {days.length > 0 && (
                  <span className="text-muted">
                    {" "}
                    · {shortDay(days[0])} {days[0].slice(0, 4)} to {shortDay(days.at(-1)!)} {days.at(-1)!.slice(0, 4)}
                  </span>
                )}
              </p>
              {parsed.unreadable > 0 && <p className="mt-1 text-[13px] text-amber">{parsed.unreadable} rows couldn&apos;t be read and will be left out.</p>}
              <p className="mt-1 text-[13px] text-muted">Check money out shows as minus and money in as plus:</p>
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                {parsed.rows.slice(0, 4).map((r, i) => (
                  <li key={i} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-3 px-3 py-2 text-[13.5px]">
                    <span className="text-muted tabular-nums">{shortDay(r.day)}</span>
                    <span className="truncate">{r.description}</span>
                    <span className={`tabular-nums ${r.amountCents > 0 ? "text-green" : ""}`}>{money(r.amountCents, { sign: true })}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <button type="button" onClick={() => setMapping({ flip: !loaded.mapping!.flip })} className="text-ink-soft underline-offset-2 hover:underline">
                  Flip plus and minus
                </button>
                <button type="button" onClick={() => setEditColumns(true)} className="text-ink-soft underline-offset-2 hover:underline">
                  Change columns
                </button>
              </div>
            </div>
          )}

          {editColumns && (
            <fieldset className="flex flex-col gap-3 rounded-xl border border-line p-3.5">
              <legend className="px-1 text-[13px] text-muted">
                {loaded.mapping ? "Which column is which?" : "Atlas couldn't tell which column is which. Pick them:"}
              </legend>
              <label className="flex items-center gap-2.5 text-[14px]">
                <input type="checkbox" checked={loaded.mapping?.hasHeader ?? false} onChange={(e) => setMapping({ hasHeader: e.target.checked })} className="size-4 accent-ink" />
                The first row is column names
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {ROLES.map((role) => (
                  <label key={role.id} className="flex min-w-0 flex-col gap-1">
                    <span className="text-[12.5px] text-muted">{role.label}</span>
                    <select
                      value={loaded.mapping?.[role.id] ?? ""}
                      onChange={(e) => setMapping({ [role.id]: e.target.value === "" ? null : Number(e.target.value) })}
                      className={`${field} h-9 text-[13.5px]`}
                    >
                      {role.optional && <option value="">None</option>}
                      {Array.from({ length: width }, (_, i) => (
                        <option key={i} value={i}>
                          {columnName(i)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-[12.5px] text-muted">Dates are written</span>
                  <select
                    value={loaded.mapping?.dateOrder ?? "dmy"}
                    onChange={(e) => setMapping({ dateOrder: e.target.value as Mapping["dateOrder"] })}
                    className={`${field} h-9 text-[13.5px]`}
                  >
                    <option value="dmy">Day first (31/12/2026)</option>
                    <option value="mdy">Month first (12/31/2026)</option>
                    <option value="ymd">Year first (2026-12-31)</option>
                  </select>
                </label>
              </div>
              {loaded.mapping && (
                <button type="button" onClick={() => setEditColumns(false)} className="self-start text-[13px] text-ink-soft underline-offset-2 hover:underline">
                  Show the preview
                </button>
              )}
            </fieldset>
          )}

          {error && (
            <p role="alert" className="text-[14px] text-red">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
            {busy && (
              <p role="status" className="mr-auto text-[13.5px] text-muted">
                {busy}
              </p>
            )}
            <button
              type="button"
              disabled={busy !== null || !parsed || parsed.rows.length === 0}
              onClick={() => void add()}
              className="h-11 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
            >
              Add {parsed ? parsed.rows.length.toLocaleString("en-AU") : ""} transactions
            </button>
          </div>
        </div>
      )}

      {!loaded && error && (
        <p role="alert" className="mt-3 text-[14px] text-red">
          {error}
        </p>
      )}

      {uploads.length > 0 && (
        <section className="mt-6 border-t border-line pt-4">
          <h3 className="text-[13px] font-medium text-muted">Earlier uploads</h3>
          <ul className="mt-2 flex flex-col">
            {uploads.slice(0, 8).map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-1.5 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">
                  {u.fileName} <span className="text-muted">· {u.account} · {u.added.toLocaleString("en-AU")} added</span>
                </span>
                <button
                  type="button"
                  onClick={() => void remove(u)}
                  disabled={busy !== null}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 ${confirmRemove === u.id ? "bg-red/10 text-red" : "text-muted hover:text-red"}`}
                >
                  <Trash2 className="size-3.5" />
                  {confirmRemove === u.id ? `Remove ${u.added.toLocaleString("en-AU")}?` : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}
