export function botReplyText(text: string, name: string | null | undefined, complete = true): string {
  const toolMarkup = text.search(/<[｜|]\s*DSML\s*[｜|]\s*(?:function_)?calls>/);
  if (toolMarkup >= 0) text = text.slice(0, toolMarkup).trimEnd() || "The model returned an unprocessed tool call. Send the request again to retry.";
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
