"use client";

import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Dialog } from "@/components/dialog";
import { shortDay } from "@/lib/life/days";
import { merchantName } from "@/lib/money/merchant";
import { MAX_SPLITS, money, type SplitPart, type Transaction } from "@/lib/money/types";

// Splitting one payment across categories. Every part but the last takes a % or a $
// amount; the last part is whatever's left, so the parts always add up to the payment.

/** A part being edited, in positive cents. Both boxes are kept as typed. */
interface Part {
  category: string;
  cents: number;
  pct: string;
  dollars: string;
}

const pctOf = (cents: number, total: number) => String(Math.round((cents / total) * 1000) / 10);
const dollarsOf = (cents: number) => (cents / 100).toFixed(2);

function parse(text: string) {
  const n = parseFloat(text.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** An existing split as it was saved; otherwise half in the payment's category and half to pick. */
function startingParts(t: Transaction): { parts: Part[]; last: string } {
  const total = Math.abs(t.amountCents);
  if (t.splits?.length) {
    const parts = t.splits.slice(0, -1).map((p) => {
      const cents = Math.abs(p.cents);
      return { category: p.category, cents, pct: pctOf(cents, total), dollars: dollarsOf(cents) };
    });
    return { parts, last: t.splits.at(-1)!.category };
  }
  const half = Math.round(total / 2);
  return { parts: [{ category: t.category ?? "", cents: half, pct: "50", dollars: dollarsOf(half) }], last: "" };
}

const box = "flex h-10 items-center gap-1 rounded-lg border border-line-strong bg-card px-2.5 text-[14px] focus-within:border-ink/40";

function CategoryPicker({ value, categories, label, onChange }: { value: string; categories: string[]; label: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={`h-10 min-w-0 flex-1 basis-40 rounded-lg border border-line-strong bg-card px-2.5 text-[14px] outline-none [color-scheme:dark] focus:border-ink/40 ${value ? "text-ink" : "text-muted"}`}
    >
      <option value="">Pick a category</option>
      {categories.map((c) => (
        <option key={c}>{c}</option>
      ))}
    </select>
  );
}

interface SplitFormProps {
  t: Transaction;
  categories: string[];
  onClose: () => void;
  onSave: (t: Transaction, parts: SplitPart[] | null) => void;
}

function SplitForm({ t, categories, onClose, onSave }: SplitFormProps) {
  const total = Math.abs(t.amountCents);
  const sign = Math.sign(t.amountCents);
  const [start] = useState(() => startingParts(t));
  const [parts, setParts] = useState(start.parts);
  const [last, setLast] = useState(start.last);
  const rest = total - parts.reduce((sum, p) => sum + p.cents, 0);

  const change = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  function typePct(i: number, text: string) {
    const n = parse(text);
    const cents = n === null ? 0 : Math.round((total * n) / 100);
    change(i, { pct: text, cents, dollars: n === null ? "" : dollarsOf(cents) });
  }
  function typeDollars(i: number, text: string) {
    const n = parse(text);
    const cents = n === null ? 0 : Math.round(n * 100);
    change(i, { dollars: text, cents, pct: n === null ? "" : pctOf(cents, total) });
  }

  const problem =
    parts.some((p) => !p.category) || !last
      ? "Pick a category for each part."
      : parts.some((p) => p.cents <= 0)
        ? "Give each part an amount."
        : rest < 0
          ? `The parts come to more than ${money(total)}.`
          : rest === 0
            ? "Nothing's left for the last part. Make a part smaller, or remove one."
            : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    onSave(t, [...parts.map((p) => ({ category: p.category, cents: p.cents * sign })), { category: last, cents: rest * sign }]);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-[19px] font-bold tracking-tight">Split this payment</h2>
        <p className="mt-1 text-[14px] text-muted">
          {merchantName(t)} · {shortDay(t.day)} · <span className="text-ink tabular-nums">{money(t.amountCents, { sign: true })}</span>
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-faint" title={t.description}>
          {t.description}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {parts.map((p, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <CategoryPicker value={p.category} categories={categories} label={`Category for part ${i + 1}`} onChange={(category) => change(i, { category })} />
            <div className="flex items-center gap-2">
              <label className={`${box} w-[5.25rem]`}>
                <input
                  inputMode="decimal"
                  value={p.pct}
                  onChange={(e) => typePct(i, e.target.value)}
                  aria-label={`Part ${i + 1} as a percentage`}
                  className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
                />
                <span className="text-muted">%</span>
              </label>
              <label className={`${box} w-[6.75rem]`}>
                <span className="text-muted">$</span>
                <input
                  inputMode="decimal"
                  value={p.dollars}
                  onChange={(e) => typeDollars(i, e.target.value)}
                  aria-label={`Part ${i + 1} in dollars`}
                  className="w-full min-w-0 bg-transparent text-right tabular-nums outline-none"
                />
              </label>
              <button
                type="button"
                aria-label={`Remove part ${i + 1}`}
                disabled={parts.length === 1}
                onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-ink disabled:invisible"
              >
                <X className="size-4" />
              </button>
            </div>
          </li>
        ))}
        <li className="flex flex-wrap items-center gap-2">
          <CategoryPicker value={last} categories={categories} label="Category for the rest" onChange={setLast} />
          <div className="flex items-center gap-2 text-[14px] tabular-nums">
            <span className={`w-[5.25rem] px-2.5 text-right ${rest > 0 ? "text-muted" : "text-red"}`}>{rest > 0 ? `${pctOf(rest, total)}%` : "0%"}</span>
            <span className={`w-[6.75rem] px-2.5 text-right ${rest > 0 ? "text-ink" : "text-red"}`}>{money(Math.max(rest, 0))}</span>
            <span className="size-8" aria-hidden="true" />
          </div>
        </li>
      </ul>
      <p className="-mt-1 text-[12.5px] text-faint">The last part is whatever&apos;s left.</p>

      {parts.length + 1 < MAX_SPLITS && (
        <button
          type="button"
          onClick={() => setParts((ps) => [...ps, { category: "", cents: 0, pct: "", dollars: "" }])}
          className="-mt-1 flex h-9 w-fit items-center gap-1.5 rounded-lg px-2.5 text-[14px] text-ink-soft hover:bg-white/[0.04] hover:text-ink"
        >
          <Plus className="size-4" /> Add a part
        </button>
      )}

      {problem && (
        <p role="status" className="text-[13.5px] text-muted">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {t.splits && (
          <button type="button" onClick={() => onSave(t, null)} className="h-10 rounded-xl px-3 text-[14.5px] text-ink-soft hover:text-red">
            Remove split
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl px-4 text-[14.5px] text-ink-soft hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={problem !== null} className="h-10 rounded-xl bg-ink px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40">
            Save split
          </button>
        </div>
      </div>
    </form>
  );
}

interface SplitDialogProps {
  /** The payment being split; null when the dialog is closed. */
  transaction: Transaction | null;
  categories: string[];
  onClose: () => void;
  /** Parts are signed like the payment; null takes the split off. */
  onSave: (t: Transaction, parts: SplitPart[] | null) => void;
}

export function SplitDialog({ transaction, categories, onClose, onSave }: SplitDialogProps) {
  return (
    <Dialog open={transaction !== null} onClose={onClose} title="Split this payment" width={540}>
      {transaction && <SplitForm key={transaction.id} t={transaction} categories={categories} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}
