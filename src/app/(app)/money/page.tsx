import type { Metadata } from "next";
import { connection } from "next/server";
import { Money } from "@/components/money/money";
import { dayKey } from "@/lib/life/days";
import { getCategories, listRules, listTransactions, listUploads } from "@/lib/money/db";

export const metadata: Metadata = { title: "Money · Atlas" };

// Sorting a round of merchants with Claude can take a while; the page's Server Functions share this.
export const maxDuration = 60;

export default async function MoneyPage() {
  await connection();
  const [transactions, rules, categories, uploads] = await Promise.all([listTransactions(), listRules(), getCategories(), listUploads()]);
  return <Money transactions={transactions} rules={rules} categories={categories} uploads={uploads} today={dayKey(new Date())} />;
}
