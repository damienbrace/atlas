"use client";

import { ArrowLeft, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { IconButton } from "@/components/icon-button";
import { paneClass } from "./email-view";
import type { InboxState } from "./use-inbox";

const fieldClass =
  "h-12 w-full border-b border-line bg-transparent px-6 text-[15.5px] text-ink outline-none placeholder:text-faint focus:border-teal/60";

export function ComposeView({ inbox }: { inbox: InboxState }) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const canSend = to.trim() !== "" && body.trim() !== "";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSend) inbox.finishCompose(to.trim());
  }

  return (
    <article aria-label="New email" className={paneClass}>
      <div className="flex h-16 shrink-0 items-center gap-2 px-4">
        <IconButton label="Discard and go back" onClick={() => inbox.finishCompose()}>
          <ArrowLeft className="size-[22px]" strokeWidth={1.75} />
        </IconButton>
        <h2 className="text-[17px] font-semibold">New email</h2>
      </div>
      <form onSubmit={onSubmit} className="flex flex-1 flex-col">
        <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" aria-label="To" className={fieldClass} />
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" className={fieldClass} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your email"
          aria-label="Message"
          className="min-h-64 flex-1 resize-none bg-transparent px-6 py-5 text-[16.5px] leading-[1.75] text-ink outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-3 border-t border-line px-6 py-4">
          <button
            type="submit"
            disabled={!canSend}
            className="flex h-12 items-center gap-2.5 rounded-xl bg-teal px-6 font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="size-[18px]" /> Send
          </button>
          <button
            type="button"
            onClick={() => inbox.finishCompose()}
            className="h-12 rounded-xl px-4 text-[15px] text-muted hover:text-ink"
          >
            Discard
          </button>
        </div>
      </form>
    </article>
  );
}
