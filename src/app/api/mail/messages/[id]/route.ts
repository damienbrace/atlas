import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { messageBody } from "@/lib/mail/db";

/** One email's full text from the mail store, fetched when it's opened. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/mail/messages/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{6,32}$/i.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await getSession())) return Response.json({ error: "Gmail isn't connected" }, { status: 401 });

  const body = await messageBody(id);
  if (body === null) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ body }, { headers: { "cache-control": "private, max-age=300" } });
}
