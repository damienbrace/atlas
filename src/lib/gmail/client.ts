import "server-only";
import { accessTokenFor, forgetAccessToken } from "./oauth";

// Minimal read-only Gmail REST client. https://developers.google.com/gmail/api/reference/rest
// Gmail allows 6,000 quota units per user per minute: messages.get costs 20,
// messages.list 5, history.list 2, threads.get 40.

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: GmailPart;
}

export interface GmailThread {
  id: string;
  messages: GmailMessage[];
}

interface HistoryMessageRef {
  message: { id: string; threadId: string; labelIds?: string[] };
}

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: HistoryMessageRef[];
  messagesDeleted?: HistoryMessageRef[];
  labelsAdded?: HistoryMessageRef[];
  labelsRemoved?: HistoryMessageRef[];
}

export class GmailHttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    path: string,
  ) {
    super(`Gmail ${path} failed: ${status} ${reason}`.trim());
  }
}

/** Spaces out calls so a long download stays under Gmail's per-minute quota. */
export class Pacer {
  private next = 0;
  constructor(private perSecond: number) {}

  async wait() {
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + 1000 / this.perSecond;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
}

export class GmailClient {
  constructor(private refreshToken: string) {}

  private async get<T>(path: string, attempt = 0): Promise<T> {
    const token = await accessTokenFor(this.refreshToken);
    const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.ok) return res.json() as Promise<T>;

    if (res.status === 401 && attempt === 0) {
      forgetAccessToken(this.refreshToken);
      return this.get(path, attempt + 1);
    }
    const body = await res.json().catch(() => null);
    const reason: string = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? "";
    // Gmail signals rate limits with 429, or 403 + a rateLimitExceeded reason. Back off and retry.
    if ((res.status === 429 || /ratelimit/i.test(reason)) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      return this.get(path, attempt + 1);
    }
    throw new GmailHttpError(res.status, reason, path.split("?")[0]);
  }

  async profile() {
    return this.get<{ emailAddress: string; historyId: string }>("/profile");
  }

  /** One page of message ids matching a Gmail search, newest first. */
  async listMessages(query: string, pageToken?: string, max = 500) {
    const params = new URLSearchParams({ q: query, maxResults: String(max) });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await this.get<{ messages?: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }>(
      `/messages?${params}`,
    );
    return { ids: (res.messages ?? []).map((m) => m.id), nextPageToken: res.nextPageToken, estimate: res.resultSizeEstimate ?? 0 };
  }

  async message(id: string) {
    return this.get<GmailMessage>(`/messages/${id}?format=full`);
  }

  async thread(id: string) {
    return this.get<GmailThread>(`/threads/${id}?format=full`);
  }

  /** Everything that changed since `startHistoryId`. A 404 means that point is too old to replay. */
  async history(startHistoryId: string, pageToken?: string) {
    const params = new URLSearchParams({ startHistoryId, maxResults: "500" });
    for (const type of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) params.append("historyTypes", type);
    if (pageToken) params.set("pageToken", pageToken);
    return this.get<{ history?: GmailHistoryRecord[]; nextPageToken?: string; historyId: string }>(`/history?${params}`);
  }
}
