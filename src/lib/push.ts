import "server-only";
import webpush from "web-push";
import { seal, unseal } from "@/lib/auth/seal";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

// Phone notifications (Web Push). Each device that says yes stores a subscription;
// Atlas signs messages with its VAPID keys, made once and kept in the settings table
// (the private half sealed with SESSION_SECRET), so there's nothing to configure.

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url: string;
  /** A newer notification with the same tag replaces the older one. */
  tag: string;
}

export interface DeviceSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const KEYS_SETTING = "push.vapid";

async function vapidKeys() {
  const read = async () => {
    const [row] = await sql<{ value: { publicKey: string; privateKey: string } }[]>`SELECT value FROM settings WHERE key = ${KEYS_SETTING}`;
    const privateKey = row && unseal<string>(row.value.privateKey);
    return row && privateKey ? { publicKey: row.value.publicKey, privateKey } : null;
  };
  const existing = await read();
  if (existing) return existing;
  // First use: make a pair. If two requests race, the first write wins and both read it back.
  const fresh = webpush.generateVAPIDKeys();
  await sql`
    INSERT INTO settings (key, value) VALUES (${KEYS_SETTING}, ${sql.json({ publicKey: fresh.publicKey, privateKey: seal(fresh.privateKey) })})
    ON CONFLICT (key) DO NOTHING`;
  const saved = await read();
  if (!saved) throw new Error("Couldn't set up notification keys.");
  return saved;
}

/** The key a browser needs to subscribe. */
export async function pushPublicKey() {
  return (await vapidKeys()).publicKey;
}

export async function saveSubscription(sub: DeviceSubscription, userAgent: string | null) {
  await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at)
    VALUES (${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${userAgent?.slice(0, 300) ?? null}, ${Date.now()})
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`;
}

export async function deleteSubscription(endpoint: string) {
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

/** Sends to every subscribed device (or just `endpoint`), dropping ones the push service says are gone. */
export async function sendPush(message: PushMessage, endpoint?: string) {
  const { publicKey, privateKey } = await vapidKeys();
  const devices = endpoint
    ? await sql<{ endpoint: string; p256dh: string; auth: string }[]>`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ${endpoint}`
    : await sql<{ endpoint: string; p256dh: string; auth: string }[]>`SELECT endpoint, p256dh, auth FROM push_subscriptions`;
  let sent = 0;
  let removed = 0;
  const failures: string[] = [];
  for (const d of devices) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(message), {
        vapidDetails: { subject: `mailto:${env.ownerEmail || "atlas@example.com"}`, publicKey, privateKey },
        // A morning brief is stale by lunch; let the push service drop it after 6 hours.
        TTL: 6 * 3600,
        urgency: "high",
      });
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Unsubscribed, or the browser's data was cleared.
        await deleteSubscription(d.endpoint);
        removed++;
      } else {
        failures.push(`${status ?? ""} ${error instanceof Error ? error.message : String(error)}`.trim().slice(0, 200));
      }
    }
  }
  return { devices: devices.length, sent, removed, failures };
}
