import { connection } from "next/server";
import { getGoogleAccount } from "@/lib/auth/account";
import { sql } from "@/lib/db";
import { GmailClient } from "@/lib/gmail/client";

// Temporary: which kind of link opens an email in the Gmail app on Damien's phone.
// Delete once one is picked.

export const metadata = { title: "Gmail link test · Atlas" };

const GMAIL = "com.google.android.gm";

const intent = (web: string, extra = "") =>
  `intent:${web.replace(/^https:/, "")}#Intent;scheme=https;package=${GMAIL};${extra}S.browser_fallback_url=${encodeURIComponent(web)};end`;

export default async function GmailTest() {
  await connection();
  const account = await getGoogleAccount();
  const [row] = await sql<{ title: string; thread: string }[]>`
    SELECT data->'brief'->>'title' AS title, data->'brief'->'email'->>'threadId' AS thread FROM task_briefs
    WHERE data->'brief'->'email'->>'threadId' IS NOT NULL AND data->'brief'->>'title' ILIKE '%soccer%' LIMIT 1`;
  if (!account || !row) return <p className="p-6">Nothing to test with.</p>;
  const id = row.thread;
  const email = encodeURIComponent(account.email);
  const thread = await new GmailClient(account.refreshToken).thread(id);
  const first = thread.messages[0];
  const header = (name: string) => first.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  const messageId = header("message-id").replace(/[<>]/g, "");
  const subject = header("subject");
  // Ask the Gmail app to search; the query rides along as the standard search extra.
  const search = (query: string) =>
    `intent:#Intent;action=android.intent.action.SEARCH;package=${GMAIL};S.query=${encodeURIComponent(query)};end`;

  const links = [
    { label: "1. App, /mail/u/0/ + #all", href: intent(`https://mail.google.com/mail/u/0/#all/${id}`) },
    { label: "2. App, /mail/u/0/ + #inbox", href: intent(`https://mail.google.com/mail/u/0/#inbox/${id}`) },
    { label: "3. App, /mail/u/your-email/ + #all", href: intent(`https://mail.google.com/mail/u/${email}/#all/${id}`) },
    { label: "4. Plain link, /mail/u/0/ + #all", href: `https://mail.google.com/mail/u/0/#all/${id}` },
    { label: "5. App, /mail/ + #all (no account)", href: intent(`https://mail.google.com/mail/#all/${id}`) },
    { label: "6. Just open the Gmail app", href: `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${GMAIL};end` },
    { label: "7. App search, by the email's ID", href: search(`rfc822msgid:${messageId}`) },
    { label: "8. App search, by the subject", href: search(subject) },
    { label: "9. App, Gmail's own link type (from iPhone)", href: `intent:///cv=${id}/accountId=1/searchOrLabel=inbox#Intent;scheme=googlegmail;package=${GMAIL};end` },
  ];

  return (
    <div className="h-full overflow-y-auto p-4 pb-28">
      <h1 className="text-[24px] font-bold">Gmail link test</h1>
      <p className="mt-2 text-[15px] text-muted">
        Tap each one, then come back. Note which open the soccer club email ({row.title}) in the Gmail app, which open only the app, and
        which open the web.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="block rounded-xl border border-line-strong bg-card px-4 py-3.5 text-[16px] font-semibold">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
