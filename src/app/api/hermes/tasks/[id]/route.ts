import type { NextRequest } from "next/server";
import { z } from "zod";
import { isHermesRequest } from "@/lib/hermes";
import { isDayKey } from "@/lib/life/days";
import { REPEATS, TASK_AREAS } from "@/lib/life/task-rules";
import { deleteTask, setTaskDone, updateTask, type TaskChange } from "@/lib/life/tasks";

// One task, for Hermes. PATCH {done?, title?, dueDay?, area?, priority?, notes?, repeat?}
// (ticking a repeating task makes the next one, same as in the app). DELETE removes it.

const ID = /^[0-9a-f-]{36}$/i;
const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

const Change = z.object({
  done: z.boolean().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  dueDay: z.string().refine(isDayKey, "YYYY-MM-DD").nullable().optional(),
  area: z.enum(TASK_AREAS).nullable().optional(),
  priority: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  repeat: z.enum(REPEATS).nullable().optional(),
});

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/hermes/tasks/[id]">) {
  if (!isHermesRequest(request)) return unauthorized();
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = Change.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad change", issues: parsed.error.issues }, { status: 400 });
  const { done, ...rest } = parsed.data;
  const change = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as TaskChange;
  const task = Object.keys(change).length ? await updateTask(id, change) : null;
  const ticked = done === undefined ? null : await setTaskDone(id, done);
  return Response.json({ ok: true, task, next: ticked?.next ?? null });
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/hermes/tasks/[id]">) {
  if (!isHermesRequest(request)) return unauthorized();
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteTask(id);
  return Response.json({ ok: true });
}
