import type { Metadata } from "next";
import { connection } from "next/server";
import { ReviewPage } from "@/components/money/review-page";
import { dayKey } from "@/lib/life/days";
import { getUpStatus, listTransactions } from "@/lib/money/db";

export const metadata: Metadata = { title: "Money review · Atlas" };

export default async function MoneyReview() {
  await connection();
  const [transactions, up] = await Promise.all([listTransactions(), getUpStatus()]);
  return <ReviewPage transactions={transactions} accounts={up?.accounts ?? []} today={dayKey(new Date())} />;
}
