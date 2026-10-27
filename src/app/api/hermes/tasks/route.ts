import { z } from "zod";
import { isHermesRequest } from "@/lib/hermes";
import { isDayKey } from "@/lib/life/days";
import { TASK_AREAS, REPEATS } from "@/lib/life/task-rules";
import { addTask, dueOpenTasks, listTasks, searchTasks } from "@/lib/life/tasks";

// Hermes (Damien's Telegram assistant) reads and adds tasks here, so anything he texts
// lands in Atlas and Hermes's reminders come from the same list. Bearer HERMES_SECRET.
//
// GET  ?view=open              open tasks (default)
// GET  ?view=done&days=7       open + ticked in the last N days, each with done/doneAt
// GET  ?view=due&today=YYYY-MM-DD   open tasks due today or earlier
// GET  ?view=search&q=words    any task mentioning the words
// POST {title, dueDay?, area?, priority?, notes?, repeat?}

const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

export async function GET(request: Request) {
  if (!isHermesRequest(request)) return unauthorized();
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "open";
  if (view === "due") {
    const today = params.get("today") ?? "";
    if (!isDayKey(today)) return Response.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
    return Response.json({ tasks: await dueOpenTasks(today) });
  }
  if (view === "search") {
    const q = (params.get("q") ?? "").trim();
    if (!q) return Response.json({ error: "q is required" }, { status: 400 });
    return Response.json({ tasks: await searchTasks(q, 20) });
  }
  const days = view === "done" ? Math.min(Math.max(Number(params.get("days") ?? 7) || 7, 0), 60) : 0;
  const tasks = await listTasks(days);
  return Response.json({ tasks: view === "done" ? tasks : tasks.filter((t) => !t.done) });
}

const TaskFields = z.object({
  title: z.string().trim().min(1).max(300),
  dueDay: z.string().refine(isDayKey, "YYYY-MM-DD").nullable().optional(),
  area: z.enum(TASK_AREAS).nullable().optional(),
  priority: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  repeat: z.enum(REPEATS).nullable().optional(),
});

export async function POST(request: Request) {
  if (!isHermesRequest(request)) return unauthorized();
  const parsed = TaskFields.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad task", issues: parsed.error.issues }, { status: 400 });
  const t = parsed.data;
  const task = await addTask({
    title: t.title,
    dueDay: t.dueDay ?? null,
    area: t.area ?? null,
    priority: t.priority ?? false,
    notes: t.notes ?? "",
    repeat: t.repeat ?? null,
    threadId: null,
    source: "hermes",
  });
  return Response.json({ task }, { status: 201 });
}
