import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { saveGoogleAccount } from "@/lib/auth/account";
import { setSession, takeOAuthState } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { GmailClient } from "@/lib/gmail/client";
import { exchangeCode, GMAIL_SCOPE, rememberAccessToken, revoke } from "@/lib/gmail/oauth";

/** Google sends the browser back here after consent. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = await takeOAuthState();

  if (params.get("error")) redirect("/signin?error=denied");
  const code = params.get("code");
  if (!code || !saved || saved.state !== params.get("state")) redirect("/signin?error=failed");

  // redirect() throws, so keep it outside try/catch.
  const outcome = await connect(code, saved.verifier, saved.redirectUri).catch((error) => {
    console.error("[atlas] google sign-in failed", error);
    return "failed" as const;
  });
  if (outcome !== "ok") redirect(`/signin?error=${outcome}`);
  redirect("/brief");
}

async function connect(code: string, verifier: string, redirectUri: string) {
  const tokens = await exchangeCode(code, verifier, redirectUri);
  // Google's consent screen lets people untick permissions, so check what was granted.
  // Gmail is required; the rest are optional and checked where they're used.
  const scopes = tokens.scope.split(" ");
  if (!tokens.refresh_token || !scopes.includes(GMAIL_SCOPE)) return "missing-permission" as const;
  rememberAccessToken(tokens.refresh_token, tokens.access_token, tokens.expires_in);
  const { emailAddress } = await new GmailClient(tokens.refresh_token).profile();

  // Only the owner gets in. Anyone else's grant is handed straight back to Google.
  if (env.ownerEmail && emailAddress.toLowerCase() !== env.ownerEmail) {
    await revoke(tokens.refresh_token);
    return "not-owner" as const;
  }
  await saveGoogleAccount({ email: emailAddress, refreshToken: tokens.refresh_token, scopes });
  await setSession({ email: emailAddress, refreshToken: tokens.refresh_token, scopes });
  return "ok" as const;
}
