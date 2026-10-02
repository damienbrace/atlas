import "server-only";

// Shows a designed (HTML) email as its sender laid it out, safely. Three layers:
//   1. this cleanup strips scripts, frames, forms, event handlers and tracking pixels;
//   2. the response's Content-Security-Policy blocks any script that slips through;
//   3. the page loads in an iframe sandbox with scripts disabled.

/** An email is worth showing as designed when it has images or a table layout. */
export function isDesigned(html: string) {
  return /<(img|table)\b/i.test(html);
}

const PIXEL = /<img\b(?=[^>]*\bwidth\s*=\s*["']?[01](?:px)?["'\s/>])(?=[^>]*\bheight\s*=\s*["']?[01](?:px)?["'\s/>])[^>]*>/gi;

export function sanitizeEmailHtml(html: string) {
  return (
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      // Dangerous elements and everything inside them.
      .replace(/<(script|iframe|object|embed|frameset|applet|form|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
      // Leftover or self-closing dangerous tags.
      .replace(/<\/?(script|iframe|object|embed|frame|frameset|applet|form|base|meta|link|input|button|textarea|select)\b[^>]*>/gi, "")
      // Inline event handlers (onload=, onclick=, …).
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      // Script URLs.
      .replace(/\b(href|src|action|formaction|background|xlink:href)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"')
      // 1x1 tracking pixels that report when you open the email.
      .replace(PIXEL, "")
      // Load every image up front so the frame can size itself to the whole email.
      .replace(/\sloading\s*=\s*("|')?lazy\1?/gi, "")
      // Links open in a new tab, without a handle back to Atlas.
      .replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"')
  );
}

/** Wraps a cleaned email in a standalone page, keeping the sender's head styles and body colours. */
export function renderEmailDocument(html: string) {
  const clean = sanitizeEmailHtml(html);
  const head = clean.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const headStyles = [...head.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]).join("\n");
  const bodyAttrs = clean.match(/<body\b([^>]*)>/i)?.[1] ?? "";
  const inner = /<body\b/i.test(clean)
    ? clean.replace(/^[\s\S]*?<body\b[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "")
    : clean.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, "");
  const body = inner
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html { background: #ffffff; }
  body { margin: 0; padding: 16px; color: #1f2328; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
  img[src^="cid:"] { display: none; }
</style>
${headStyles}
</head>
<body${bodyAttrs}>
${body}
</body>
</html>`;
}

/** Locks the email page down even if it's opened directly rather than in Atlas's sandboxed frame. */
export const EMAIL_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": [
    "default-src 'none'",
    "img-src https: http: data:",
    "style-src 'unsafe-inline' https: http:",
    "font-src https: http: data:",
    "media-src https:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-same-origin allow-popups allow-popups-to-escape-sandbox",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "private, max-age=300",
};
