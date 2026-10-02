import "server-only";
import { sql, textList } from "@/lib/db";
import { seal, unseal } from "./seal";

// The Google connection kept server-side, so the scheduled jobs (mail sync, the
// 5am brief, backups) can work while every browser is closed. The refresh token
// is sealed with SESSION_SECRET, like the session cookie.

export interface GoogleAccount {
  email: string;
  refreshToken: string;
  scopes: string[];
}

export async function saveGoogleAccount(account: GoogleAccount) {
  await sql`
    INSERT INTO google_account (email, refresh_token, scopes, updated_at)
    VALUES (${account.email}, ${seal(account.refreshToken)}, ${textList(account.scopes)}, ${Date.now()})
    ON CONFLICT (email) DO UPDATE SET
      refresh_token = EXCLUDED.refresh_token, scopes = EXCLUDED.scopes, updated_at = EXCLUDED.updated_at`;
}

/** The connected account, or null if none (or it was sealed with a different SESSION_SECRET). */
export async function getGoogleAccount(): Promise<GoogleAccount | null> {
  const [row] = await sql<{ email: string; refresh_token: string; scopes: string[] }[]>`
    SELECT email, refresh_token, scopes FROM google_account ORDER BY updated_at DESC LIMIT 1`;
  const refreshToken = row && unseal<string>(row.refresh_token);
  return row && refreshToken ? { email: row.email, refreshToken, scopes: row.scopes } : null;
}

export async function deleteGoogleAccounts() {
  await sql`DELETE FROM google_account`;
}
