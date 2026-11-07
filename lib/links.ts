export type TextPart = { kind: "text"; value: string } | { kind: "link"; href: string };

const HTTP_URL = /https?:\/\/[^\s<>"']+/gi;

/**
 * Splits text into plain runs and http(s) links.
 * Any other scheme, including javascript:, stays plain text.
 */
export function segmentHttpText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(HTTP_URL)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const href = raw.replace(/[),.;:!?]+$/g, "");
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (index > cursor) parts.push({ kind: "text", value: text.slice(cursor, index) });
    parts.push({ kind: "link", href });
    cursor = index + href.length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  if (parts.length === 0) parts.push({ kind: "text", value: text });
  return parts;
}
