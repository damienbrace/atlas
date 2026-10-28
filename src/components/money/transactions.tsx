"use client";

import { Download, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sparkle } from "@/components/sparkle";
import { shortDay } from "@/lib/life/days";
import { merchantName } from "@/lib/money/merchant";
import { money, type Transaction } from "@/lib/money/types";
import { MerchantSearch } from "./merchant-search";
import { UNSORTED } from "./overview";

// The list under the overview: every transaction in the period, narrowed by the
// filters, with the total of whatever's showing.

export interface ListFilters {
  query: string;
  category: string | null;
  direction: "all" | "out" | "in";
  min: string;
  max: string;
  /** One business, by its shown name (picked in the search, or from Repeat charges). */
  merchant: string | null;
  /** The transactions behind one of Atlas's answers. */
  atlas: { title: string; ids: string[] } | null;
}

export const NO_FILTERS: ListFilters = { query: "", category: null, direction: "all", min: "", max: "", merchant: null, atlas: null };

const dollars = (text: string) => {
  const n = parseFloat(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export function listFilter(f: ListFilters) {
  const q = f.query.trim().toLowerCase();
  const min = dollars(f.min);
  const max = dollars(f.max);
  const atlas = f.atlas && new Set(f.atlas.ids);
  return (t: Transaction) => {
    if (atlas && !atlas.has(t.id)) return false;
    if (f.merchant && merchantName(t) !== f.merchant) return false;
    if (q && ![t.merchant, t.description, t.category].some((field) => field?.toLowerCase().includes(q))) return false;
    if (f.category === UNSORTED ? t.category !== null : f.category !== null && t.category !== f.category) return false;
    if (f.direction === "out" && t.amountCents >= 0) return false;
    if (f.direction === "in" && t.amountCents <= 0) return false;
    const size = Math.abs(t.amountCents);
    return (min === null || size >= min) && (max === null || size <= max);
  };
}

type Sort = "newest" | "oldest" | "out" | "in";
const SORTS: { id: Sort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "out", label: "Biggest spend" },
  { id: "in", label: "Biggest money in" },
];
const SORTERS: Record<Sort, (a: Transaction, b: Transaction) => number> = {
  newest: (a, b) => b.day.localeCompare(a.day),
  oldest: (a, b) => a.day.localeCompare(b.day),
  out: (a, b) => a.amountCents - b.amountCents,
  in: (a, b) => b.amountCents - a.amountCents,
};

const PAGE = 100;
const control =
  "h-9 rounded-lg border border-line-strong bg-transparent px-2.5 text-[14px] text-ink outline-none focus:border-ink/40 [color-scheme:dark]";

interface TransactionListProps {
  transactions: Transaction[];
  filters: ListFilters;
  onFilters: (f: ListFilters) => void;
  categories: string[];
  thisYear: string;
  onCategorise: (t: Transaction, category: string | null) => void;
  onNewCategory: (t: Transaction) => void;
}

export function TransactionList({ transactions, filters, onFilters, categories, thisYear, onCategorise, onNewCategory }: TransactionListProps) {
  const [sort, setSort] = useState<Sort>("newest");
  const [shown, setShown] = useState(PAGE);
  const rows = transactions.filter(listFilter(filters)).sort(SORTERS[sort]);
  // Suggest businesses that fit the other filters, so a pick never comes up empty.
  const suggestFrom = transactions.filter(listFilter({ ...filters, query: "", merchant: null }));
  const total = rows.reduce((sum, t) => sum + t.amountCents, 0);
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const set = (patch: Partial<ListFilters>) => {
    onFilters({ ...filters, ...patch });
    setShown(PAGE);
  };

  function exportCsv() {
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      "Date,Merchant,Category,Amount,Description,Account",
      ...rows.map((t) =>
        [t.day, merchantName(t), t.category ?? "", (t.amountCents / 100).toFixed(2), t.description, t.account].map(cell).join(","),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "atlas-transactions.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-label="Transactions" className="rounded-2xl border border-line bg-panel">
      <header className="flex flex-col gap-3 border-b border-line p-4 md:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-bold tracking-tight">Transactions</h2>
          <p className="text-[14px] text-muted tabular-nums">
            {rows.length.toLocaleString("en-AU")} · <span className={total > 0 ? "text-green" : "text-ink"}>{money(total, { sign: true })}</span>
          </p>
        </div>

        {filters.atlas && (
          <button
            type="button"
            onClick={() => set({ atlas: null })}
            title="Show every transaction"
            className="flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-teal/50 bg-teal/10 py-1 pr-2 pl-2.5 text-[13.5px] text-ink hover:bg-teal/15"
          >
            <Sparkle className="size-3.5" />
            <span className="truncate">{filters.atlas.title}</span>
            <X className="size-3.5 shrink-0 text-muted" />
            <span className="sr-only">, show every transaction</span>
          </button>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <MerchantSearch
            transactions={suggestFrom}
            query={filters.query}
            merchant={filters.merchant}
            onQuery={(query) => set({ query })}
            onMerchant={(merchant) => set({ merchant, query: "" })}
          />
          <select aria-label="Category" value={filters.category ?? ""} onChange={(e) => set({ category: e.target.value || null })} className={control}>
            <option value="">All categories</option>
            <option value={UNSORTED}>Not sorted yet</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select aria-label="Money in or out" value={filters.direction} onChange={(e) => set({ direction: e.target.value as ListFilters["direction"] })} className={control}>
            <option value="all">In and out</option>
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </select>
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <input inputMode="decimal" value={filters.min} onChange={(e) => set({ min: e.target.value })} placeholder="$ min" aria-label="Smallest amount" className={`${control} w-[4.75rem]`} />
            to
            <input inputMode="decimal" value={filters.max} onChange={(e) => set({ max: e.target.value })} placeholder="$ max" aria-label="Largest amount" className={`${control} w-[4.75rem]`} />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${control} h-8 text-[13px]`}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {filtered && (
            <button type="button" onClick={() => set(NO_FILTERS)} className="h-8 rounded-lg px-2.5 text-muted hover:bg-white/[0.04] hover:text-ink">
              Clear filters
            </button>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted hover:bg-white/[0.04] hover:text-ink disabled:opacity-40"
          >
            <Download className="size-4" /> Export
          </button>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-[15px] text-muted">No transactions match.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.slice(0, shown).map((t) => (
            <Row key={t.id} t={t} categories={categories} thisYear={thisYear} onCategorise={onCategorise} onNewCategory={onNewCategory} />
          ))}
        </ul>
      )}
      {rows.length > shown && (
        <div className="border-t border-line p-3 text-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="h-9 rounded-lg px-4 text-[14px] text-ink-soft hover:bg-white/[0.04] hover:text-ink">
            Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
          </button>
        </div>
      )}
    </section>
  );
}

const NEW_CATEGORY = "__new";

interface RowProps {
  t: Transaction;
  categories: string[];
  thisYear: string;
  onCategorise: (t: Transaction, category: string | null) => void;
  onNewCategory: (t: Transaction) => void;
}

function Row({ t, categories, thisYear, onCategorise, onNewCategory }: RowProps) {
  const date = t.day.startsWith(thisYear) ? shortDay(t.day) : `${shortDay(t.day)} ${t.day.slice(0, 4)}`;
  const name = merchantName(t);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[5.75rem_minmax(0,1fr)_10.5rem_7rem] md:px-5">
      <span className="hidden text-[13.5px] text-muted tabular-nums sm:block">{date}</span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] text-ink">{name}</span>
        <span className="block truncate text-[12.5px] text-faint" title={t.description}>
          <span className="sm:hidden">{date} · </span>
          {t.description}
          {t.account && <span className="hidden lg:inline"> · {t.account}</span>}
        </span>
      </span>
      <span className="order-last col-span-2 flex items-center gap-1.5 sm:order-none sm:col-span-1">
        {t.sortedBy === "atlas" && (
          <span title="Sorted by Atlas">
            <Sparkle className="size-3.5" />
            <span className="sr-only">Sorted by Atlas</span>
          </span>
        )}
        <CategorySelect
          value={t.category}
          categories={categories}
          label={`Category for ${name}`}
          onChange={(value) => (value === NEW_CATEGORY ? onNewCategory(t) : onCategorise(t, value))}
        />
      </span>
      <span className={`text-right text-[15px] tabular-nums ${t.amountCents > 0 ? "text-green" : "text-ink"}`}>{money(t.amountCents, { sign: true })}</span>
    </li>
  );
}

function CategorySelect({ value, categories, label, onChange }: { value: string | null; categories: string[]; label: string; onChange: (v: string | null) => void }): ReactNode {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`h-8 w-full max-w-[10.5rem] min-w-0 truncate rounded-full border px-2.5 text-[13px] outline-none [color-scheme:dark] focus:border-ink/40 ${
        value ? "border-line-strong bg-card text-ink-soft" : "border-dashed border-faint bg-transparent text-muted"
      }`}
    >
      <option value="">{value ? "Let Atlas decide" : "Not sorted"}</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={NEW_CATEGORY}>New category…</option>
    </select>
  );
}
