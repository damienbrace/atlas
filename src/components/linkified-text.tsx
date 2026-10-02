import { linkLabel, URL_PATTERN } from "@/lib/format";

/**
 * Plain email text with each long URL shown as a short link to its site
 * ("seek.com.au"), so tracking links don't flood the page. Opens in a new tab.
 */
export function LinkifiedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[1];
    parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={url}
        className="text-teal underline-offset-2 hover:underline"
      >
        {linkLabel(url)}
      </a>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
