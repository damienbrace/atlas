"use server";

import { headers } from "next/headers";
import { signedIn } from "@/lib/auth/session";
import { isBriefSection } from "@/lib/brief-sections";
import { setSetting } from "@/lib/life/settings";
import { deleteSubscription, saveSubscription, sendPush, type DeviceSubscription } from "@/lib/push";

// Server Functions are public endpoints: validate every input.

/** Which parts of the Brief are hidden. */
export async function saveBriefHidden(hidden: string[]) {
  if (!(await signedIn())) return { ok: false as const };
  if (!Array.isArray(hidden) || !hidden.every(isBriefSection)) return { ok: false as const };
  await setSetting("brief.hidden", [...new Set(hidden)]);
  return { ok: true as const };
}

const isKey = (k: unknown) => typeof k === "string" && /^[A-Za-z0-9_-]{8,200}={0,2}$/.test(k);

function isSubscription(sub: unknown): sub is DeviceSubscription {
  const s = sub as DeviceSubscription | null;
  return (
    typeof s?.endpoint === "string" &&
    s.endpoint.startsWith("https://") &&
    s.endpoint.length < 1000 &&
    isKey(s.keys?.p256dh) &&
    isKey(s.keys?.auth)
  );
}

/**
 * Saves this phone's notification subscription. `welcome` sends a test notification
 * straight away (when first turned on); a quiet call just keeps the server's copy current.
 */
export async function enableNotifications(sub: DeviceSubscription, welcome: boolean) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isSubscription(sub) || typeof welcome !== "boolean") return { ok: false as const };
  await saveSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, (await headers()).get("user-agent"));
  if (!welcome) return { ok: true as const, delivered: true };
  const result = await sendPush(
    { title: "Atlas notifications are on", body: "Your brief will arrive here at 5:00am every morning.", url: "/brief", tag: "atlas-welcome" },
    sub.endpoint,
  );
  return { ok: true as const, delivered: result.sent > 0 };
}

export async function disableNotifications(endpoint: string) {
  if (!(await signedIn())) return { ok: false as const };
  if (typeof endpoint !== "string" || endpoint.length > 1000) return { ok: false as const };
  await deleteSubscription(endpoint);
  return { ok: true as const };
}
