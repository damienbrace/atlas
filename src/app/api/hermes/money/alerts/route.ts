import { isHermesRequest } from "@/lib/hermes";
import { takeAlerts, unsentAlerts } from "@/lib/money/db";

// Hermes checks here every 15–30 minutes and sends anything new on Telegram: unusual
// charges, big first charges, possible double charges, price rises, new subscriptions,
// Spending running low before pay, and on the 1st, last month's review. Atlas raises them
// when Up sends a transaction and in the early-morning job. Bearer HERMES_SECRET.
//
// GET           { alerts: [{ kind, day, text }], text }; send `text` when it isn't empty.
//               Each alert is handed over once; ones left waiting over 3 days are dropped.
// GET ?peek=1   the same, without handing anything over

const STALE_MS = 3 * 86_400_000;

export async function GET(request: Request) {
  if (!isHermesRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const peek = new URL(request.url).searchParams.get("peek") === "1";
  const alerts = peek ? await unsentAlerts() : await takeAlerts(STALE_MS);
  return Response.json({
    alerts: alerts.map((a) => ({ kind: a.kind, day: a.day, text: a.text })),
    text: alerts.map((a) => a.text).join("\n\n"),
  });
}
