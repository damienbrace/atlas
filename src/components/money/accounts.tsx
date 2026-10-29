"use client";

import { useMemo } from "react";
import { shortDay } from "@/lib/life/days";
import { accountInsights } from "@/lib/money/accounts";
import type { Range } from "@/lib/money/periods";
import type { Recurring } from "@/lib/money/recurring";
import { money, type Transaction } from "@/lib/money/types";
import { syncedLabel, type UpStatus } from "./up-connect";

// Up's accounts on the Money page: Spending with what's pending and what's left after this
// week's repeat bills, then each saver with what went into it over the period.

interface UpAccountsProps {
  up: UpStatus;
  /** Every transaction counted in the totals, whichever account the page is showing. */
  transactions: Transaction[];
  range: Range;
  /** "this month", "last week", … */
  periodWords: string;
  recurring: Recurring[];
  today: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function UpAccounts({ up, transactions, range, periodWords, recurring, today }: UpAccountsProps) {
  const info = useMemo(() => accountInsights(up.accounts, transactions, range, recurring, today), [up.accounts, transactions, range, recurring, today]);
  if (up.accounts.length === 0) return null;

  return (
    <section aria-label="Accounts" className="rounded-2xl border border-line bg-panel p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-tight">Accounts</h2>
        <p className="text-[13px] text-muted">Up · {syncedLabel(up.lastSyncAt, today)}</p>
      </div>

      {info.spending.map((a) => (
        <div key={a.name} className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[15px] text-ink">
              <span className="truncate">{a.name}</span>
              {a.joint && <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-[11.5px] text-muted">joint</span>}
            </span>
            <span className={`shrink-0 leading-tight font-semibold tracking-tight tabular-nums ${a.joint ? "text-[18px]" : "text-[26px]"}`}>
              {money(a.balanceCents)}
            </span>
          </div>
          {a.pendingCents !== 0 && <p className="mt-0.5 text-right text-[13px] text-amber tabular-nums">{money(a.pendingCents, { sign: true })} still pending</p>}
        </div>
      ))}
      {info.spending.some((a) => !a.joint) && (
        <details className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[13.5px]">
          <summary className="cursor-pointer text-ink-soft">
            {info.bills.length ? (
              <>
                <span className={`font-semibold tabular-nums ${info.afterBillsCents < 0 ? "text-red" : "text-ink"}`}>{money(info.afterBillsCents)}</span> after{" "}
                {plural(info.bills.length, "repeat bill")} due by {shortDay(info.billsBy)}
              </>
            ) : (
              "No repeat bills due in the next 7 days"
            )}
          </summary>
          {info.bills.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {info.bills.map((b) => (
                <li key={b.key} className="flex justify-between gap-3 text-muted">
                  <span className="min-w-0 truncate">
                    {b.name} · {shortDay(b.nextDay)}
                  </span>
                  <span className="shrink-0 tabular-nums">{money(b.typicalCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

      {info.savers.length > 0 && (
        <>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="text-[14px] font-semibold text-ink">Savers</h3>
            <p className="text-[13px] text-muted tabular-nums">
              <span className={info.savedCents > 0 ? "text-green" : info.savedCents < 0 ? "text-red" : ""}>{money(info.savedCents, { sign: true })}</span>{" "}
              {periodWords}
              {info.roundUpCents > 0 && ` · ${money(info.roundUpCents)} from round-ups`}
            </p>
          </div>
          <ul className="mt-1 divide-y divide-line">
            {info.savers.map((s) => (
              <li key={s.name} className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-baseline gap-3 py-2 text-[14px]">
                <span className="min-w-0 truncate text-ink-soft">{s.name}</span>
                <span className={`text-[12.5px] tabular-nums ${s.addedCents > 0 ? "text-green" : s.addedCents < 0 ? "text-red" : "text-faint"}`}>
                  {s.addedCents ? money(s.addedCents, { sign: true }) : ""}
                </span>
                <span className="text-right tabular-nums text-ink">{money(s.balanceCents, { whole: true })}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {info.others.map((a) => (
        <div key={a.name} className="mt-3 flex justify-between gap-3 text-[14px]">
          <span className="text-ink-soft">{a.name}</span>
          <span className="tabular-nums">{money(a.balanceCents)}</span>
        </div>
      ))}

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[14px]">
        <span className="text-muted">All accounts</span>
        <span className="font-semibold tabular-nums">{money(info.totalCents)}</span>
      </div>
    </section>
  );
}
