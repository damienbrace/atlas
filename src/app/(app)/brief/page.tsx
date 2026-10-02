import type { Metadata } from "next";
import { connection } from "next/server";
import { Brief } from "@/components/brief/brief";
import { getBrief } from "@/lib/brief";
import { pushPublicKey } from "@/lib/push";

export const metadata: Metadata = { title: "Brief · Atlas" };

export default async function BriefPage() {
  await connection();
  const [data, pushKey] = await Promise.all([getBrief(), pushPublicKey()]);
  return <Brief data={data} pushKey={pushKey} />;
}
