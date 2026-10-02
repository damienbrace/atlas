import type { Metadata } from "next";
import { connection } from "next/server";
import { Brief } from "@/components/brief/brief";
import { getBrief } from "@/lib/brief";

export const metadata: Metadata = { title: "Brief · Atlas" };

export default async function BriefPage() {
  await connection();
  return <Brief data={await getBrief()} />;
}
