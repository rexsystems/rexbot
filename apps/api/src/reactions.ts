import { REACTION_EMOJIS, type MessageReaction, type ReactionEmoji } from "@rex/shared";
import { db } from "./db.js";

export function isReaction(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && REACTION_EMOJIS.some((emoji) => emoji === value);
}

export function getReactions(messageId: string): MessageReaction[] {
  return db.prepare("SELECT actor, emoji FROM message_reactions WHERE message_id = ? ORDER BY actor").all(messageId) as MessageReaction[];
}

export function setReaction(messageId: string, actor: MessageReaction["actor"], emoji: ReactionEmoji, toggle = false) {
  const previous = getReactions(messageId).find((r) => r.actor === actor);
  if (toggle && previous?.emoji === emoji) {
    db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND actor = ?").run(messageId, actor);
  } else {
    db.prepare("INSERT INTO message_reactions (message_id, actor, emoji) VALUES (?, ?, ?) ON CONFLICT(message_id, actor) DO UPDATE SET emoji = excluded.emoji").run(messageId, actor, emoji);
  }
  return getReactions(messageId);
}
