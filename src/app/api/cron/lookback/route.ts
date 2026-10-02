import { isCronRequest } from "@/lib/cron";
import { lookBackForTasks } from "@/lib/mail/sync";

// One-off (safe to repeat): has Atlas re-read the last fortnight's email, sorted before it
// looked for tasks, so task suggestions start full. ?categories=action,receipts limits it
// to those sorting categories. It remembers what it has done, so a rerun doesn't pay twice.

export const maxDuration = 300;
const CATEGORIES = ["action", "fyi", "receipts"];

export async function POST(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const asked = (new URL(request.url).searchParams.get("categories") ?? "action,receipts").split(",");
  const categories = asked.filter((c) => CATEGORIES.includes(c));
  if (categories.length === 0) return Response.json({ error: "No valid categories" }, { status: 400 });
  return Response.json(await lookBackForTasks(categories, 240_000));
}
