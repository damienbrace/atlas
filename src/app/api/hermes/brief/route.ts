import { z } from "zod";
import { getHermesBrief, isHermesRequest, saveHermesBrief } from "@/lib/hermes";

// Hermes posts its morning brief here each day; GET returns the latest (handy for checking).

const Body = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().max(200).default("Morning brief"),
  text: z.string().min(1).max(20000),
});

export async function POST(request: Request) {
  if (!isHermesRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad brief", issues: parsed.error.issues }, { status: 400 });
  await saveHermesBrief({ ...parsed.data, at: Date.now() });
  return Response.json({ ok: true });
}

export async function GET(request: Request) {
  if (!isHermesRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ brief: await getHermesBrief() });
}
