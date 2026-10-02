"use server";

import { headers } from "next/headers";
import { signedIn } from "@/lib/auth/session";
import { isBriefSection } from "@/lib/brief-sections";
import { isDayKey } from "@/lib/life/days";
import { setSetting } from "@/lib/life/settings";
import { addTask, setTaskDone } from "@/lib/life/tasks";
import { deleteSubscription, saveSubscription, sendPush, type DeviceSubscription } from "@/lib/push";

// Server Functions are public endpoints: validate every input.

const isId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);

export async function createTask(title: string, dueDay: string | null) {
  if (!(await signedIn())) return { ok: false as const };
  if (typeof title !== "string" || !title.trim() || title.length > 200) return { ok: false as const };
  if (dueDay !== null && !isDayKey(dueDay)) return { ok: false as const };
  return { ok: true as const, id: await addTask(title.trim(), dueDay, "manual") };
}

export async function markTask(id: string, done: boolean) {
  if (!(await signedIn())) return { ok: false as const };
  if (!isId(id) || typeof done !== "boolean") return { ok: false as const };
  await setTaskDone(id, done);
  return { ok: true as const };
}

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
