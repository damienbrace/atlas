import "server-only";

// All server configuration, read from .env.local. Nothing here reaches the browser.

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  /** Extra addresses Atlas is reached on, comma-separated (e.g. the phone's Tailscale https address). */
  extraOrigins: (process.env.APP_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  ownerName: process.env.OWNER_NAME || "Damien",
  /** The one Google account allowed to sign in. Required once Atlas is on the internet. */
  ownerEmail: (process.env.OWNER_EMAIL ?? "").trim().toLowerCase(),
  /** Shared with the scheduled jobs (Supabase cron) that call /api/cron/*. */
  cronSecret: process.env.CRON_SECRET ?? "",
};

export const googleConfigured = () => Boolean(env.googleClientId && env.googleClientSecret && env.sessionSecret);

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * The address the browser used, if it's one Atlas is configured for, else APP_URL.
 * Google only returns to redirect addresses registered in the OAuth client.
 */
export function originFor(headers: Headers) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : null;
  return origin && [env.appUrl, ...env.extraOrigins].includes(origin) ? origin : env.appUrl;
}

export const googleRedirectUri = (origin: string) => `${origin}/api/auth/google/callback`;
