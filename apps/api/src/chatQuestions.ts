import { db } from "./db.js";
import { getOwnedConversation, insertMessage } from "./conversations.js";
import type { ChatQuestion } from "@rex/shared";

db.exec(`CREATE TABLE IF NOT EXISTS chat_questions (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  questions TEXT NOT NULL,
  answered_at TEXT,
  answer_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL
)`);

export function messageQuestion(messageId: string): ChatQuestion | undefined {
  const row = db.prepare("SELECT questions, answered_at FROM chat_questions WHERE message_id = ?").get(messageId) as { questions: string; answered_at: string | null } | undefined;
  return row ? { id: messageId, questions: JSON.parse(row.questions), answeredAt: row.answered_at } : undefined;
}

export function askUser(ownerId: string, conversationId: string, botId: string, raw: unknown) {
  const conversation = getOwnedConversation(conversationId, ownerId);
  const bot = getOwnedConversation(botId, ownerId);
  if (!conversation || !bot?.bot || (conversation.id !== botId && !conversation.memberIds?.includes(botId))) throw new Error("Only a bot in this conversation can ask questions.");
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw new Error("Ask 1 to 3 focused questions.");
  const questions = raw.map((value, index) => {
    if (!value || typeof value.question !== "string" || !value.question.trim() || value.question.length > 600) throw new Error("Each question needs a prompt up to 600 characters.");
    const options = value.options ?? [];
    if (!Array.isArray(options) || options.length > 4 || options.length === 1 || options.some((option: unknown) => typeof option !== "string" || !option.trim() || option.length > 160) || new Set(options).size !== options.length) throw new Error("Provide 2 to 4 distinct options, or no options for a text answer.");
    return { id: `q${index + 1}`, question: value.question.trim(), options };
  });
  const existing = db.prepare(`SELECT q.message_id FROM chat_questions q JOIN messages m ON m.id = q.message_id WHERE m.conversation_id = ? AND q.answered_at IS NULL LIMIT 1`).get(conversationId) as { message_id: string } | undefined;
  if (existing) return { existing: true as const, message: { id: existing.message_id }, question: messageQuestion(existing.message_id)! };
  return db.transaction(() => {
    const message = insertMessage({ conversationId, role: "assistant", botId, botName: bot.bot!.name, content: questions.map((q) => q.question).join("\n\n") });
    db.prepare("INSERT INTO chat_questions(message_id, questions) VALUES (?, ?)").run(message.id, JSON.stringify(questions));
    message.question = messageQuestion(message.id);
    return { existing: false as const, message, question: message.question! };
  })();
}
