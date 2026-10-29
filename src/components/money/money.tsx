"use client";

import { FileUp, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import {
  approveRules,
  categorise,
  createCategory,
  fixFlag,
  leaveAlone,
  removeRule,
  reopenCheck,
  resortMerchants,
  restoreMerchants,
  restoreSorting,
  reviewWithAtlas,
  splitTransactions,
  type SortingSnapshot,
} from "@/app/(app)/money/actions";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { addDays, dayKey, parseDay, shortDay } from "@/lib/life/days";
import { findIssues, ruleMatches, safePattern, type Issue } from "@/lib/money/checks";
import { merchantName, titleCase } from "@/lib/money/merchant";
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
import { expandSplits, splitByShares } from "@/lib/money/split";
import { isFixed, MAX_CATEGORY, type MoneyFlag, type Rule, type SplitPart, type Transaction, type Upload } from "@/lib/money/types";
import { AskAboutMoney } from "./ask-about-money";
import { AskAtlas } from "./ask-atlas";
import { ThingsToCheck, type FlagItem } from "./checks";
import { CategoryBars, SpendingChart, Totals, UNSORTED, type ChartUnit } from "./overview";
import { Repeats } from "./repeats";
import { SplitDialog } from "./split-dialog";
import { NO_FILTERS, TransactionList, type ListFilters } from "./transactions";
import { UpConnect, type UpStatus } from "./up-connect";
import { UploadDialog } from "./upload-dialog";

// The Money page: personal spending from bank CSVs. Everything is loaded once and
// filtered in the browser, so changing the period or a filter is instant. The list shows
// each payment once; totals and charts count a split payment's parts in their own categories.

/** What my own picks change on a transaction, shown before the server has it. */
type Patch = Pick<Transaction, "category" | "sortedBy" | "splits">;

/** A change the Undo button can take back. */
interface Undo {
  id: number;
  /** What the change was: "Coffee Joy → Groceries". */
  label: string;
  run: () => Promise<boolean>;
}

/** Changes Undo remembers, newest last. */
const MAX_UNDO = 30;

/** Ctrl+Z belongs to a text box while you're typing in it (a dropdown has no undo of its own, so it's Atlas's). */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA");

interface MoneyProps {
  transactions: Transaction[];
  rules: Rule[];
  categories: string[];
  uploads: Upload[];
  /** Atlas's open review flags. */
  flags: MoneyFlag[];
  /** Things to check I've said to leave. */
  leftChecks: string[];
  /** When Atlas last reviewed the sorting (ms). */
  reviewedAt: number | null;
  /** Up Bank's sync, when it's connected. */
  up: UpStatus | null;
  ownerName: string;
  today: string;
}

/** This month if it has some activity yet, else the last 3 months, else everything. */
function defaultPeriod(transactions: Transaction[], today: string): PeriodId {
  const month = today.slice(0, 7);
  if (transactions.filter((t) => t.day.startsWith(month)).length >= 5) return "month";
  if (transactions.some((t) => t.day >= addDays(today, -89))) return "3m";
  return "all";
}

/** "today", "yesterday", "4 days ago" */
function checkedLabel(reviewedAt: number | null, today: string) {
  if (reviewedAt === null) return null;
  const days = Math.round((parseDay(today).getTime() - parseDay(dayKey(new Date(reviewedAt))).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

const chip = (on: boolean) =>
  `h-9 shrink-0 rounded-lg border px-3 text-[13.5px] transition-colors ${
    on ? "border-ink/50 bg-white/[0.08] text-ink" : "border-line-strong text-ink-soft hover:border-faint"
  }`;

export function Money({ transactions: fromServer, rules, categories: savedCategories, uploads, flags, leftChecks, reviewedAt, up, ownerName, today }: MoneyProps) {
  const router = useRouter();
  const toast = useToast();
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  // My category picks and splits show straight away; the server's copy replaces them on refresh.
  const [picks, setPicks] = useState<Record<string, Patch>>({});
  // Things to check being fixed hide straight away.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(fromServer);
  if (seen !== fromServer) {
    setSeen(fromServer);
    setPicks({});
    // Fixed things to check have gone from the server's data; an undone fix comes back.
    setHidden(new Set());
  }
  const transactions = useMemo(
    () =>
      Object.keys(picks).length === 0
        ? fromServer
        : fromServer.map((t) => (t.id in picks ? { ...t, ...picks[t.id] } : t)),
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
  const [splitting, setSplitting] = useState<Transaction | null>(null);
  // Things to check I've left hide straight away.
  const [left, setLeft] = useState(() => new Set(leftChecks));
  const [reviewing, setReviewing] = useState<"new" | "all" | null>(null);
  // Undo: the ref is what's true right now (two quick Ctrl+Zs mustn't take back the same
  // change twice); the state is what the button shows.
  const undoStack = useRef<Undo[]>([]);
  const [undos, setUndos] = useState<Undo[]>([]);
  const undoId = useRef(0);

  const accounts = [...new Set([...uploads.map((u) => u.account), ...transactions.map((t) => t.account)])];
  const mine = useMemo(() => (account ? transactions.filter((t) => t.account === account) : transactions), [transactions, account]);
  const range = periodRange(period, today, custom);
  const inPeriod = mine.filter((t) => inRange(t.day, range));
  // Split payments as their parts, for everything that adds up by category.
  const allParts = useMemo(() => expandSplits(transactions), [transactions]);
  const parts = useMemo(() => expandSplits(mine), [mine]);
  const summary = summarise(parts.filter((t) => inRange(t.day, range)));
  // Only compare with a span the transactions fully cover; one reaching back before the
  // first transaction would make any period look like a huge rise.
  const earliest = mine.at(-1)?.day ?? today;
  const before = previousRange(period, today, custom);
  const previous = before?.range.from && before.range.from >= earliest ? before : null;
  const earlier = previous ? parts.filter((t) => inRange(t.day, previous.range)) : [];
  const recurring = useMemo(() => findRecurring(mine, today), [mine, today]);

  const issues = useMemo(
    () => findIssues(transactions, rules, savedCategories, ownerName, left).filter((i) => !hidden.has(i.id)),
    [transactions, rules, savedCategories, ownerName, left, hidden],
  );
  // A flag stops applying once its payments have moved, however that happened.
  const flagItems = useMemo<FlagItem[]>(
    () =>
      flags.flatMap((flag) => {
        if (hidden.has(`flag:${flag.id}`)) return [];
        const group = transactions.filter((t) => t.merchantKey === flag.merchantKey && t.category === flag.currentCategory && !t.splits);
        return group.length ? [{ flag, ids: group.map((t) => t.id), example: group[0].description }] : [];
      }),
    [flags, hidden, transactions],
  );

  // The chart follows the category filter, and ends with the period's last month or week.
  const chartSource = filters.category ? parts.filter((t) => (filters.category === UNSORTED ? t.category === null : t.category === filters.category)) : parts;
  const latest = mine[0]?.day ?? today;
  const chartEnd = range.to ? (range.to < today ? range.to : today) : latest;
  const chartTitle = `${filters.category ? (filters.category === UNSORTED ? "Unsorted" : filters.category) : "Spending"} each ${chartUnit}`;

  const unpick = (ids: string[]) =>
    setPicks((p) => {
      const rest = { ...p };
      for (const id of ids) delete rest[id];
      return rest;
    });

  // ---- Undo ----

  function remember(label: string, run: () => Promise<boolean>) {
    const id = ++undoId.current;
    undoStack.current = [...undoStack.current, { id, label, run }].slice(-MAX_UNDO);
    setUndos(undoStack.current);
    return id;
  }

  /** Takes back the last change, or a particular one (a toast's Undo). */
  async function undo(id?: number) {
    const entry = id === undefined ? undoStack.current.at(-1) : undoStack.current.find((u) => u.id === id);
    if (!entry) return;
    undoStack.current = undoStack.current.filter((u) => u.id !== entry.id);
    setUndos(undoStack.current);
    const ok = await entry.run().catch(() => false);
    toast({ message: ok ? `Undone: ${entry.label}` : "Couldn't undo that" });
    refresh();
  }

  const latestUndo = useRef(undo);
  useEffect(() => {
    latestUndo.current = undo;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      void latestUndo.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** How these transactions are sorted now, to put back later. */
  const snapshot = (ids: string[]): SortingSnapshot[] => {
    const wanted = new Set(ids);
    return transactions.filter((t) => wanted.has(t.id)).map((t) => ({ id: t.id, category: t.category, sortedBy: t.sortedBy, splits: t.splits ?? null }));
  };

  /** Puts transactions back as a snapshot had them, on screen straight away. */
  async function restore(snaps: SortingSnapshot[]) {
    if (snaps.length === 0) return true;
    setPicks((p) => ({
      ...p,
      ...Object.fromEntries(snaps.map((s) => [s.id, { category: s.category, sortedBy: s.sortedBy as Transaction["sortedBy"], splits: s.splits }])),
    }));
    const res = await restoreSorting(snaps).catch(() => ({ ok: false as const }));
    if (!res.ok) unpick(snaps.map((s) => s.id));
    return res.ok;
  }

  /** Atlas's current read of these merchants, to put back later (null if it hasn't read one). */
  const merchantReads = (keys: string[]) => {
    const reads = keys.map((key) => transactions.find((t) => t.merchantKey === key));
    return reads.every((t) => t?.merchant && t.atlasCategory)
      ? reads.map((t) => ({ key: t!.merchantKey, name: t!.merchant!, category: t!.atlasCategory! }))
      : null;
  };

  async function pickCategory(t: Transaction, category: string | null) {
    const before = snapshot([t.id]);
    setPicks((p) => ({ ...p, [t.id]: { category, sortedBy: category === null ? null : "me", splits: null } }));
    const res = await categorise([t.id], category).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      unpick([t.id]);
      return toast({ message: "Couldn't change that category" });
    }
    remember(`${merchantName(t)} → ${category ?? (t.splits ? "not split" : "Atlas's pick")}`, () => restore(before));
    if (category === null) return refresh();
    // A rule for the rest, worded so it can't sweep up payments that were for other things.
    const pattern = safePattern(t, category, transactions);
    const others = ruleMatches({ pattern, category, amountCents: null }, transactions).filter(
      (o) => o.id !== t.id && !isFixed(o.sortedBy) && o.category !== category,
    );
    if (others.length === 0) return toast({ message: `Moved to ${category}` });
    toast({
      message: `Moved to ${category}`,
      actionLabel: pattern === t.merchantKey ? `All ${others.length + 1} like this` : `All ${others.length + 1} from ${merchantName(t)}`,
      onAction: () => void saveRules([{ pattern, category, amountCents: null }], []),
    });
  }

  /** My pick for many payments at once; undo hands them back to rules and Atlas. */
  async function pickMany(ids: string[], category: string) {
    const before = snapshot(ids);
    setPicks((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, { category, sortedBy: "me" as const, splits: null }])) }));
    const res = await categorise(ids, category).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      unpick(ids);
      toast({ message: "Couldn't move those" });
      return false;
    }
    const id = remember(`moving ${ids.length} to ${category}`, () => restore(before));
    toast({ message: `Moved ${ids.length} to ${category}`, onAction: () => void undo(id) });
    return true;
  }

  // ---- Things to check ----

  const hide = (id: string) => setHidden((h) => new Set(h).add(id));
  const unhide = (id: string) =>
    setHidden((h) => {
      const rest = new Set(h);
      rest.delete(id);
      return rest;
    });

  async function fixIssue(issue: Issue) {
    const fix = issue.fix;
    hide(issue.id);
    let ok = true;
    if (fix.type === "remove-rule") {
      const rule = rules.find((r) => r.id === fix.ruleId);
      if (rule) await deleteRule(rule);
    } else if (fix.type === "reread") {
      const reads = merchantReads(fix.keys);
      const res = await resortMerchants(fix.keys).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
      ok = res.ok;
      toast({ message: res.ok ? "Atlas sorted it again" : res.error });
      if (res.ok && reads) remember("Atlas sorting it again", () => restoreMerchants(reads).then((r) => r.ok));
      if (res.ok) refresh();
    } else if (fix.type === "rule") {
      ok = await saveRules([{ pattern: fix.pattern, category: fix.category, amountCents: null }], []);
    } else {
      ok = await pickMany(fix.ids, fix.category);
    }
    if (!ok) unhide(issue.id);
  }

  async function fixAtlasFlag(flag: MoneyFlag) {
    const key = `flag:${flag.id}`;
    const ids = transactions.filter((t) => t.merchantKey === flag.merchantKey && t.category === flag.currentCategory).map((t) => t.id);
    const before = snapshot(ids);
    const reads = merchantReads([flag.merchantKey]);
    hide(key);
    const res = await fixFlag(flag.id).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      unhide(key);
      return toast({ message: "Couldn't move those" });
    }
    const id = remember(`moving to ${flag.category}`, async () => {
      if (reads && !(await restoreMerchants(reads)).ok) return false;
      const ok = (await restore(before)) && (await reopenCheck(key)).ok;
      if (ok) unhide(key);
      return ok;
    });
    toast({ message: `Moved to ${flag.category}`, onAction: () => void undo(id) });
    refresh();
  }

  const unleave = (id: string) => {
    unhide(id);
    setLeft((l) => {
      const rest = new Set(l);
      rest.delete(id);
      return rest;
    });
  };

  async function leave(id: string) {
    if (id.startsWith("flag:")) hide(id);
    else setLeft((l) => new Set(l).add(id));
    const res = await leaveAlone(id).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      unleave(id);
      return toast({ message: "Couldn't save that" });
    }
    remember("leaving a thing to check", async () => {
      const ok = (await reopenCheck(id)).ok;
      if (ok) unleave(id);
      return ok;
    });
  }

  /** Atlas reviews the sorting: just what's new (after an upload) or everything. */
  async function review(scope: "new" | "all") {
    setReviewing(scope);
    const res = await reviewWithAtlas(scope).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    setReviewing(null);
    if (!res.ok) return toast({ message: res.error });
    if (res.flagged) toast({ message: `Atlas found ${res.flagged} thing${res.flagged === 1 ? "" : "s"} to check` });
    else if (scope === "all") toast({ message: "Atlas checked everything: nothing looks off" });
    refresh();
  }

  /** Saves splits; each payment's parts must add up to it. */
  async function saveSplits(items: { t: Transaction; parts: SplitPart[] }[]) {
    const biggest = (parts: SplitPart[]) => parts.reduce((a, b) => (Math.abs(b.cents) > Math.abs(a.cents) ? b : a)).category;
    setPicks((p) => ({ ...p, ...Object.fromEntries(items.map(({ t, parts }) => [t.id, { category: biggest(parts), sortedBy: "me" as const, splits: parts }])) }));
    const res = await splitTransactions(items.map(({ t, parts }) => ({ id: t.id, parts }))).catch(() => ({ ok: false as const }));
    if (!res.ok) unpick(items.map(({ t }) => t.id));
    return res.ok;
  }

  async function split(t: Transaction, parts: SplitPart[] | null) {
    setSplitting(null);
    if (parts === null) return pickCategory(t, null);
    const before = snapshot([t.id]);
    if (!(await saveSplits([{ t, parts }]))) return toast({ message: "Couldn't split that payment" });
    remember(`splitting ${merchantName(t)}`, () => restore(before));
    // The same payment again ("Mum · Money owed" three times) can be split the same way.
    const others = transactions.filter(
      (o) => o.id !== t.id && o.merchantKey === t.merchantKey && o.sortedBy !== "bank" && Math.sign(o.amountCents) === Math.sign(t.amountCents),
    );
    if (others.length === 0) return toast({ message: "Split saved" });
    const shares = parts.map((p) => ({ category: p.category, share: p.cents / t.amountCents }));
    toast({
      message: "Split saved",
      actionLabel: `Split all ${others.length + 1} the same way`,
      onAction: async () => {
        // A payment too small to split into whole cents is left as it is.
        const items = others.map((o) => ({ t: o, parts: splitByShares(o.amountCents, shares) })).filter((i) => i.parts.every((p) => p.cents !== 0));
        if (items.length === 0) return;
        const before = snapshot(items.map((i) => i.t.id));
        if (!(await saveSplits(items))) return toast({ message: "Couldn't split those payments" });
        const id = remember(`splitting ${items.length} more the same way`, () => restore(before));
        toast({ message: `Split ${items.length + 1} payments`, onAction: () => void undo(id) });
      },
    });
  }

  async function saveRules(drafts: Omit<Rule, "id">[], newCategories: string[]) {
    const res = await approveRules(drafts, newCategories).catch(() => ({ ok: false as const }));
    if (!res.ok) {
      toast({ message: "Couldn't save those rules" });
      return false;
    }
    const sorted = new Set(drafts.flatMap((r) => ruleMatches(r, transactions).filter((t) => !isFixed(t.sortedBy)).map((t) => t.id))).size;
    const label = res.rules.length === 1 ? `the rule ${titleCase(res.rules[0].pattern)} → ${res.rules[0].category}` : `${res.rules.length} rules`;
    const id = remember(label, async () => {
      for (const r of res.rules) if (!(await removeRule(r.id)).ok) return false;
      return true;
    });
    toast({ message: sorted ? `Sorted ${sorted} transaction${sorted === 1 ? "" : "s"}` : "Rule saved", onAction: () => void undo(id) });
    refresh();
    return true;
  }

  async function deleteRule(rule: Rule) {
    const res = await removeRule(rule.id).catch(() => ({ ok: false as const }));
    if (!res.ok) return toast({ message: "Couldn't delete that rule" });
    const id = remember(`deleting the rule ${titleCase(rule.pattern)}`, async () => (await approveRules([rule], []).catch(() => ({ ok: false as const }))).ok);
    toast({ message: "Rule deleted", onAction: () => void undo(id) });
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
        if (added) void review("new");
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
            <h2 className="text-[19px] font-bold tracking-tight">Connect Up, or start with a bank CSV</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              With Up Bank, Atlas pulls your transactions in by itself. For another bank, open your everyday account&apos;s transactions on its
              website (the desktop site usually has it, not the app), choose Export or Download, and pick CSV. A few months to a year is ideal.
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              Atlas sorts each merchant into a category, and you can tell it how in plain English. Nothing leaves Atlas except merchant names
              going to Claude for sorting.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <UpConnect status={up} today={today} onChanged={refresh} />
              <button
                type="button"
                onClick={() => setUploading(true)}
                className="flex h-10 items-center gap-2 rounded-xl bg-ink px-5 text-[15px] font-semibold text-canvas hover:opacity-90"
              >
                <FileUp className="size-5" /> Upload a CSV
              </button>
            </div>
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
          <div className="flex flex-wrap gap-2">
            {undos.length > 0 && (
              <button
                type="button"
                onClick={() => void undo()}
                title={`Undo ${undos.at(-1)!.label} (Ctrl+Z)`}
                className="flex h-10 max-w-full items-center gap-2 rounded-xl border border-line-strong px-4 text-[14.5px] font-medium hover:border-faint hover:bg-white/[0.03]"
              >
                <Undo2 className="size-[18px] shrink-0" strokeWidth={1.75} /> Undo
                <span className="hidden max-w-[14rem] truncate font-normal text-muted lg:inline">{undos.at(-1)!.label}</span>
              </button>
            )}
            <UpConnect status={up} today={today} onChanged={refresh} />
            <button
              type="button"
              onClick={() => setUploading(true)}
              className="flex h-10 items-center gap-2 rounded-xl border border-line-strong px-4 text-[14.5px] font-medium hover:border-faint hover:bg-white/[0.03]"
            >
              <FileUp className="size-[18px]" strokeWidth={1.75} /> Upload CSV
            </button>
          </div>
        </header>

        <AskAboutMoney
          transactions={allParts}
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
            <div className="order-1 flex flex-col gap-4">
              <ThingsToCheck
                issues={issues}
                flags={flagItems}
                reviewing={reviewing}
                checked={checkedLabel(reviewedAt, today)}
                onFix={(issue) => void fixIssue(issue)}
                onFixFlag={(flag) => void fixAtlasFlag(flag)}
                onLeave={(id) => void leave(id)}
                onShow={(title, ids) => showAnswer(title, ids, null, true)}
                onCheckAll={() => void review("all")}
              />
              <AskAtlas
                transactions={transactions}
                categories={categories}
                rules={rules}
                onApprove={saveRules}
                onRemoveRule={(r) => void deleteRule(r)}
                onSorted={() => {
                  refresh();
                  void review("new");
                }}
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
                onSplit={setSplitting}
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

      <SplitDialog transaction={splitting} categories={categories} onClose={() => setSplitting(null)} onSave={(t, p) => void split(t, p)} />

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
