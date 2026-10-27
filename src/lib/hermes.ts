import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { getSetting, setSetting } from "@/lib/life/settings";

// Hermes is Damien's assistant (Telegram). It sends its morning brief here so it can
// be read on the Brief page too. It proves itself with `Authorization: Bearer <HERMES_SECRET>`;
// no secret configured means nothing is accepted.

export interface HermesBrief {
  /** Local date the brief is for, YYYY-MM-DD. */
  day: string;
  title: string;
  /** Markdown-ish text, as sent on Telegram. */
  text: string;
  at: number;
}

const KEY = "hermes.brief";
const digest = (text: string) => createHash("sha256").update(text).digest();

export function isHermesRequest(request: Request) {
  if (!env.hermesSecret) return false;
  const given = request.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(given), digest(`Bearer ${env.hermesSecret}`));
}

export const getHermesBrief = () => getSetting<HermesBrief | null>(KEY, null);

export async function saveHermesBrief(brief: HermesBrief) {
  await setSetting(KEY, brief);
  // Keep a short history so past briefs can be looked back on.
  const history = await getSetting<HermesBrief[]>(`${KEY}.history`, []);
  await setSetting(`${KEY}.history`, [brief, ...history.filter((b) => b.day !== brief.day)].slice(0, 30));
}
