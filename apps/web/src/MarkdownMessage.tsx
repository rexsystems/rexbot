import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const text = String(children).replace(/\n$/, "");
            const isBlock = Boolean(className) || text.includes("\n");
            if (!isBlock) {
              return (
                <code className="md-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre className="md-pre">
                <code className={className} {...props}>
                  {text}
                </code>
              </pre>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Hide empty / useless JSON blobs from tool UI and message text. */
export function formatToolDetail(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "{}" || t === "[]" || t === "null") return undefined;
    try {
      return formatToolDetail(JSON.parse(t));
    } catch {
      return t.length > 180 ? `${t.slice(0, 180)}…` : t;
    }
  }
  if (typeof raw === "object") {
    if (Array.isArray(raw)) {
      if (raw.length === 0) return undefined;
      const s = JSON.stringify(raw);
      return s.length > 180 ? `${s.slice(0, 180)}…` : s;
    }
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      ([, v]) => v !== "" && v != null && !(typeof v === "object" && JSON.stringify(v) === "{}"),
    );
    if (entries.length === 0) return undefined;
    // Prefer a human query/url string when present
  for (const key of ["command", "query", "url", "upload_id", "q"]) {
      const hit = entries.find(([k]) => k === key);
      if (hit && typeof hit[1] === "string" && hit[1].trim()) {
        return hit[1].trim();
      }
    }
    const s = JSON.stringify(Object.fromEntries(entries));
    if (s === "{}" || s === "[]") return undefined;
    return s.length > 180 ? `${s.slice(0, 180)}…` : s;
  }
  const s = String(raw).trim();
  if (!s || s === "{}" || s === "[]") return undefined;
  return s;
}

export function isEmptyNoiseContent(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  if (t === "{}" || t === "[]" || t === "null") return true;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed)) return parsed.length === 0;
      return Object.keys(parsed as object).length === 0;
    }
  } catch {
    // not json
  }
  return false;
}
