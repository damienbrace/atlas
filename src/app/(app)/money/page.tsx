import type { Metadata } from "next";
import { connection } from "next/server";
import { Money } from "@/components/money/money";
import { env } from "@/lib/env";
import { dayKey } from "@/lib/life/days";
import { getCategories, getLeftChecks, getReviewedAt, getUpStatus, listFlags, listRules, listTransactions, listUploads } from "@/lib/money/db";

export const metadata: Metadata = { title: "Money · Atlas" };

// Sorting a round of merchants with Claude can take a while; the page's Server Functions share this.
export const maxDuration = 60;

export default async function MoneyPage() {
  await connection();
  const [transactions, rules, categories, uploads, flags, leftChecks, reviewedAt, up] = await Promise.all([
    listTransactions(),
    listRules(),
    getCategories(),
    listUploads(),
    listFlags(),
    getLeftChecks(),
    getReviewedAt(),
    getUpStatus(),
  ]);
  return (
    <Money
      transactions={transactions}
      rules={rules}
      categories={categories}
      uploads={uploads}
      flags={flags}
      leftChecks={leftChecks}
      reviewedAt={reviewedAt}
      up={up}
      ownerName={env.ownerName}
      today={dayKey(new Date())}
    />
  );
}
