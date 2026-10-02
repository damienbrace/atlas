import "server-only";
import { plural } from "@/lib/brief-summary";
import { dayKey } from "@/lib/life/days";
import { setSetting } from "@/lib/life/settings";
import { dueOpenTasks } from "@/lib/life/tasks";
import { sendPush } from "@/lib/push";

/**
 * The 5pm nudge: only if something due today (or overdue) is still open. How it went
 * is saved as the "push.lastNudge" setting, like the morning brief.
 */
export async function sendTaskNudge() {
  try {
    const open = await dueOpenTasks(dayKey(new Date()));
    if (open.length === 0) {
      await setSetting("push.lastNudge", { at: Date.now(), open: 0 });
      return;
    }
    const shown = open.slice(0, 3).map((t) => t.title);
    const message = {
      title: `${plural(open.length, "task")} still open today`,
      body: open.length > 3 ? `${shown.join(" · ")} · and ${open.length - 3} more` : shown.join(" · "),
      url: "/tasks",
      tag: "task-nudge",
    };
    const result = await sendPush(message);
    await setSetting("push.lastNudge", { at: Date.now(), open: open.length, ...message, ...result });
  } catch (error) {
    console.error("[atlas] task nudge failed", error);
    await setSetting("push.lastNudge", { at: Date.now(), error: error instanceof Error ? error.message : String(error) });
  }
}
