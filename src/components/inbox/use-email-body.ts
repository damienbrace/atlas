"use client";

import { useEffect, useReducer } from "react";
import type { Email } from "@/lib/inbox/types";

// Live inbox rows leave out the full text; it's fetched from the local mail store
// when an email is opened, and kept for the rest of the visit.
const bodies = new Map<string, string>();
const failed = new Set<string>();

export function useEmailBody(email: Email) {
  const id = email.messageId;
  const inline = email.body;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (inline !== undefined || !id || bodies.has(id) || failed.has(id)) return;
    let cancelled = false;
    fetch(`/api/mail/messages/${id}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ body: string }>) : Promise.reject(new Error(String(res.status)))))
      .then(({ body }) => bodies.set(id, body))
      .catch(() => failed.add(id))
      .finally(() => !cancelled && rerender());
    return () => {
      cancelled = true;
    };
  }, [id, inline]);

  if (inline !== undefined) return { body: inline, loading: false, failed: false };
  if (!id) return { body: email.preview ?? "", loading: false, failed: false };
  const body = bodies.get(id);
  return { body: body ?? email.preview ?? "", loading: body === undefined && !failed.has(id), failed: failed.has(id) };
}
