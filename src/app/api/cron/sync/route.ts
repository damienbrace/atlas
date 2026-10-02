import { after } from "next/server";
import { getGoogleAccount } from "@/lib/auth/account";
import { isCronRequest } from "@/lib/cron";
import { syncMail } from "@/lib/mail/sync";

// Supabase cron calls this every few minutes so mail keeps downloading and getting
// sorted while every browser is closed. It answers straight away and does the work
// after the response, because the caller doesn't wait around.

export const maxDuration = 300;
/** Leaves headroom under maxDuration to finish the current batch and release the lock. */
const RUN_MS = 240_000;

export async function POST(request: Request) {
  if (!isCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const account = await getGoogleAccount();
  if (!account) return Response.json({ ok: false, reason: "Google isn't connected" });
  after(() => syncMail(account.email, account.refreshToken, RUN_MS));
  return Response.json({ ok: true });
}
