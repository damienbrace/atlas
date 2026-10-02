import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// Google OAuth for a single Gmail account: authorization code flow with PKCE,
// offline access so we get a refresh token.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** Put Atlas's drafts into Gmail's Drafts folder. Sending stays with you, in Gmail. */
export const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
/** Nightly backups: Atlas can only see the files it creates in Drive. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE, COMPOSE_SCOPE, DRIVE_FILE_SCOPE].join(" ");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Thrown when Google rejects the refresh token (revoked, or expired after 7 days in Testing mode). */
export class GmailAuthExpiredError extends Error {}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: randomBytes(16).toString("base64url") };
}

export function authorizationUrl(state: string, challenge: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    // Always show consent so Google returns a refresh token, even on reconnect.
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, ...body }),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new GmailAuthExpiredError(json.error_description ?? "invalid_grant");
    throw new Error(`Google token request failed: ${json.error ?? res.status}`);
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string, verifier: string, redirectUri: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
}

// Access tokens last an hour. Cache them in memory, keyed by a hash of the refresh token.
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

const cacheKey = (refreshToken: string) => createHash("sha256").update(refreshToken).digest("hex");

export function rememberAccessToken(refreshToken: string, token: string, expiresIn: number) {
  accessTokens.set(cacheKey(refreshToken), { token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
}

export function forgetAccessToken(refreshToken: string) {
  accessTokens.delete(cacheKey(refreshToken));
}

export async function accessTokenFor(refreshToken: string) {
  const cached = accessTokens.get(cacheKey(refreshToken));
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  rememberAccessToken(refreshToken, res.access_token, res.expires_in);
  return res.access_token;
}

export async function revoke(refreshToken: string) {
  forgetAccessToken(refreshToken);
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => {});
}
