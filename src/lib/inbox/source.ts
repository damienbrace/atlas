import "server-only";
import { connection } from "next/server";
import { getSession } from "@/lib/auth/session";
import { aiConfigured, googleConfigured } from "@/lib/env";
import { firstPage, threadRow } from "@/lib/mail/inbox";
import { startSync, syncStatus } from "@/lib/mail/sync";
import { buildSampleInbox } from "./sample-data";
import type { Email, InboxData } from "./types";

const newestFirst = (a: Email, b: Email) => b.receivedAt.localeCompare(a.receivedAt);

/**
 * The inbox screen's data: live Gmail (from the local mail store, which syncs in
 * the background) when connected, otherwise the sample inbox. Never waits on Gmail.
 */
export async function getInbox(focusThreadId?: string): Promise<InboxData> {
  // Per-request: depends on cookies, the clock and live mail.
  await connection();
  const session = googleConfigured() ? await getSession() : null;

  if (!session) {
    return {
      source: "sample",
      emails: buildSampleInbox(new Date()).sort(newestFirst),
      setup: { google: googleConfigured(), ai: aiConfigured() },
    };
  }

  startSync(session.email, session.refreshToken);
  const focusId = focusThreadId && /^[0-9a-f]{6,32}$/i.test(focusThreadId) ? focusThreadId : null;
  const [{ emails, cursor, hasOlder }, { expired, problem, ...sync }, focus] = await Promise.all([
    firstPage(),
    syncStatus(),
    focusId ? threadRow(focusId) : null,
  ]);
  return {
    source: "gmail",
    account: session.email,
    emails,
    focus: focus ?? undefined,
    cursor,
    hasOlder,
    sync,
    ai: aiConfigured(),
    status: expired ? "expired" : "ok",
    problem: problem ?? undefined,
  };
}
