"use client";

import type { InboxData } from "@/lib/inbox/types";
import { ComposeView } from "./compose-view";
import { DraftPanel } from "./draft-panel";
import { EmailList } from "./email-list";
import { EmailView } from "./email-view";
import { useInbox } from "./use-inbox";

/**
 * Three panes on wide screens (list, email, Atlas draft). Below 1280px the
 * email and draft stack in one scrolling column; on phones the list and the
 * open email take turns.
 */
export function Inbox({ data, notice }: { data: InboxData; notice?: string }) {
  const inbox = useInbox(data);
  const detailVisibility = inbox.detailOpenOnMobile ? "flex" : "hidden md:flex";

  return (
    <div className="flex h-full min-h-0 gap-3 p-3 pb-[84px] md:pb-3">
      <EmailList inbox={inbox} notice={notice} className={inbox.detailOpenOnMobile ? "hidden md:flex" : "flex"} />
      <div
        className={`${detailVisibility} min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin xl:flex-[1.95] xl:flex-row xl:overflow-visible`}
      >
        {inbox.composing ? <ComposeView inbox={inbox} /> : <EmailView inbox={inbox} />}
        <DraftPanel inbox={inbox} className={inbox.composing ? "hidden xl:flex" : "flex"} />
      </div>
    </div>
  );
}
