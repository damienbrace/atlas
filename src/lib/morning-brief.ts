import "server-only";
import { getGoogleAccount } from "@/lib/auth/account";
import { buildBrief } from "@/lib/brief";
import { summaryParts, summarySentence } from "@/lib/brief-summary";
import { setSetting } from "@/lib/life/settings";
import { sendPush } from "@/lib/push";

/**
 * Builds today's Brief and sends its one-line summary to every phone that turned
 * notifications on. How it went is saved as the "push.lastBrief" setting, since the
 * server's own logs aren't easy to get at.
 */
export async function sendMorningBrief() {
  try {
    const data = await buildBrief(await getGoogleAccount());
    const hidden = new Set(data.hidden);
    const body = summarySentence(summaryParts(data).filter((p) => !hidden.has(p.section)).map((p) => p.text));
    const temp = data.weather && !hidden.has("weather") ? ` · ${data.weather.now.temp}°` : "";
    const message = { title: `${data.greeting}, ${data.name}${temp}`, body, url: "/brief", tag: "morning-brief" };
    const result = await sendPush(message);
    await setSetting("push.lastBrief", { at: Date.now(), ...message, ...result });
    return result;
  } catch (error) {
    console.error("[atlas] morning brief failed", error);
    await setSetting("push.lastBrief", { at: Date.now(), error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
