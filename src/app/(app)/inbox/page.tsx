import type { Metadata } from "next";
import { Inbox } from "@/components/inbox/inbox";
import { getInbox } from "@/lib/inbox/source";

export const metadata: Metadata = { title: "Inbox · Atlas" };

export default async function InboxPage(props: PageProps<"/inbox">) {
  const { thread } = await props.searchParams;
  const data = await getInbox(typeof thread === "string" ? thread : undefined);
  return <Inbox data={data} />;
}
