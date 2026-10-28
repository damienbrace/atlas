"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { approveRules, categorise, createCategory, removeRule } from "@/app/(app)/money/actions";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { addDays, shortDay } from "@/lib/life/days";
import { merchantName, normalise, patternMatches } from "@/lib/money/merchant";
import {
  inRange,
  monthlySpending,
  monthStart,
  PERIODS,
  periodRange,
  previousRange,
  summarise,
  weeklySpending,
  type PeriodId,
  type Range,
} from "@/lib/money/periods";
import type { Span } from "@/lib/money/question";
import { findRecurring } from "@/lib/money/recurring";
import { isFixed, MAX_CATEGORY, type Rule, type Transaction, type Upload } from "@/lib/money/types";
import { AskAboutMoney } from "./ask-about-money";
import { AskAtlas, ruleMatches } from "./ask-atlas";
import { CategoryBars, SpendingChart, Totals, UNSORTED, type ChartUnit } from "./overview";
import { Repeats } from "./repeats";
import { NO_FILTERS, TransactionList, type ListFilters } from "./transactions";
import { UploadDialog } from "./upload-dialog";

// The Money page: personal spending from bank CSVs. Everything is loaded once and
// filtered in the browser, so changing the period or a filter is instant.

interface MoneyProps {
  transactions: Transaction[];
  rules: Rule[];
  categories: string[];
  uploads: Upload[];
  today: string;
}

/** This month if it has some activity yet, else the last 3 months, else everything. */
function defaultPeriod(transactions: Transaction[], today: string): PeriodId {
  const month = today.slice(0, 7);
  if (transactions.filter((t) => t.day.startsWith(month)).length >= 5) return "month";
  if (transactions.some((t) => t.day >= addDays(today, -89))) return "3m";
  return "all";
}

/** The words a rule should look for: Atlas's name for the merchant if it fits, else the whole key. */
function patternFor(t: Transaction) {
  const name = normalise(t.merchant ?? "");
  return name && patternMatches(name, t.merchantKey) ? name : t.merchantKey;
}

const chip = (on: boolean) =>
  `h-9 shrink-0 rounded-lg border px-3 text-[13.5px] transition-colors ${
    on ? "border-ink/50 bg-white/[0.08] text-ink" : "border-line-strong text-ink-soft hover:border-faint"
  }`;

export function Money({ transactions: fromServer, rules, categories: savedCategories, uploads, today }: MoneyProps) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  // My category picks show straight away; the server's copy replaces them on refresh.
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [seen, setSeen] = useState(fromServer);
  if (seen !== fromServer) {
    setSeen(fromServer);
    setPicks({});
  }
  const transactions = useMemo(
    () =>
      Object.keys(picks).length === 0
        ? fromServer
        : fromServer.map((t) => (t.id in picks ? { ...t, category: picks[t.id], sortedBy: picks[t.id] === null ? null : ("me" as const) } : t)),
    [fromServer, picks],
  );
  const [addedCategories, setAddedCategories] = useState<string[]>([]);
  const categories = [...savedCategories, ...addedCategories.filter((c) => !savedCategories.includes(c))];

  const [period, setPeriod] = useState<PeriodId>(() => defaultPeriod(fromServer, today));
  const [custom, setCustom] = useState<Range>({ from: monthStart(today), to: today });
  const [account, setAccount] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [chartUnit, setChartUnit] = useState<ChartUnit>("month");
  const [uploading, setUploading] = useState(false);
  const [naming, setNaming] = useState<Transaction | null>(null);

  const accounts = [...new Set([...uploads.map((u) => u.account), ...transactions.map((t) => t.account)])];
  const mine = useMemo(() => (account ? transactions.filter((t) => t.account === account) : transactions), [transactions, account]);
  const range = periodRange(period, today, custom);
  const inPeriod = mine.filter((t) => inRange(t.day, range));
  const summary = summarise(inPeriod);
  // Only compare with a span the transactions fully cover; one reaching back before the
  // first transaction would make any period look like a huge rise.
  const earliest = mine.at(-1)?.day ?? today;
  const before = previousRange(period, today, custom);
  const previous = before?.range.from && before.range.from >= earliest ? before : null;
  const earlier = previous ? mine.filter((t) => inRange(t.day, previous.range)) : [];
  const recurring = useMemo(() => findRecurring(mine, today), [mine, today]);

  // The chart follows the category filter, and ends with the period's last month or week.
  const chartSource = filters.category ? mine.filter((t) => (filters.category === UNSORTED ? t.category === null : t.category === filters.category)) : mine;
  const latest = mine[0]?.day ?? today;
  const chartEnd = range.to ? (range.to < today ? range.to : today) : latest;
  const chartTitle = `${filters.category ? (filters.category === UNSORTED ? "Unsorted" : filters.category) : "Spending"} each ${chartUnit}`;

  async function pickCategory(t: Transaction, category: string | null) {
    setPicks((p) => ({ ...p, [t.id]: category }));
    const res = await categorise([t.id], category).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      setPicks((p) => {
        const rest = { ...p };
        delete rest[t.id];
        return rest;
      });
      return toast({ message: "Couldn't change that category" });
    }
    if (category === null) return refresh();
    const others = transactions.filter((o) => o.id !== t.id && o.merchantKey === t.merchantKey && !isFixed(o.sortedBy) && o.category !== category);
    if (others.length === 0) return toast({ message: `Moved to ${category}` });
    toast({
      message: `Moved to ${category}`,
      actionLabel: `All ${others.length + 1} from ${merchantName(t)}`,
      onAction: () => void saveRules([{ pattern: patternFor(t), category, amountCents: null }], []),
    });
  }

  async function saveRules(drafts: Omit<Rule, "id">[], newCategories: string[]) {
    const res = await approveRules(drafts, newCategories).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      toast({ message: "Couldn't save those rules" });
      return false;
    }
    const sorted = new Set(drafts.flatMap((r) => ruleMatches(r, transactions).filter((t) => !isFixed(t.sortedBy)).map((t) => t.id))).size;
    toast({ message: sorted ? `Sorted ${sorted} transaction${sorted === 1 ? "" : "s"}` : "Rule saved" });
    refresh();
    return true;
  }

  async function deleteRule(rule: Rule) {
    const res = await removeRule(rule.id).catch(() => ({ ok: false as const }));
    if (!res.ok) return toast({ message: "Couldn't delete that rule" });
    toast({ message: "Rule deleted", onAction: () => void saveRules([rule], []) });
    refresh();
  }

  async function nameCategory(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    const t = naming;
    if (!name || !t) return;
    setNaming(null);
    const res = await createCategory(name).catch(() => ({ ok: false as const }));
    if (!res.ok) return toast({ message: "Couldn't add that category" });
    setAddedCategories((c) => [...c, name]);
    await pickCategory(t, res.categories.find((c) => c.toLowerCase() === name.toLowerCase()) ?? name);
  }

  function showTransactions(patch: Partial<ListFilters>) {
    setFilters({ ...NO_FILTERS, ...patch });
    requestAnimationFrame(() => document.getElementById("money-transactions")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  /** An answer can cover any dates and accounts, so the page switches to match it. */
  function showAnswer(title: string, ids: string[], span: Span | null, scroll: boolean) {
    setAccount(null);
    if (span) {
      setCustom(span);
      setPeriod("custom");
    } else setPeriod("all");
    if (scroll) showTransactions({ atlas: { title, ids } });
    else setFilters({ ...NO_FILTERS, atlas: { title, ids } });
  }

  const uploadDialog = (
    <UploadDialog
      open={uploading}
      onClose={() => setUploading(false)}
      accounts={accounts}
      uploads={uploads}
      onDone={({ added, skipped }) => {
        setUploading(false);
        toast({ message: `Added ${added.toLocaleString("en-AU")}${skipped ? `, ${skipped.toLocaleString("en-AU")} already here` : ""}` });
        if (added && period !== "all" && !fromServer.length) setPeriod("all");
        refresh();
      }}
      onRemoved={() => {
        toast({ message: "Upload removed" });
        refresh();
      }}
    />
  );

  if (transactions.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-3 pb-[84px] scroll-thin md:pb-3 lg:p-5">
        <div className="mx-auto flex max-w-[640px] flex-col gap-4 pt-6 md:pt-16">
          <h1 className="px-1 text-[30px] leading-tight font-bold tracking-tight md:text-[34px]">Money</h1>
          <section className="rounded-2xl border border-line bg-panel p-6">
            <h2 className="text-[19px] font-bold tracking-tight">Start with a bank CSV</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              On your bank&apos;s website (the desktop site usually has it, not the app), open your everyday account&apos;s transactions, choose
              Export or Download, and pick CSV. A few months to a year is ideal.
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Atlas sorts each merchant into a category, and you can tell it how in plain English. Nothing leaves Atlas except merchant names
              going to Claude for sorting.
            </p>
            <button
              type="button"
              onClick={() => setUploading(true)}
              className="mt-5 flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas hover:opacity-90"
            >
              <FileUp className="size-5" /> Upload a CSV
            </button>
          </section>
        </div>
        {uploadDialog}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 pb-[84px] scroll-thin md:pb-3 lg:p-5">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h1 className="text-[30px] leading-tight font-bold tracking-tight md:text-[34px]">Money</h1>
            <p className="mt-1 text-[15px] text-muted">
              Personal spending · {inPeriod.length.toLocaleString("en-AU")} transactions
              {range.from && range.to ? ` · ${shortDay(range.from)} to ${shortDay(range.to)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="flex h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[14.5px] font-medium hover:border-faint hover:bg-white/[0.03]"
          >
            <FileUp className="size-[18px]" strokeWidth={1.75} /> Upload CSV
          </button>
        </header>

        <AskAboutMoney
          transactions={transactions}
          today={today}
          following={filters.atlas !== null}
          onShow={showAnswer}
          onClear={() => setFilters((f) => ({ ...f, atlas: null }))}
        />

        <div className="flex flex-wrap items-center gap-2 px-1">
          <div role="group" aria-label="Period" className="flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => setPeriod(p.id)} className={chip(period === p.id)}>
                {p.label}
              </button>
            ))}
            <button type="button" aria-pressed={period === "custom"} onClick={() => setPeriod("custom")} className={chip(period === "custom")}>
              Dates…
            </button>
          </div>
          {period === "custom" && (
            <span className="flex items-center gap-1.5 text-[13.5px] text-muted">
              <input
                type="date"
                aria-label="From"
                value={custom.from ?? ""}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || null }))}
                className="h-9 rounded-lg border border-line-strong bg-transparent px-2 text-[13.5px] text-ink [color-scheme:dark]"
              />
              to
              <input
                type="date"
                aria-label="To"
                value={custom.to ?? ""}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || null }))}
                className="h-9 rounded-lg border border-line-strong bg-transparent px-2 text-[13.5px] text-ink [color-scheme:dark]"
              />
            </span>
          )}
          {accounts.length > 1 && (
            <select
              aria-label="Account"
              value={account ?? ""}
              onChange={(e) => setAccount(e.target.value || null)}
              className="h-9 rounded-lg border border-line-strong bg-transparent px-2.5 text-[13.5px] text-ink [color-scheme:dark] md:ml-auto"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          )}
        </div>

        <Totals now={summary} before={previous && earlier.length ? summarise(earlier) : null} compareLabel={previous?.label ?? ""} />

        {/* Phones get one column in reading order; wide screens get two. */}
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
            <div className="order-1">
              <AskAtlas
                transactions={transactions}
                categories={categories}
                rules={rules}
                onApprove={saveRules}
                onRemoveRule={(r) => void deleteRule(r)}
                onSorted={refresh}
              />
            </div>
            <div id="money-transactions" className="order-4 scroll-mt-4">
              <TransactionList
                transactions={inPeriod}
                filters={filters}
                onFilters={setFilters}
                categories={categories}
                thisYear={today.slice(0, 4)}
                onCategorise={(t, c) => void pickCategory(t, c)}
                onNewCategory={setNaming}
              />
            </div>
          </div>
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
            <div className="order-2">
              <CategoryBars summary={summary} selected={filters.category} onSelect={(category) => setFilters((f) => ({ ...f, category }))} />
            </div>
            <div className="order-3">
              <SpendingChart
                bars={chartUnit === "month" ? monthlySpending(chartSource, chartEnd) : weeklySpending(chartSource, chartEnd)}
                unit={chartUnit}
                onUnit={setChartUnit}
                today={today}
                title={chartTitle}
                onPick={(bar) => {
                  setCustom({ from: bar.from, to: bar.to });
                  setPeriod("custom");
                }}
              />
            </div>
            <div className="order-5">
              <Repeats
                items={recurring}
                onPick={(r) => {
                  setPeriod("all");
                  showTransactions({ merchant: r.name });
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {uploadDialog}

      <Dialog open={naming !== null} onClose={() => setNaming(null)} title="New category">
        <form onSubmit={(e) => void nameCategory(e)} className="flex flex-col gap-4">
          <h2 className="text-[19px] font-bold tracking-tight">New category</h2>
          {naming && <p className="-mt-2 text-[14px] text-muted">For {merchantName(naming)}</p>}
          <input
            name="name"
            required
            autoFocus
            maxLength={MAX_CATEGORY}
            placeholder="e.g. Ute, Kids, Horses"
            aria-label="Category name"
            className="h-11 rounded-xl border border-line-strong bg-card px-3.5 text-[15px] text-ink outline-none focus:border-ink/40"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNaming(null)} className="h-10 rounded-xl px-4 text-[14.5px] text-ink-soft hover:text-ink">
              Cancel
            </button>
            <button type="submit" className="h-10 rounded-xl bg-ink px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90">
              Add
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
