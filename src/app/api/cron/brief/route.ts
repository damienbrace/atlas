import { after } from "next/server";
import { isCronRequest } from "@/lib/cron";
import { sendMorningBrief } from "@/lib/morning-brief";

// Supabase cron calls this at 5:00am Perth time to send the morning brief to your
// phone. It answers straight away and does the work after the response.

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // sendMorningBrief records failures itself.
  after(() => sendMorningBrief().catch(() => {}));
  return Response.json({ ok: true });
}
