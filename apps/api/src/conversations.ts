import { nanoid } from "nanoid";
import type { BotProfile, ChatMessage, Conversation } from "@rex/shared";
import { db, nowIso } from "./db.js";
import { getReactions } from "./reactions.js";
import { messageUploads } from "./uploads.js";

function groupFields(id: string, kind: string): Pick<Conversation, "kind" | "memberIds"> {
  if (kind !== "group") return {};
  const rows = db.prepare("SELECT bot_id FROM group_members WHERE group_id = ? ORDER BY position").all(id) as Array<{ bot_id: string }>;
  return { kind: "group", memberIds: rows.map((row) => row.bot_id) };
}

export function listConversations(): Conversation[] {
  const rows = db
    .prepare(
      `SELECT id, title, created_at, updated_at, bot_profile, kind FROM conversations ORDER BY updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    bot_profile: string | null;
    kind: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    bot: r.bot_profile ? JSON.parse(r.bot_profile) as BotProfile : undefined,
    ...groupFields(r.id, r.kind),
  }));
}

export function getConversation(id: string): Conversation | null {
  const r = db
    .prepare(
      `SELECT id, title, created_at, updated_at, bot_profile, kind FROM conversations WHERE id = ?`,
    )
    .get(id) as
    | { id: string; title: string; created_at: string; updated_at: string; bot_profile: string | null; kind: string }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    bot: r.bot_profile ? JSON.parse(r.bot_profile) as BotProfile : undefined,
    ...groupFields(r.id, r.kind),
  };
}

export function createConversation(title = "New chat", bot?: BotProfile): Conversation {
  const id = nanoid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO conversations (id, title, created_at, updated_at, bot_profile) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, title, ts, ts, bot ? JSON.stringify(bot) : null);
  return { id, title, createdAt: ts, updatedAt: ts, bot };
}

export function updateBot(id: string, bot: BotProfile): Conversation | null {
  if (getConversation(id)?.kind === "group") return null;
  db.prepare("UPDATE conversations SET bot_profile = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(bot), nowIso(), id);
  return getConversation(id);
}

export function touchConversation(id: string, title?: string) {
  const ts = nowIso();
  if (title) {
    db.prepare(
      `UPDATE conversations SET updated_at = ?, title = ? WHERE id = ?`,
    ).run(ts, title, id);
  } else {
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
      ts,
      id,
    );
  }
}

export function deleteConversation(id: string) {
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

export function listMessages(conversationId: string): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, conversation_id, role, content, tool_name, tool_call_id, created_at, bot_id, bot_name
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    role: ChatMessage["role"];
    content: string;
    tool_name: string | null;
    tool_call_id: string | null;
    created_at: string;
    bot_id: string | null;
    bot_name: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    toolName: r.tool_name,
    toolCallId: r.tool_call_id,
    createdAt: r.created_at,
    reactions: getReactions(r.id),
    attachments: messageUploads(r.id),
    botId: r.bot_id,
    botName: r.bot_name,
  }));
}

export function insertMessage(input: {
  conversationId: string;
  role: ChatMessage["role"];
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  botId?: string;
  botName?: string;
  reasoning?: { content: string; scope: string };
}): ChatMessage {
  const id = nanoid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, tool_name, tool_call_id, created_at, bot_id, bot_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.conversationId,
    input.role,
    input.content,
    input.toolName ?? null,
    input.toolCallId ?? null,
    ts,
    input.botId ?? null,
    input.botName ?? null,
  );
  touchConversation(input.conversationId);
  if (input.reasoning) db.prepare("INSERT INTO message_reasoning (message_id, scope, content) VALUES (?, ?, ?)").run(id, input.reasoning.scope, input.reasoning.content);
  return {
    id,
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    toolName: input.toolName ?? null,
    toolCallId: input.toolCallId ?? null,
    createdAt: ts,
    botId: input.botId,
    botName: input.botName,
  };
}

export function titleFromMessage(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New chat";
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned;
}
