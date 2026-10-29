"use client";

import { Check, Pencil, TriangleAlert, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { askAtlasToSort, sortWithAtlas } from "@/app/(app)/money/actions";
import { Sparkle } from "@/components/sparkle";
import { useToast } from "@/components/toast";
import { ruleImpact, ruleMatches } from "@/lib/money/checks";
import { merchantName } from "@/lib/money/merchant";
import { money, type Rule, type Transaction } from "@/lib/money/types";

// Atlas's part of the Money page: sorting merchants it hasn't seen, and turning
// "Caltex and BP are fuel" into rules that wait for Approve / Edit / Dismiss. Each proposed
// rule shows what it would move, and warns when that's payments sorted as different things.

type Draft = Omit<Rule, "id">;

interface Proposal {
  reply: string;
  rules: Draft[];
  newCategories: string[];
}

/** What a proposed rule would move, before it's approved. */
function RuleMoves({ rule, transactions }: { rule: Draft; transactions: Transaction[] }) {
  const [open, setOpen] = useState(false);
  const { moves, from, broad } = ruleImpact(rule, transactions);
  if (moves.length === 0) return null;
  return (
    <div className={`basis-full rounded-lg px-3 py-2 text-[13px] ${broad ? "border border-amber/40 bg-amber/10 text-ink" : "bg-white/[0.03] text-muted"}`}>
      <p>
        {broad && <TriangleAlert className="mr-1.5 inline size-3.5 -translate-y-px text-amber" />}
        Moves {moves.length} to {rule.category}: {from.map(([c, n]) => `${n} from ${c}`).join(", ")}.
        {broad && " Those were sorted as quite different things, so check this rule isn't too broad."}{" "}
        <button type="button" onClick={() => setOpen((on) => !on)} className="underline decoration-dotted underline-offset-2 hover:text-ink">
          {open ? "Hide them" : "Show them"}
        </button>
      </p>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-muted">
          {moves.slice(0, 15).map((t) => (
            <li key={t.id} className="truncate">
              {t.description} <span className="text-faint">· now {t.category ?? "not sorted"}</span>
            </li>
          ))}
          {moves.length > 15 && <li className="text-faint">and {moves.length - 15} more</li>}
        </ul>
      )}
    </div>
  );
}

interface AskAtlasProps {
  transactions: Transaction[];
  categories: string[];
  rules: Rule[];
  onApprove: (rules: Draft[], newCategories: string[]) => Promise<boolean>;
  onRemoveRule: (rule: Rule) => void;
  onSorted: () => void;
}

export function AskAtlas({ transactions, categories, rules, onApprove, onRemoveRule, onSorted }: AskAtlasProps) {
  const toast = useToast();
  const [instruction, setInstruction] = useState("");
  const [asking, setAsking] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [editing, setEditing] = useState(false);
  const [sorting, setSorting] = useState<{ done: number; total: number } | null>(null);

  // Merchants Atlas hasn't read yet (it names every merchant it sorts).
  const unread = new Set(transactions.filter((t) => t.category === null && t.merchant === null).map((t) => t.merchantKey)).size;

  async function sortAll() {
    let done = 0;
    setSorting({ done, total: unread });
    // Each round is one Claude request of up to 80 merchants.
    for (let round = 0; round < 50; round++) {
      const res = await sortWithAtlas().catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
      if (!res.ok) {
        toast({ message: res.error });
        break;
      }
      done += res.sorted;
      setSorting({ done, total: done + res.remaining });
      if (res.remaining === 0 || res.sorted === 0) break;
    }
    setSorting(null);
    onSorted();
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!instruction.trim() || asking) return;
    setAsking(true);
    const res = await askAtlasToSort(instruction).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    setAsking(false);
    if (!res.ok) return toast({ message: res.error });
    setProposal({ reply: res.reply, rules: res.rules, newCategories: res.newCategories });
    setEditing(false);
  }

  async function approve() {
    if (!proposal) return;
    const used = proposal.rules.filter((r) => r.pattern.trim());
    if (used.length === 0) return setProposal(null);
    const newCategories = proposal.newCategories.filter((c) => used.some((r) => r.category === c));
    if (await onApprove(used, newCategories)) {
      setProposal(null);
      setInstruction("");
    }
  }

  const changeRule = (i: number, patch: Partial<Draft>) =>
    setProposal((p) => p && { ...p, rules: p.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const allCategories = [...categories, ...(proposal?.newCategories ?? [])];

  return (
    <section
      aria-label="Atlas sorting"
      className="rounded-2xl border border-l-[3px] border-line border-l-teal bg-panel p-4 shadow-[0_0_32px_-16px_rgba(45,212,191,0.45)] md:p-5"
    >
      <div className="flex items-center gap-2.5">
        <Sparkle className="size-6" glow />
        <h2 className="text-[17px] font-bold tracking-tight">Sort with Atlas</h2>
      </div>

      {sorting ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-[14.5px] text-teal">
          <Sparkle className="size-4 animate-shimmer" />
          Sorting merchants… {sorting.done} of {sorting.total}
        </p>
      ) : unread > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14.5px] text-ink-soft">
            {unread} merchant{unread === 1 ? "" : "s"} Atlas hasn&apos;t sorted yet.
          </p>
          <button
            type="button"
            onClick={() => void sortAll()}
            className="flex h-10 items-center gap-2 rounded-xl bg-teal px-4 text-[14.5px] font-semibold text-canvas shadow-[0_0_24px_-8px_rgba(45,212,191,0.6)] hover:opacity-90"
          >
            <Sparkle className="size-4 text-canvas" /> Sort them
          </button>
        </div>
      ) : null}

      <form onSubmit={ask} className="mt-3 flex gap-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={500}
          placeholder="Tell Atlas how to sort, e.g. “Caltex and BP are fuel”"
          aria-label="Tell Atlas how to sort"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-card px-3.5 text-[14.5px] text-ink outline-none placeholder:text-faint focus:border-teal/60"
        />
        <button
          type="submit"
          disabled={asking || !instruction.trim()}
          className="h-11 shrink-0 rounded-xl border border-teal/70 px-4 text-[14.5px] font-medium text-ink hover:bg-teal/10 disabled:opacity-40"
        >
          {asking ? "Thinking…" : "Ask"}
        </button>
      </form>

      {proposal && (
        <div className="mt-4 rounded-xl border border-line bg-card p-4">
          <p className="text-[14.5px] text-ink">{proposal.reply}</p>
          {proposal.rules.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {proposal.rules.map((r, i) => {
                const hits = ruleMatches(r, transactions);
                const names = [...new Set(hits.map(merchantName))].slice(0, 3);
                return (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[14px]">
                    {editing ? (
                      <>
                        <input
                          value={r.pattern}
                          onChange={(e) => changeRule(i, { pattern: e.target.value })}
                          aria-label="Words in the merchant name"
                          className="h-9 w-40 rounded-lg border border-line-strong bg-panel px-2.5 text-[13.5px] uppercase outline-none focus:border-ink/40"
                        />
                        <span className="text-muted">→</span>
                        <select
                          value={r.category}
                          onChange={(e) => changeRule(i, { category: e.target.value })}
                          aria-label="Category"
                          className="h-9 rounded-lg border border-line-strong bg-panel px-2 text-[13.5px] outline-none [color-scheme:dark]"
                        >
                          {allCategories.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          aria-label="Remove this rule"
                          onClick={() => setProposal((p) => p && { ...p, rules: p.rules.filter((_, j) => j !== i) })}
                          className="grid size-8 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-ink"
                        >
                          <X className="size-4" />
                        </button>
                      </>
                    ) : (
                      <span>
                        <span className="font-semibold">{r.pattern}</span>
                        {r.amountCents !== null && <span className="text-muted"> at {money(r.amountCents)}</span>}
                        <span className="text-muted"> → </span>
                        <span className="font-semibold">{r.category}</span>
                      </span>
                    )}
                    <span className={`text-[13px] ${hits.length ? "text-muted" : "text-amber"}`}>
                      {hits.length ? `${hits.length} transaction${hits.length === 1 ? "" : "s"} · ${names.join(", ")}` : "matches nothing yet"}
                    </span>
                    <RuleMoves rule={r} transactions={transactions} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {proposal.rules.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void approve()}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-teal px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90"
                >
                  <Check className="size-4" strokeWidth={2.5} /> Approve
                </button>
                <button
                  type="button"
                  onClick={() => setEditing((on) => !on)}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-line-strong px-3.5 text-[14.5px] hover:border-faint"
                >
                  {editing ? <Check className="size-4" /> : <Pencil className="size-4" />} {editing ? "Done" : "Edit"}
                </button>
              </>
            )}
            <button type="button" onClick={() => setProposal(null)} className="h-10 rounded-xl px-3.5 text-[14.5px] text-ink-soft hover:text-ink">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-[13.5px] text-muted hover:text-ink">
            Your sorting rules ({rules.length})
          </summary>
          <ul className="mt-2 flex flex-col">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate">
                  {r.pattern}
                  {r.amountCents !== null && <span className="text-muted"> at {money(r.amountCents)}</span>}
                  <span className="text-muted"> → </span>
                  {r.category}
                  <span className="text-faint"> · {ruleMatches(r, transactions).length}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Delete the rule ${r.pattern} to ${r.category}`}
                  onClick={() => onRemoveRule(r)}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-faint hover:bg-white/5 hover:text-red"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
