import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

// The Gmail refresh token lives only in this browser's cookie, encrypted with
// SESSION_SECRET (AES-256-GCM). Nothing is stored server-side, so a browser that
// hasn't connected Gmail just sees the sample inbox.

const SESSION_COOKIE = "atlas_session";
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

function key() {
  if (!env.sessionSecret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(env.sessionSecret).digest();
}

export function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal<T>(sealed: string | undefined): T | null {
  if (!sealed || !env.sessionSecret) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    // Tampered, or sealed with a different SESSION_SECRET.
    return null;
  }
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
