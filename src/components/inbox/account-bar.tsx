"use client";

import { ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import type { SyncProgress } from "@/lib/inbox/types";
import { useTransition, type ReactNode } from "react";
import { disconnectGmail } from "@/app/(app)/inbox/actions";
import { Menu } from "@/components/menu";
import type { InboxState } from "./use-inbox";

export function Banner({ tone = "info", children }: { tone?: "info" | "warn"; children: ReactNode }) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={`mt-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13.5px] leading-snug ${
        tone === "warn" ? "border-amber/40 bg-amber/[0.07] text-ink" : "border-line-strong bg-card text-ink-soft"
      }`}
    >
      {tone === "warn" && <CircleAlert className="mt-px size-4 shrink-0 text-amber" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const connectLink = (label: string) => (
  // A plain <a>, not <Link>: this route handler redirects to Google, and must not be prefetched.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  <a href="/api/auth/google" className="font-semibold whitespace-nowrap text-teal hover:underline">
    {label}
  </a>
);

const count = (n: number) => n.toLocaleString("en-AU");

/** Background sync progress: the first download of older mail, then Atlas sorting recent threads. */
function SyncLine({ sync, ai }: { sync: SyncProgress; ai: boolean }) {
  let text: string | null = null;
  if (sync.downloading) {
    text =
      sync.estimate > sync.stored
        ? `Downloading a year of mail · ${count(sync.stored)} of about ${count(sync.estimate)}`
        : `Downloading a year of mail · ${count(sync.stored)} so far`;
  } else if (ai && sync.sortingLeft > 0) {
    text = `Atlas is sorting the last 2 weeks · ${count(sync.sortingLeft)} to go`;
  }
  if (!text) return null;
  return (
    <p role="status" className="mt-1.5 flex items-center gap-2 text-[12.5px] text-teal">
      <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
      {text}
    </p>
  );
}

/** Which inbox this is (sample or a Gmail account) plus anything that needs attention. */
export function AccountBar({ inbox, notice }: { inbox: InboxState; notice?: string }) {
  const { data } = inbox;
  const [disconnecting, startDisconnect] = useTransition();

  return (
    <>
      {notice && <Banner tone="warn">{notice}</Banner>}

      {data.source === "sample" ? (
        <Banner>
          <div className="flex items-center justify-between gap-3">
            <span>Sample emails</span>
            {data.setup.google ? connectLink("Connect Gmail") : <span className="text-muted">Add Google keys to connect</span>}
          </div>
        </Banner>
      ) : (
        <>
          <div className="mt-2.5 flex items-center gap-2 text-[13px] text-muted">
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${data.status === "ok" ? "bg-green" : "bg-amber"}`} />
            <Menu
              label="Gmail account"
              align="start"
              trigger={
                <>
                  <span className="truncate">{data.account}</span>
                  <ChevronDown className="size-3.5 shrink-0" />
                </>
              }
              triggerClassName="flex min-w-0 items-center gap-1 rounded-md hover:text-ink"
              items={[
                {
                  label: disconnecting ? "Disconnecting…" : "Disconnect Gmail",
                  danger: true,
                  onSelect: () => startDisconnect(() => disconnectGmail()),
                },
              ]}
            />
            <span className="shrink-0 rounded-full border border-line-strong px-2 py-px text-[11.5px]">Read-only</span>
          </div>
          <SyncLine sync={data.sync} ai={data.ai} />
          {data.status === "expired" && (
            <Banner tone="warn">Your Gmail connection has expired. {connectLink("Reconnect")}</Banner>
          )}
          {data.problem && <Banner tone="warn">{data.problem}</Banner>}
          {!data.ai && (
            <Banner>Add an Anthropic API key to .env.local to turn on sorting, summaries and drafts.</Banner>
          )}
        </>
      )}
    </>
  );
}
