"use server";

import { refresh } from "next/cache";
import { describeAiError, writeDraft } from "@/lib/ai/claude";
import { clearSession, getSession } from "@/lib/auth/session";
import { aiConfigured } from "@/lib/env";
import { GmailClient } from "@/lib/gmail/client";
import { revoke } from "@/lib/gmail/oauth";
import { parseThread } from "@/lib/gmail/parse";
import { CATEGORIES, LABELS } from "@/lib/inbox/categories";
import type { Category, Label, Tone } from "@/lib/inbox/types";
import { clearMail, getThread } from "@/lib/mail/db";
import { triageKey } from "@/lib/mail/sync";
import { readStore, updateStore } from "@/lib/store";

// Server Functions are public endpoints: check the session and validate every input.

const TONES: Tone[] = ["original", "shorter", "friendlier", "firmer"];
const isThreadId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{6,32}$/i.test(id);

export type DraftResult = { ok: true; rationale: string; text: string } | { ok: false; error: string };

/**
 * Atlas's reply (or follow-up) for a thread, in the given tone. Cached per
 * message; `fresh` throws the cache away and writes a new one.
 */
export async function draftReply(threadId: string, tone: Tone, fresh = false): Promise<DraftResult> {
  if (!isThreadId(threadId) || !TONES.includes(tone)) return { ok: false, error: "Bad request" };
  const session = await getSession();
  if (!session) return { ok: false, error: "Gmail isn't connected." };
  if (!aiConfigured()) return { ok: false, error: "Add an Anthropic API key to get drafts." };

  try {
    // The local mail store has it unless sync hasn't reached it yet.
    const thread = getThread(threadId) ?? parseThread(await new GmailClient(session.refreshToken).thread(threadId));
    const key = triageKey(thread);
    const cached = fresh ? undefined : (await readStore()).drafts[key];
    const hit = cached?.variants[tone];
    if (cached && hit) return { ok: true, rationale: cached.rationale, text: hit };

    // Tones rewrite the original, so make sure it exists first.
    let original = cached?.variants.original;
    let rationale = cached?.rationale;
    if (!original || !rationale) {
      ({ text: original, rationale } = await writeDraft(thread, "original"));
    }
    const text = tone === "original" ? original : (await writeDraft(thread, tone, original)).text;

    await updateStore((data) => {
      const entry = fresh || !data.drafts[key] ? { rationale: rationale!, variants: {} } : data.drafts[key];
      entry.variants.original = original;
      entry.variants[tone] = text;
      data.drafts[key] = entry;
    });
    return { ok: true, rationale, text };
  } catch (error) {
    console.error("[atlas] draft failed", error);
    return { ok: false, error: describeAiError(error) };
  }
}

/** Saves a correction to Atlas's sorting or labels for a thread. */
export async function saveOverride(threadId: string, change: { category?: Category; labels?: Label[] }) {
  if (!isThreadId(threadId) || !(await getSession())) return;
  const category = CATEGORIES.some((c) => c.id === change.category) ? change.category : undefined;
  const labels = change.labels?.filter((l) => (LABELS as readonly string[]).includes(l));
  await updateStore((data) => {
    const entry = (data.overrides[threadId] ??= {});
    if (category) entry.category = category;
    if (labels) entry.labels = labels;
  });
}

/** Disconnects Gmail and deletes Atlas's local copy of the mail and what it wrote about it. */
export async function disconnectGmail() {
  const session = await getSession();
  if (session) await revoke(session.refreshToken);
  await clearSession();
  clearMail();
  await updateStore((data) => {
    data.triage = {};
    data.drafts = {};
    data.overrides = {};
  });
  refresh();
}
