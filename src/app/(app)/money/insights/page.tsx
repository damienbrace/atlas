import type { Metadata } from "next";
import { connection } from "next/server";
import { InsightsPage } from "@/components/money/insights-page";
import { env } from "@/lib/env";
import { dayKey } from "@/lib/life/days";
import { getCategories, getLeftChecks, getUpStatus, listFlags, listRules, listTransactions, recentAlerts } from "@/lib/money/db";

export const metadata: Metadata = { title: "Money insights · Atlas" };

export default async function MoneyInsights() {
  await connection();
  const [transactions, up, flags, leftChecks, rules, categories, alerts] = await Promise.all([
    listTransactions(),
    getUpStatus(),
    listFlags(),
    getLeftChecks(),
    listRules(),
    getCategories(),
    recentAlerts(6),
  ]);
  return (
    <InsightsPage
      transactions={transactions}
      up={up}
      flags={flags}
      leftChecks={leftChecks}
      rules={rules}
      categories={categories}
      alerts={alerts}
      ownerName={env.ownerName}
      today={dayKey(new Date())}
    />
  );
}
