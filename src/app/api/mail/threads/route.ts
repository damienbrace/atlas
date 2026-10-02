import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { olderPage, search } from "@/lib/mail/inbox";

const notConnected = () => Response.json({ error: "Gmail isn't connected" }, { status: 401 });

/** GET ?before=<epoch ms>: the next page of older inbox rows from the local mail store. */
export async function GET(request: NextRequest) {
  if (!(await getSession())) return notConnected();
  const before = Number(request.nextUrl.searchParams.get("before"));
  if (!Number.isFinite(before) || before <= 0) return Response.json({ error: "Bad request" }, { status: 400 });
  return Response.json(await olderPage(before));
}

/** POST { q }: search all stored mail, archived included. A POST keeps search words out of URLs and logs. */
export async function POST(request: NextRequest) {
  if (!(await getSession())) return notConnected();
  const { q } = (await request.json().catch(() => ({}))) as { q?: unknown };
  if (typeof q !== "string" || !q.trim()) return Response.json({ error: "Bad request" }, { status: 400 });
  return Response.json({ emails: await search(q.trim().slice(0, 200)) });
}
