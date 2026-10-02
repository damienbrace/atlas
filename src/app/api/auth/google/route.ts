import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { setOAuthState } from "@/lib/auth/session";
import { googleConfigured, googleRedirectUri, originFor } from "@/lib/env";
import { authorizationUrl, newPkce } from "@/lib/gmail/oauth";

/** Starts "Sign in with Google": sends the browser to Google's consent screen. */
export async function GET(request: NextRequest) {
  if (!googleConfigured()) redirect("/signin?error=not-configured");
  const { verifier, challenge, state } = newPkce();
  // Come back to whichever configured address this browser is using (desktop or phone).
  const redirectUri = googleRedirectUri(originFor(request.headers));
  await setOAuthState({ state, verifier, redirectUri });
  redirect(authorizationUrl(state, challenge, redirectUri));
}
