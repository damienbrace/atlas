import type { Metadata } from "next";
import { connection } from "next/server";
import { Journal } from "@/components/journal/journal";
import { dayKey } from "@/lib/life/days";
import { listEntries } from "@/lib/life/journal";

export const metadata: Metadata = { title: "Journal · Atlas" };

export default async function JournalPage() {
  await connection();
  return <Journal entries={listEntries()} today={dayKey(new Date())} />;
}
