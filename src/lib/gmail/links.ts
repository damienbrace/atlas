// Deep links into Gmail on the web. Safe to use in the browser.

const base = (account: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}`;

export const gmailThreadUrl = (account: string, threadId: string) => `${base(account)}#all/${threadId}`;

export const gmailComposeUrl = (account: string) => `${base(account)}&view=cm&fs=1`;

/** Opens a saved draft, ready to check and send. */
export const gmailDraftUrl = (account: string, messageId: string) => `${base(account)}#drafts?compose=${messageId}`;

/**
 * Opens the Gmail app on Android. It can't be sent to one email. Tested on Damien's phone
 * (Nov 2026): intent links with mail.google.com thread addresses all fell back to the web,
 * and search intents (by rfc822msgid or subject) and googlegmail: links went to the Play Store.
 */
export const GMAIL_APP_URL =
  "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.google.android.gm;end";

export const isAndroid = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
