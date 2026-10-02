import { after } from "next/server";
import { isCronRequest } from "@/lib/cron";
import { sendTaskNudge } from "@/lib/task-nudge";

// Supabase cron calls this at 5:00pm Perth time: a nudge if today's tasks aren't done.

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  after(sendTaskNudge);
  return Response.json({ ok: true });
}
