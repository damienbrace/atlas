import type { Metadata } from "next";
import { Inbox } from "@/components/inbox/inbox";
import { getInbox } from "@/lib/inbox/source";

export const metadata: Metadata = { title: "Inbox · Atlas" };

// Outcomes of the Connect Gmail flow, passed back as ?gmail=…
const CONNECT_NOTICES: Record<string, string> = {
  "not-configured": "Add your Google OAuth keys to .env.local before connecting Gmail.",
  denied: "Gmail wasn't connected because access was declined on Google's screen.",
  failed: "Connecting Gmail didn't work. Try again.",
  "missing-permission": "Atlas needs permission to read your email. Tick that box on Google's screen and try again.",
};

export default async function InboxPage(props: PageProps<"/inbox">) {
  const { gmail, thread } = await props.searchParams;
  const data = await getInbox(typeof thread === "string" ? thread : undefined);
  const notice = typeof gmail === "string" ? CONNECT_NOTICES[gmail] : undefined;
  return <Inbox data={data} notice={notice} />;
}
