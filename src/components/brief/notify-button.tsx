"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { disableNotifications, enableNotifications } from "@/app/(app)/brief/actions";
import { useToast } from "@/components/toast";
import type { DeviceSubscription } from "@/lib/push";

// "5am alerts": turns the morning brief notification on or off for this device.
// The service worker (/sw.js) shows the notifications; the subscription is saved
// on the server so the 5am job can reach this phone.

type State = "checking" | "unsupported" | "blocked" | "off" | "on" | "busy";

const BLOCKED_HELP = "Notifications are blocked for Atlas. In Chrome: ⋮ → Settings → Site settings → Notifications → allow Atlas.";

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The server's base64url public key as the bytes PushManager wants. */
function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

const asDevice = (sub: PushSubscription) => sub.toJSON() as unknown as DeviceSubscription;

export function NotifyButton({ publicKey }: { publicKey: string }) {
  const toast = useToast();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supported()) return setState("unsupported");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const sub = await registration.pushManager.getSubscription();
      if (!alive) return;
      if (sub) {
        setState("on");
        // Keep the server's copy current (it may have been dropped as expired).
        void enableNotifications(asDevice(sub), false);
      } else {
        setState(Notification.permission === "denied" ? "blocked" : "off");
      }
    })().catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  async function turnOn() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        if (permission === "denied") toast({ message: BLOCKED_HELP });
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const result = await enableNotifications(asDevice(sub), true);
      if (!result.ok) throw new Error("not saved");
      setState("on");
      toast({ message: result.delivered ? "Done. Your brief arrives at 5:00am." : "Turned on, but the test notification didn't arrive. Try again later." });
    } catch {
      setState("off");
      toast({ message: "Couldn't turn notifications on. Try again." });
    }
  }

  async function turnOff() {
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await disableNotifications(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      toast({ message: "5am alerts off on this device." });
    } catch {
      setState("on");
      toast({ message: "Couldn't turn notifications off. Try again." });
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  const on = state === "on";
  const Icon = state === "blocked" ? BellOff : on ? BellRing : Bell;
  return (
    <button
      type="button"
      disabled={state === "busy"}
      aria-pressed={on}
      title={on ? "5am brief notification is on. Tap to turn it off." : "Get your brief as a notification at 5:00am"}
      onClick={() => (state === "blocked" ? toast({ message: BLOCKED_HELP }) : on ? void turnOff() : void turnOn())}
      className={`flex h-10 items-center gap-2 rounded-full border px-4 text-[14px] disabled:opacity-50 ${
        on ? "border-teal/50 text-teal hover:bg-teal/10" : "border-line-strong text-ink-soft hover:border-faint hover:text-ink"
      }`}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
      {/* On a phone the label shows while it's off, so the button explains itself. */}
      <span className={on ? "hidden sm:inline" : ""}>{on ? "5am alerts on" : "5am alerts"}</span>
    </button>
  );
}
