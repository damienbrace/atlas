import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { GmailClient } from "@/lib/gmail/client";
import { EMAIL_PAGE_HEADERS, renderEmailDocument } from "@/lib/gmail/email-html";
import { htmlOf } from "@/lib/gmail/parse";

/** One email's HTML version as a locked-down page, for Atlas's sandboxed email frame. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/gmail/messages/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{6,32}$/i.test(id)) return new Response("Not found", { status: 404 });

  const session = await getSession();
  if (!session) return new Response("Gmail isn't connected", { status: 401 });

  try {
    const html = htmlOf(await new GmailClient(session.refreshToken).message(id));
    if (!html) return new Response("This email has no HTML version", { status: 404 });
    return new Response(renderEmailDocument(html), { headers: EMAIL_PAGE_HEADERS });
  } catch (error) {
    console.error("[atlas] email html failed", error);
    return new Response("Couldn't load this email from Gmail", { status: 502 });
  }
}
