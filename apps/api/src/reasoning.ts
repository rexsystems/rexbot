import { createHash } from "node:crypto";
import type { ClientSettings } from "@rex/shared";
import { db } from "./db.js";

export function reasoningScope(settings: ClientSettings): string {
  return createHash("sha256").update(`${settings.llmBaseUrl.replace(/\/$/, "")}\n${settings.llmModel}`).digest("hex");
}

function replay(row: { scope: string; content: string } | undefined, settings: ClientSettings): { reasoning_content?: string } {
  if (row?.scope === reasoningScope(settings)) return { reasoning_content: row.content };
  // Legacy chat and voice messages have no provider reasoning to replay.
  if (/^deepseek(?:-|$)/i.test(settings.llmModel) || /^https:\/\/api\.deepseek\.com(?:\/|$)/i.test(settings.llmBaseUrl)) return { reasoning_content: "" };
  return {};
}

export function messageReasoning(id: string, settings: ClientSettings) {
  return replay(db.prepare("SELECT scope, content FROM message_reasoning WHERE message_id = ?").get(id) as { scope: string; content: string } | undefined, settings);
}

export function exchangeReasoning(id: string, settings: ClientSettings) {
  return replay(db.prepare("SELECT scope, content FROM exchange_reasoning WHERE exchange_id = ?").get(id) as { scope: string; content: string } | undefined, settings);
}

export function responseReasoning(content: string | undefined, settings: ClientSettings) {
  return replay(content === undefined ? undefined : { content, scope: reasoningScope(settings) }, settings);
}
