"use client";

import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { askAboutMoney } from "@/app/(app)/money/actions";
import { Sparkle } from "@/components/sparkle";
import { useToast } from "@/components/toast";
import { merchantName } from "@/lib/money/merchant";
import { answer, spanLabel, upIsGood, type Answer, type MoneyQuery, type QueryKind, type Span } from "@/lib/money/question";
import { paymentId } from "@/lib/money/split";
import { money, type Transaction } from "@/lib/money/types";

// "How much on takeaway since July?" Claude only reads the question and picks the
// filters; the sums are done here over the real transactions, so every number is exact.
// What Atlas counted is always spelled out underneath, so a misread is easy to spot.

const EXAMPLES = ["Where does my money go?", "Fuel this month vs last month", "Biggest purchases this year", "Groceries a month on average"];

const KIND_LABELS: Record<QueryKind, string> = {
  spending: "Spending",
  income: "Money in",
  net: "Money in minus spending",
  "transfers-out": "Transfers out",
  "transfers-in": "Transfers in",
};

/** Follow-ups ("and last month?") are read against this many earlier questions. */
const EARLIER = 3;

interface Asked {
  question: string;
  query: MoneyQuery | null;
  /** When the transactions can't answer it: what Atlas can do instead. */
  reply: string;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-AU")} ${word}${n === 1 ? "" : "s"}`;

function format(q: MoneyQuery, value: number) {
  if (q.measure === "count") return plural(value, "transaction");
  const amount = money(value, { sign: q.kind === "net" });
  if (q.measure === "average") return `${amount} each`;
  if (q.measure === "per-week") return `${amount} a week`;
  return q.measure === "per-month" ? `${amount} a month` : amount;
}

/** What Atlas counted, in plain words: "Spending · Eating out · over $20.00". */
function counted(q: MoneyQuery) {
  const parts = [KIND_LABELS[q.kind]];
  if (q.categories.length) parts.push(q.categories.join(" or "));
  const names = [...q.merchants, ...q.words.map((w) => `“${w}”`)];
  if (names.length) parts.push(names.join(" or "));
  if (q.accounts.length) parts.push(q.accounts.join(" or "));
  if (q.minCents !== null && q.maxCents !== null) parts.push(`${money(q.minCents)} to ${money(q.maxCents)}`);
  else if (q.minCents !== null) parts.push(`${money(q.minCents)} or more`);
  else if (q.maxCents !== null) parts.push(`up to ${money(q.maxCents)}`);
  return parts.join(" · ");
}

function Headline({ q, a }: { q: MoneyQuery; a: Answer }) {
  const units: Partial<Record<MoneyQuery["measure"], string>> = { average: "per transaction", "per-week": "a week", "per-month": "a month" };
  const unit = q.measure === "count" ? (a.value === 1 ? "transaction" : "transactions") : (units[q.measure] ?? null);
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
      <span className={`text-[30px] leading-tight font-semibold tracking-tight tabular-nums ${q.kind === "net" && a.value < 0 ? "text-red" : ""}`}>
        {q.measure === "count" ? a.value.toLocaleString("en-AU") : money(a.value, { sign: q.kind === "net" })}
      </span>
      {unit && <span className="text-[15px] text-muted">{unit}</span>}
    </p>
  );
}

function Comparison({ q, a }: { q: MoneyQuery; a: Answer }) {
  const c = a.compare;
  if (!c) return null;
  const label = spanLabel(c.span);
  if (c.count === 0) return <p className="mt-1.5 text-[13.5px] text-faint">Nothing from {label} to compare with</p>;
  // A percentage says little when one side is nothing.
  if (c.value === 0 || a.value === 0) return <p className="mt-1.5 text-[13.5px] text-muted">Against {format(q, c.value)} from {label}</p>;
  const change = (a.value - c.value) / Math.abs(c.value);
  const flat = Math.abs(change) < 0.005;
  const better = upIsGood(q);
  const good = flat || better === null ? null : change > 0 === better;
  const Arrow = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={`mt-1.5 flex items-start gap-1 text-[13.5px] ${good === null ? "text-muted" : good ? "text-green" : "text-red"}`}>
      {!flat && <Arrow className="mt-0.5 size-3.5 shrink-0" />}
      <span>
        {flat ? "Same as" : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? "more than" : "less than"}`} {label} ({format(q, c.value)})
      </span>
    </p>
  );
}

/** One measure, so one colour; each value is written out too. */
function Breakdown({ q, a }: { q: MoneyQuery; a: Answer }) {
  const valueOf = (g: Answer["groups"][number]) => (q.measure === "count" ? g.count : g.cents);
  const max = Math.max(...a.groups.map(valueOf), 0);
  return (
    <>
      <ul className="mt-4 flex flex-col">
        {a.groups.map((g) => {
          const v = valueOf(g);
          return (
            <li
              key={g.label}
              title={`${g.label}: ${money(g.cents, { sign: q.kind === "net" })} · ${plural(g.count, "transaction")}`}
              className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 py-[5px]"
            >
              <span className="truncate text-[14px] text-ink">{g.label}</span>
              <span className="h-3" aria-hidden="true">
                {v > 0 && max > 0 && <span className="block h-full rounded-r-[4px] bg-blue" style={{ width: `${Math.max((v / max) * 100, 1.5)}%` }} />}
              </span>
              <span className="text-right text-[14px] tabular-nums">
                {q.measure === "count" ? v.toLocaleString("en-AU") : money(v, { whole: true, sign: q.kind === "net" })}
              </span>
            </li>
          );
        })}
      </ul>
      {a.moreGroups > 0 && <p className="mt-1 text-[13px] text-faint">and {a.moreGroups.toLocaleString("en-AU")} more</p>}
    </>
  );
}

function Largest({ a }: { a: Answer }) {
  return (
    <ol className="mt-3 divide-y divide-line">
      {a.largest.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] text-ink">{merchantName(t)}</span>
            <span className="block truncate text-[12.5px] text-faint">
              {spanLabel({ from: t.day, to: t.day })}
              {t.category && ` · ${t.category}`}
            </span>
          </span>
          <span className={`shrink-0 text-[14.5px] tabular-nums ${t.amountCents > 0 ? "text-green" : "text-ink"}`}>{money(t.amountCents, { sign: true })}</span>
        </li>
      ))}
    </ol>
  );
}

/** The dates to show an answer's transactions over; null when it covers everything. */
const shownSpan = (q: MoneyQuery, a: Answer) => (q.range.from || q.range.to ? a.span : null);
/** The payments behind an answer, for the list (which shows a split payment once). */
const paymentIds = (a: Answer) => [...new Set(a.matches.map(paymentId))];

interface AskAboutMoneyProps {
  /** Every transaction, whatever period or account the page is showing, with split payments as their parts. */
  transactions: Transaction[];
  today: string;
  /** The list is showing an answer's transactions, so it should follow the next answer too. */
  following: boolean;
  /** Shows the answer's transactions in the list; `scroll` takes the page down to it. */
  onShow: (title: string, ids: string[], span: Span | null, scroll: boolean) => void;
  /** Takes the answer's transactions off the list. */
  onClear: () => void;
}

export function AskAboutMoney({ transactions, today, following, onShow, onClear }: AskAboutMoneyProps) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [earlier, setEarlier] = useState<{ question: string; title: string }[]>([]);

  // Worked out again whenever a category changes, so the answer stays true.
  const result = useMemo(() => (asked?.query ? answer(asked.query, transactions, today) : null), [asked, transactions, today]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    const res = await askAboutMoney(q, earlier).catch(() => ({ ok: false as const, error: "Couldn't reach Atlas. Try again." }));
    setAsking(false);
    if (!res.ok) return toast({ message: res.error });
    setAsked({ question: q, query: res.query, reply: res.reply });
    if (res.query) setEarlier((e) => [...e, { question: q, title: res.query!.title }].slice(-EARLIER));
    setText("");
    // Once the list is showing answers, it keeps up with each new one (staying put on the page).
    if (following) {
      if (!res.query) return onClear();
      const next = answer(res.query, transactions, today);
      onShow(res.query.title, paymentIds(next), shownSpan(res.query, next), false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(text);
  }

  function close() {
    setAsked(null);
    setEarlier([]);
    if (following) onClear();
  }

  const q = asked?.query ?? null;
  const n = result?.count ?? 0;

  return (
    <section
      aria-label="Ask Atlas about your money"
      className="rounded-2xl border border-l-[3px] border-line border-l-teal bg-panel p-3 shadow-[0_0_32px_-16px_rgba(45,212,191,0.45)] md:p-4"
    >
      <form onSubmit={submit} className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line-strong bg-card px-3.5 focus-within:border-teal/60">
          <Sparkle className={`size-4 ${asking ? "animate-shimmer" : ""}`} glow />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            enterKeyHint="send"
            placeholder={earlier.length ? "Ask a follow-up, e.g. “and last year?”" : "Ask Atlas, e.g. “How much on takeaway since July?”"}
            aria-label="Ask Atlas about your money"
            className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint"
          />
        </label>
        <button
          type="submit"
          disabled={asking || !text.trim()}
          className="h-11 shrink-0 rounded-xl bg-teal px-4 text-[14.5px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
        >
          {asking ? "Thinking…" : "Ask"}
        </button>
      </form>
      <p role="status" className="sr-only">
        {asking ? "Atlas is working it out" : ""}
      </p>

      {!asked && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={asking}
              onClick={() => void ask(example)}
              className="h-8 rounded-full border border-line-strong px-3 text-[13px] text-ink-soft hover:border-teal/60 hover:text-ink disabled:opacity-40"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {asked && (
        <div className="mt-3 rounded-xl border border-line bg-card p-4" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-muted">“{asked.question}”</p>
              {q && <h3 className="mt-0.5 text-[16px] font-semibold tracking-tight">{q.title}</h3>}
            </div>
            <button
              type="button"
              aria-label="Close the answer"
              onClick={close}
              className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>

          {!q || !result ? (
            <p className="mt-2 text-[14.5px] text-ink">{asked.reply}</p>
          ) : (
            <>
              {q.measure === "largest" ? (
                <p className="mt-2 text-[13.5px] text-muted">
                  {n ? `Biggest ${result.largest.length} of ${plural(n, "transaction")}` : "No transactions match"} · {spanLabel(result.span)}
                </p>
              ) : (
                <>
                  <Headline q={q} a={result} />
                  <p className="mt-0.5 text-[13.5px] text-muted">
                    {[
                      q.measure !== "count" && (n ? plural(n, "transaction") : "No transactions match"),
                      (q.measure === "per-week" || q.measure === "per-month") &&
                        n > 0 &&
                        `${money(result.totalCents, { sign: q.kind === "net" })} over ${(q.measure === "per-week" ? result.weeks : result.months).toFixed(1).replace(/\.0$/, "")} ${q.measure === "per-week" ? "weeks" : "months"}`,
                      spanLabel(result.span),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <Comparison q={q} a={result} />
                </>
              )}
              {result.dataEnds && (
                <p className="mt-1.5 text-[13px] text-amber">Your transactions stop at {spanLabel({ from: result.dataEnds, to: result.dataEnds })}. Upload a newer CSV for the rest.</p>
              )}

              {result.groups.length > 0 && <Breakdown q={q} a={result} />}
              {result.largest.length > 0 && <Largest a={result} />}

              <p className="mt-3 text-[13px] text-muted">Counted: {counted(q)}</p>
              <button
                type="button"
                disabled={n === 0}
                onClick={() => onShow(q.title, paymentIds(result), shownSpan(q, result), true)}
                className="mt-3 h-10 rounded-xl border border-line-strong px-3.5 text-[14.5px] hover:border-faint disabled:opacity-40"
              >
                {n === 1 ? "Show this transaction" : n > 1 ? `Show these ${plural(n, "transaction")}` : "Show transactions"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
