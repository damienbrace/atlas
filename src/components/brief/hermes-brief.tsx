import type { ReactNode } from "react";
import { Sparkle } from "@/components/sparkle";
import { linkLabel } from "@/lib/format";
import type { HermesBrief } from "@/lib/hermes";
import { HideButton, Show } from "./brief-layout";

// Hermes's morning brief (the one sent on Telegram), shown on the Brief page.
// The text is light markdown: ## headings, - bullets, **bold**, [links](url) and bare URLs.
// Everything is rendered as React text, so nothing in it can run as HTML.

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out.push(text.slice(last, m.index));
    const url = m[3] ?? m[4];
    if (m[1]) out.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>);
    // A malformed address (e.g. "https://[x") stays as plain text rather than breaking the page.
    else if (!URL.canParse(url!)) out.push(m[0]);
    else
      out.push(
        <a key={m.index} href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-teal underline-offset-2 hover:underline">
          {m[2] ?? linkLabel(url!)}
        </a>,
      );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function Body({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 text-[14.5px] leading-relaxed">
      {text.split(/\r?\n/).map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-2" />;
        const heading = t.match(/^#{1,4}\s+(.*)/);
        if (heading) return <h3 key={i} className="mt-2 text-[15.5px] font-bold">{inline(heading[1])}</h3>;
        const bullet = t.match(/^(?:[-•*]|\d+[.)])\s+(.*)/);
        if (bullet)
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span className="text-faint">•</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{inline(bullet[1])}</span>
            </p>
          );
        return <p key={i} className="[overflow-wrap:anywhere]">{inline(t)}</p>;
      })}
    </div>
  );
}

export function HermesBriefCard({ brief, today }: { brief: HermesBrief; today: string }) {
  const old = brief.day !== today;
  return (
    <Show id="hermes">
      <section aria-label="Hermes brief" className="rounded-2xl border border-line bg-panel p-4 md:p-5">
        <header className="mb-3 flex items-center justify-between gap-2 px-1">
          <h2 className="flex items-center gap-2.5 text-[18px] font-bold tracking-tight">
            <Sparkle className="size-5" />
            {brief.title}
            {old && <span className="text-[13px] font-normal text-muted">· from {brief.day}</span>}
          </h2>
          <HideButton id="hermes" />
        </header>
        <details open={!old} className="px-1">
          <summary className="cursor-pointer text-[13px] text-muted">{old ? "Show" : "Hide"} the brief</summary>
          <div className="mt-2">
            <Body text={brief.text} />
          </div>
        </details>
      </section>
    </Show>
  );
}
