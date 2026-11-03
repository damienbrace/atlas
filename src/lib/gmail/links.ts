// Deep links into Gmail on the web. Safe to use in the browser.

const base = (account: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}`;

export const gmailThreadUrl = (account: string, threadId: string) => `${base(account)}#all/${threadId}`;

export const gmailComposeUrl = (account: string) => `${base(account)}&view=cm&fs=1`;

/** Opens a saved draft, ready to check and send. */
export const gmailDraftUrl = (account: string, messageId: string) => `${base(account)}#drafts?compose=${messageId}`;

/**
 * The same Gmail link, but on Android it opens in the Gmail app rather than the browser
 * (an intent link naming the app; mail.google.com is the app's own verified link host).
 * Without the app it falls back to Gmail on the web. Android keeps the link's #fragment.
 */
export const gmailAppUrl = (webUrl: string) =>
  `intent:${webUrl.replace(/^https:/, "")}#Intent;scheme=https;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;

export const isAndroid = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
