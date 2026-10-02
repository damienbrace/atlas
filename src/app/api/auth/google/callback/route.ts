import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { setSession, takeOAuthState } from "@/lib/auth/session";
import { GmailClient } from "@/lib/gmail/client";
import { exchangeCode, GMAIL_SCOPE, rememberAccessToken } from "@/lib/gmail/oauth";

/** Google sends the browser back here after consent. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = await takeOAuthState();

  if (params.get("error")) redirect("/inbox?gmail=denied");
  const code = params.get("code");
  if (!code || !saved || saved.state !== params.get("state")) redirect("/inbox?gmail=failed");

  // redirect() throws, so keep it outside try/catch.
  const account = await connect(code, saved.verifier, saved.redirectUri).catch((error) => {
    console.error("[atlas] google connect failed", error);
    return null;
  });
  if (account === "missing-permission") redirect("/inbox?gmail=missing-permission");
  if (!account) redirect("/inbox?gmail=failed");
  redirect("/inbox");
}

async function connect(code: string, verifier: string, redirectUri: string) {
  const tokens = await exchangeCode(code, verifier, redirectUri);
  // Google's consent screen lets people untick permissions, so check what was granted.
  // Gmail is required; Calendar is optional and checked where it's used.
  const scopes = tokens.scope.split(" ");
  if (!tokens.refresh_token || !scopes.includes(GMAIL_SCOPE)) return "missing-permission";
  rememberAccessToken(tokens.refresh_token, tokens.access_token, tokens.expires_in);
  const { emailAddress } = await new GmailClient(tokens.refresh_token).profile();
  await setSession({ email: emailAddress, refreshToken: tokens.refresh_token, scopes });
  return emailAddress;
}
