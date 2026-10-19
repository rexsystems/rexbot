import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const CODE_COLLAPSE_LINES = 32;

function CodeBlock({ text, className }: { text: string; className?: string }) {
  const lineCount = text.split("\n").length;
  const canCollapse = lineCount > CODE_COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(!canCollapse);
  const shown = !expanded && canCollapse
    ? `${text.split("\n").slice(0, CODE_COLLAPSE_LINES).join("\n")}\n…`
    : text;

  return (
    <div className="md-code-wrap">
      <pre className="md-pre">
        <code className={className}>{shown}</code>
      </pre>
      {canCollapse ? (
        <button
          type="button"
          className="md-code-toggle"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : `Show all ${lineCount} lines`}
        </button>
      ) : null}
    </div>
  );
}

const HUGE_REPLY_CHARS = 10_000;

function looksLikeCodeDump(text: string): boolean {
  const lines = text.split("\n").length;
  if (lines >= 60) return true;
  const trimmed = text.trimStart().slice(0, 80).toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<form") || trimmed.startsWith("```");
}

/** Prefer a capped plain view for giant dumps; full markdown for normal replies. */
export function AssistantReply({ content, live = false }: { content: string; live?: boolean }) {
  const huge = content.length >= HUGE_REPLY_CHARS || (live && content.length >= 4_000 && looksLikeCodeDump(content));
  if (huge || (live && content.length >= 6_000)) {
    return <CodeBlock text={content} />;
  }
  return <MarkdownMessage content={content} />;
}

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
            return <CodeBlock text={text} className={className} />;
          },
          pre: ({ children }) => <>{children}</>,
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
