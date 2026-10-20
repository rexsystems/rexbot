import fs from "node:fs";
import { safeGet } from "./safeFetch.js";
import path from "node:path";
import { createRequire } from "node:module";
import { isPreviewImage, type ClientSettings } from "@rex/shared";
import { db } from "../db.js";
import { computers, isDesktopComputer, UnavailableComputer } from "../computer.js";
import { isReaction, setReaction } from "../reactions.js";
import type { MessagingContext } from "../botMessaging.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (
  buf: Buffer,
) => Promise<{ text: string }>;

const FETCH_TIMEOUT_MS = 12_000;
const FETCH_MAX_BYTES = 200_000;
const TEXT_MAX = 12_000;

function truncate(text: string, max = TEXT_MAX) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

async function webSearch(
  settings: ClientSettings,
  query: string,
  maxResults = 5,
): Promise<string> {
  const key = settings.searchApiKey.trim();
  if (!key) {
    return "web_search unavailable: add a Search API key (Tavily) in Settings.";
  }
  const limit = Math.min(8, Math.max(1, maxResults || 5));
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: limit,
      include_answer: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    return `web_search failed (${res.status}): ${text.slice(0, 300)}`;
  }
  const json = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const results = json.results ?? [];
  if (results.length === 0) return "No search results.";
  return results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title ?? "Untitled"}\n${r.url ?? ""}\n${r.content ?? ""}`,
    )
    .join("\n\n");
}

async function readUpload(uploadId: string, ownerId: string | undefined): Promise<string> {
  const row = db
    .prepare(
      `SELECT id, filename, mime_type, path, text_content FROM uploads WHERE id = ? AND user_id = ?`,
    )
    .get(uploadId, ownerId ?? "") as
    | {
        id: string;
        filename: string;
        mime_type: string;
        path: string;
        text_content: string | null;
      }
    | undefined;

  if (!row) return `Upload not found: ${uploadId}`;
  if (isPreviewImage(row.mime_type)) return `File: ${row.filename}. This is an image. Image pixels cannot be read with this text tool; do not claim to have viewed its contents.`;
  if (row.text_content) {
    return truncate(`File: ${row.filename}\n\n${row.text_content}`);
  }

  const abs = path.resolve(row.path);
  if (!fs.existsSync(abs)) return `Upload file missing on disk: ${row.filename}`;

  const mime = row.mime_type;
  if (mime.includes("pdf") || row.filename.toLowerCase().endsWith(".pdf")) {
    const buf = fs.readFileSync(abs);
    const parsed = await pdfParse(buf);
    const text = truncate(parsed.text || "(empty pdf)");
    db.prepare(`UPDATE uploads SET text_content = ? WHERE id = ?`).run(
      text,
      uploadId,
    );
    return `File: ${row.filename}\n\n${text}`;
  }

  const text = truncate(fs.readFileSync(abs, "utf8"));
  db.prepare(`UPDATE uploads SET text_content = ? WHERE id = ?`).run(
    text,
    uploadId,
  );
  return `File: ${row.filename}\n\n${text}`;
}

async function httpFetch(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http(s) URLs are allowed.";
  }

  try {
    const res = await safeGet(parsed.toString(), { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES, headers: { "User-Agent": "RexAssistants/0.1" } });
    const slice = res.body;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return truncate(
      `Status ${res.status} ${res.statusText}\nURL: ${res.url}\n\n${stripped || "(empty)"}`,
    );
  } catch (err) {
    return `http_fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function runTool(
  name: string,
  argsJson: string,
  settings: ClientSettings,
  context?: { userMessageId: string; ownerId?: string; conversationId?: string; timeZone?: string } & Partial<MessagingContext>,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    if (!args || typeof args !== "object" || Array.isArray(args)) return `Invalid tool arguments object for ${name}`;
  } catch {
    return `Invalid tool arguments JSON for ${name}`;
  }

  const computer = () => context?.ownerId ? computers.forOwner(context.ownerId) : new UnavailableComputer(computers.kind, "No account context for this computer.");
  switch (name) {
    case "message_bot": {
      if (!context?.botId || !context.budget) return "message_bot unavailable in this context.";
      const { messageBot } = await import("../botMessaging.js");
      return messageBot(settings, { ownerId: context.ownerId, botId: context.botId, groupId: context.groupId, budget: context.budget }, args.bot_id, args.message);
    }
    case "computer_exec": {
      try {
        if (typeof args.command !== "string") return "computer_exec requires a command string.";
        return JSON.stringify(await computer().execute(args.command, context?.botId));
      } catch (err) {
        return `computer_exec failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    case "computer_input":
    case "computer_screenshot": {
      const desktop = computer();
      if (!isDesktopComputer(desktop)) return `${name} unavailable: this computer has no screen.`;
      if (!context?.botId) return `${name} unavailable: only bots have a screen.`;
      try {
        if (name === "computer_screenshot") return await desktop.screenshot(context.botId);
        return await desktop.input(context.botId, args);
      } catch (err) {
        return `${name} failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    case "react_message": {
      if (!context || !isReaction(args.emoji)) return "Invalid reaction.";
      const reactions = setReaction(context.userMessageId, "rex", args.emoji);
      return JSON.stringify({ messageId: context.userMessageId, reactions });
    }
    case "web_search":
      return webSearch(
        settings,
        String(args.query ?? ""),
        Number(args.max_results ?? 5),
      );
    case "read_upload":
      return readUpload(String(args.upload_id ?? ""), context?.ownerId);
    case "http_fetch":
      return httpFetch(String(args.url ?? ""));
    case "routine": {
      const { routineTool } = await import("../routines.js");
      return routineTool(context?.ownerId, context?.conversationId, context?.timeZone, args);
    }
    case "cursor_agent": {
      const { cursorAgentTool } = await import("../integrations/cursor.js");
      return cursorAgentTool(context?.ownerId, args);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
