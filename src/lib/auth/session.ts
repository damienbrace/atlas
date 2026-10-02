import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { SESSION_COOKIE, seal, unseal } from "./seal";

// Signing in with Google gives this browser a session cookie holding the account
// and its refresh token, encrypted with SESSION_SECRET (AES-256-GCM). Only the
// owner's account (OWNER_EMAIL) gets one, so having a session means "it's me".
// The scheduled jobs use the server-side copy in ./account.ts instead.

const OAUTH_COOKIE = "atlas_oauth";
const SESSION_MAX_AGE = 60 * 60 * 24 * 180;

export interface Session {
  email: string;
  refreshToken: string;
  /** Google permissions granted, e.g. Gmail and Calendar read-only. Missing on older sessions. */
  scopes?: string[];
}

export interface OAuthState {
  state: string;
  verifier: string;
  /** The return address used for this sign-in; the code exchange must repeat it exactly. */
  redirectUri: string;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.appUrl.startsWith("https://"),
  path: "/",
  maxAge,
});

export async function getSession() {
  const store = await cookies();
  return unseal<Session>(store.get(SESSION_COOKIE)?.value);
}

/** Server Functions are public endpoints, so each one checks for the owner's session itself. */
export async function signedIn() {
  return (await getSession()) !== null;
}

/** Route Handlers and Server Functions only (cookies can't be set while rendering). */
export async function setSession(session: Session) {
  (await cookies()).set(SESSION_COOKIE, seal(session), cookieOptions(SESSION_MAX_AGE));
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function setOAuthState(state: OAuthState) {
  (await cookies()).set(OAUTH_COOKIE, seal(state), cookieOptions(600));
}

/** Reads and clears the one-time OAuth state. */
export async function takeOAuthState() {
  const store = await cookies();
  const state = unseal<OAuthState>(store.get(OAUTH_COOKIE)?.value);
  store.delete(OAUTH_COOKIE);
  return state;
}
