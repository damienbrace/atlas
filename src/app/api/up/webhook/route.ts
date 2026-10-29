import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { unseal } from "@/lib/auth/seal";
import { getUpConnection } from "@/lib/money/db";
import { upEvent } from "@/lib/money/jobs";

// Up calls this whenever a transaction is created, settles or is deleted (set up in
// connectUp). There's no session: each call is signed with the secret Up gave when the
// webhook was made, and anything unsigned or signed wrongly is turned away. It answers at
// once and does the work afterwards.

export const maxDuration = 60;

const EVENTS = new Set(["TRANSACTION_CREATED", "TRANSACTION_SETTLED", "TRANSACTION_DELETED"]);
const UUID = /^[0-9a-f-]{36}$/i;

/** Up signs the raw body: an HMAC-SHA256 with the webhook's secret, in hex. */
function signedBy(secret: string, body: string, signature: string) {
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const body = await request.text();
  const connection = await getUpConnection();
  const secret = connection?.webhookSecret ? unseal<string>(connection.webhookSecret) : null;
  if (!secret || !signedBy(secret, body, request.headers.get("x-up-authenticity-signature") ?? "")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let event: { data?: { attributes?: { eventType?: string }; relationships?: { transaction?: { data?: { id?: string } } } } };
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const type = event.data?.attributes?.eventType ?? "";
  const id = event.data?.relationships?.transaction?.data?.id ?? "";
  // PING (Up checking the address works) needs nothing more than the answer.
  if (EVENTS.has(type) && UUID.test(id)) after(() => upEvent(type, id).catch((error) => console.error("Up webhook", type, error)));
  return Response.json({ ok: true });
}
