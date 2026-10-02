import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// The scheduled jobs (Supabase cron calling /api/cron/*) prove themselves with
// `Authorization: Bearer <CRON_SECRET>`. No secret configured means no jobs run.

const digest = (text: string) => createHash("sha256").update(text).digest();

export function isCronRequest(request: Request) {
  if (!env.cronSecret) return false;
  const given = request.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(given), digest(`Bearer ${env.cronSecret}`));
}
