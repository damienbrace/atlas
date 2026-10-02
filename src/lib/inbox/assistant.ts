import { ME } from "./sample-data";
import type { Email, Tone } from "./types";

// Stand-in for the server-side assistant. Each function keeps the shape the
// real Claude-backed version will have, so the UI won't change when it lands.

const THINKING_MS = 650;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function firstName(email: Email) {
  const other = email.direction === "in" ? email.from : email.to[0];
  return other.name.split(" ")[0];
}

/** Plain reply used when Atlas didn't suggest one (FYI mail, receipts). */
function fallbackDraft(email: Email) {
  return `Hi ${firstName(email)},\n\nThanks for this.\n\nCheers,\n${ME.name}`;
}

export async function rewriteDraft(email: Email, tone: Tone) {
  await wait(THINKING_MS);
  return email.draft?.variants[tone] ?? fallbackDraft(email);
}
