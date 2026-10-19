import { nanoid } from "nanoid";
import type { BotExchange } from "@rex/shared";
import { db, nowIso } from "./db.js";
import { createConversation, getConversation, touchConversation } from "./conversations.js";

export const activeChats = new Set<string>();

export function saveGroup(title: string, memberIds: string[], id?: string) {
  return db.transaction(() => {
    const group = id ? getConversation(id)! : createConversation(title);
    db.prepare("UPDATE conversations SET kind = 'group' WHERE id = ?").run(group.id);
    db.prepare("DELETE FROM group_members WHERE group_id = ?").run(group.id);
    const insert = db.prepare("INSERT INTO group_members (group_id, bot_id, position) VALUES (?, ?, ?)");
    memberIds.forEach((botId, position) => insert.run(group.id, botId, position));
    touchConversation(group.id, title);
    return getConversation(group.id)!;
  })();
}

export function commonGroup(fromId: string, toId: string, groupId?: string): string | undefined {
  const rows = db.prepare(`SELECT a.group_id FROM group_members a JOIN group_members b ON a.group_id = b.group_id
    WHERE a.bot_id = ? AND b.bot_id = ? ORDER BY a.group_id`).all(fromId, toId) as Array<{ group_id: string }>;
  return groupId ? rows.find((row) => row.group_id === groupId)?.group_id : rows[0]?.group_id;
}

export function peers(botId: string, groupId?: string) {
  const rows = db.prepare(`SELECT DISTINCT b.bot_id FROM group_members a JOIN group_members b ON a.group_id = b.group_id
    WHERE a.bot_id = ? AND b.bot_id != ? AND (? IS NULL OR a.group_id = ?)`).all(botId, botId, groupId ?? null, groupId ?? null) as Array<{ bot_id: string }>;
  return rows.map((row) => getConversation(row.bot_id)).filter((bot) => bot?.bot).map((bot) => ({ id: bot!.id, name: bot!.bot!.name }));
}

export function recordExchange(input: Omit<BotExchange, "id" | "createdAt">) {
  const exchange = { ...input, id: nanoid(), createdAt: nowIso() };
  db.prepare(`INSERT INTO bot_exchanges (id, group_id, from_id, to_id, from_name, to_name, message, reply, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(exchange.id, input.groupId, input.fromId, input.toId, input.fromName, input.toName, input.message, input.reply, exchange.createdAt);
  return exchange;
}

export function listExchanges(groupId: string): BotExchange[] {
  return db.prepare(`SELECT id, group_id AS groupId, from_id AS fromId, to_id AS toId, from_name AS fromName, to_name AS toName, message, reply, created_at AS createdAt
    FROM bot_exchanges WHERE group_id = ? ORDER BY created_at, rowid`).all(groupId) as BotExchange[];
}
