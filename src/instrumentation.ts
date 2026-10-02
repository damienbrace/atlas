// Atlas keeps Perth time wherever it runs (Vercel's servers are on UTC), so "today",
// the greeting and the 5am brief follow the owner's day. Node picks up a TZ change at runtime.
export function register() {
  process.env.TZ = process.env.APP_TIMEZONE || "Australia/Perth";
}
