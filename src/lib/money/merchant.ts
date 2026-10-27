// Turning bank descriptions into something sortable. Safe in the browser and on the server.
//
//   "WOOLWORTHS 1234 BUNBURY AU Card xx4821 Value Date: 03/10/2026"
//     → merchant key "WOOLWORTHS BUNBURY"
//
// Keys drop numbers and noise, so the same shop matches across visits. Rules use the
// same normalising, so a rule "Woolworths" (→ "WOOLWORTHS") matches every Woolworths.

// Card numbers, value dates and receipt references say nothing about the merchant.
const CARD = /\bCARD\s+[X*]+\d+/gi;
const VALUE_DATE = /\bVALUE\s+DATE:?\s*\S+/gi;
const NOISE = new Set(["AU", "AUS", "AUSTRALIA", "WA", "NSW", "VIC", "QLD", "SA", "TAS", "NT", "ACT", "PTY", "LTD", "AUD"]);

const MAX_KEY = 60;

/** The description minus card numbers and value dates, for showing and for Claude. */
export function cleanDescription(description: string) {
  return description.replace(CARD, " ").replace(VALUE_DATE, " ").replace(/\s+/g, " ").trim();
}

/** Uppercase words only: no digits, punctuation, states or "PTY LTD". */
export function normalise(text: string) {
  return cleanDescription(text)
    .toUpperCase()
    .replace(/['’`]/g, "")
    .replace(/[^A-Z&]+/g, " ")
    .split(" ")
    .filter((w) => w && !NOISE.has(w))
    .join(" ")
    .slice(0, MAX_KEY)
    .trim();
}

export function merchantKey(description: string) {
  return normalise(description) || "UNKNOWN";
}

/** A rule's pattern matches a merchant key when it appears in it as whole words. */
export function patternMatches(pattern: string, key: string) {
  return pattern !== "" && ` ${key} `.includes(` ${pattern} `);
}

/** "WOOLWORTHS BUNBURY" → "Woolworths Bunbury", until Atlas has named it. */
export function titleCase(key: string) {
  return key.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
