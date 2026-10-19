export function botReplyText(text: string, name: string | null | undefined, complete = true): string {
  if (!name) return text;
  const start = text.trimStart();
  const tag = `[${name}]`.toLowerCase();
  const lower = start.toLowerCase();
  if (!complete && (tag.startsWith(lower) || (lower.startsWith(tag) && !start.slice(tag.length).trim()))) return "";
  if (lower.startsWith(tag)) {
    const rest = start.slice(tag.length).trimStart();
    if (rest.startsWith(":")) return rest.slice(1).trimStart();
  }
  return text;
}
