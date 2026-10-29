import { redirect } from "next/navigation";

// Email is handled by Hermes now, so Atlas has no inbox.
export default function InboxPage() {
  redirect("/brief");
}
