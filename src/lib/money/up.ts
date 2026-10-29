import "server-only";
import type { UpAccount, UpTransaction } from "./up-map";

// Up Bank's API (https://developer.up.com.au), with my personal access token. Only ever
// talks to Up's own address: a "next page" link pointing anywhere else isn't followed,
// so the token can't be sent somewhere it shouldn't.

const API = "https://api.up.com.au/api/v1";
const PAGE = 100;

export class UpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = path.startsWith("https://") ? path : `${API}${path}`;
  if (!url.startsWith(`${API}/`)) throw new UpError("Up sent an unexpected address", 0);
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new UpError(`Up answered ${res.status}`, res.status);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Checks the token works. */
export const ping = (token: string) => call<{ meta: { id: string } }>(token, "/util/ping");

export async function accounts(token: string) {
  const all: UpAccount[] = [];
  let next: string | null = `/accounts?page[size]=${PAGE}`;
  while (next) {
    const page: { data: UpAccount[]; links: { next: string | null } } = await call(token, next);
    all.push(...page.data);
    next = page.links.next;
  }
  return all;
}

/** Every account's transactions created since `since` (an ISO time), a page at a time, newest first. */
export async function* transactionPages(token: string, since: string) {
  let next: string | null = `/transactions?page[size]=${PAGE}&filter[since]=${encodeURIComponent(since)}`;
  while (next) {
    const page: { data: UpTransaction[]; links: { next: string | null } } = await call(token, next);
    yield page.data;
    next = page.links.next;
  }
}

export async function transaction(token: string, id: string) {
  return (await call<{ data: UpTransaction }>(token, `/transactions/${encodeURIComponent(id)}`)).data;
}

/** Up calls `url` whenever a transaction is created, settles or is deleted. The secret signs each call and is only given now. */
export async function createWebhook(token: string, url: string) {
  const res = await call<{ data: { id: string; attributes: { secretKey: string } } }>(token, "/webhooks", {
    method: "POST",
    body: JSON.stringify({ data: { attributes: { url, description: "Atlas" } } }),
  });
  return { id: res.data.id, secret: res.data.attributes.secretKey };
}

export const deleteWebhook = (token: string, id: string) => call<void>(token, `/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
