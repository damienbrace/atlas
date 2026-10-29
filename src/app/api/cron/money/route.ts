import { after } from "next/server";
import { isCronRequest } from "@/lib/cron";
import { morningMoney } from "@/lib/money/jobs";

// Supabase cron calls this early each morning: catch up with Up (in case one of its calls
// was missed), sort any new merchants, and have Atlas check what's new. It answers straight
// away and does the work after the response, because the caller doesn't wait around.

export const maxDuration = 300;
/** Leaves headroom under maxDuration for the sorting and the check after the sync. */
const SYNC_MS = 180_000;

export async function POST(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  after(() => morningMoney(SYNC_MS).catch((error) => console.error("Morning money job", error)));
  return Response.json({ ok: true });
}
