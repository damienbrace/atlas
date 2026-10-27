import { isCronRequest } from "@/lib/cron";

// Turned off: Hermes (Telegram) sends the morning brief now and posts a copy to the
// Brief page via /api/hermes/brief. The old 5:00am phone push lives in
// lib/morning-brief.ts if it's ever wanted back. The Supabase job is removed by
// `npm run db:cron`; this answers harmlessly if it still fires.

export async function POST(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, skipped: "Morning brief comes from Hermes" });
}
