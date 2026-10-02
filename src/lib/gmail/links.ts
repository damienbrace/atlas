// Deep links into Gmail on the web. Safe to use in the browser.

const base = (account: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}`;

export const gmailThreadUrl = (account: string, threadId: string) => `${base(account)}#all/${threadId}`;

export const gmailComposeUrl = (account: string) => `${base(account)}&view=cm&fs=1`;
