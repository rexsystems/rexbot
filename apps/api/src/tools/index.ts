import fs from "node:fs";
import { safeGet } from "./safeFetch.js";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { isPreviewImage, type ClientSettings, type SseEvent } from "@rex/shared";
import { db } from "../db.js";
import { computers, isDesktopComputer, UnavailableComputer } from "../computer.js";
import { isReaction, setReaction } from "../reactions.js";
import type { MessagingContext } from "../botMessaging.js";
import { modelImage, type ModelImage } from "../vision.js";

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
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const parsed = await parser.getText().finally(() => parser.destroy());
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
  context?: { userMessageId: string; ownerId?: string; conversationId?: string; timeZone?: string; send?: (event: SseEvent) => void; onImage?: (image: ModelImage) => void } & Partial<MessagingContext>,
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
    case "ask_user": {
      if (!context?.ownerId || !context.conversationId || !context.botId) return "ask_user unavailable in private bot replies.";
      try {
        const { askUser } = await import("../chatQuestions.js");
        const result = askUser(context.ownerId, context.conversationId, context.botId, args.questions);
        if (!result.existing) context.send?.({ type: "assistant_message", message: result.message });
        return JSON.stringify({ waiting_for_user: true, question_id: result.question.id });
      } catch (error) { return `ask_user failed: ${error instanceof Error ? error.message : String(error)}`; }
    }
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
    case "computer_files":
    case "computer_project":
    case "computer_input":
    case "computer_screenshot": {
      const desktop = computer();
      if (!isDesktopComputer(desktop)) return `${name} unavailable: this computer has no screen.`;
      if (!context?.botId) return `${name} unavailable: only bots have a screen.`;
      try {
        if (name === "computer_files" || name === "computer_project") return await desktop.workspace(context.botId, name === "computer_files" ? "files" : "project", args);
        if (name === "computer_screenshot") {
          if (args.share !== undefined && typeof args.share !== "boolean") return "computer_screenshot failed: share must be a boolean.";
          if (args.inspect !== undefined && typeof args.inspect !== "boolean") return "computer_screenshot failed: inspect must be a boolean.";
          const inspect = Boolean(context.onImage) && args.inspect !== false;
          if (args.share !== true && inspect) {
            if (args.path !== undefined && typeof args.path !== "string") return "computer_screenshot failed: path must be a workspace image path.";
            const image = await desktop.image(context.botId, args.path as string | undefined);
            const pixels = modelImage(image.bytes);
            if (pixels) context.onImage!(pixels);
            return JSON.stringify({ filename: image.filename, path: image.path, pixels_included: !!pixels, note: pixels ? "Inspect the image in the next model round." : "Image is unsupported or exceeds the 5 MB vision limit. Resize it inside the guest before inspecting." });
          }
          if (args.share === true) {
            if (!context.ownerId || !context.conversationId) return "computer_screenshot unavailable: images can only be shared in the owner's conversation, not private bot replies.";
            if (args.path !== undefined && typeof args.path !== "string") return "computer_screenshot failed: path must be a workspace image path.";
            if (args.caption !== undefined && (typeof args.caption !== "string" || args.caption.length > 1000)) return "computer_screenshot failed: caption must be text up to 1000 characters.";
            const image = await desktop.image(context.botId, args.path as string | undefined);
            const pixels = inspect ? modelImage(image.bytes) : null;
            if (pixels) context.onImage!(pixels);
            const { shareComputerImage } = await import("../computerImages.js");
            const message = shareComputerImage(context.ownerId, context.conversationId, context.botId, image, args.caption as string | undefined);
            context.send?.({ type: "assistant_message", message });
            return JSON.stringify({ shared: true, message_id: message.id, attachment: message.attachments![0], pixels_included: !!pixels });
          }
          if (args.path !== undefined) return "computer_screenshot failed: set share=true to attach a saved image.";
          return await desktop.screenshot(context.botId);
        }
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
    case "load_skill": {
      const { loadSkillTool } = await import("../skills.js");
      return loadSkillTool(context?.ownerId, args.name);
    }
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
