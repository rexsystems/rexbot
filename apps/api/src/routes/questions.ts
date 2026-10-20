import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import { db } from "../db.js";
import { messageQuestion } from "../chatQuestions.js";
import { insertMessage } from "../conversations.js";
import { prepareChatTurn } from "../chatTurn.js";

export const questionRoutes = new Hono<AppEnv>();
questionRoutes.post("/questions/:id/answer", async (c) => {
  const row = db.prepare(`SELECT m.conversation_id, m.bot_id, m.bot_name FROM messages m JOIN conversations v ON v.id = m.conversation_id WHERE m.id = ? AND v.user_id = ?`).get(c.req.param("id"), c.get("user").id) as { conversation_id: string; bot_id: string; bot_name: string } | undefined;
  const question = row ? messageQuestion(c.req.param("id")) : undefined;
  if (!row || !question) return c.json({ error: "Question not found." }, 404);
  if (question.answeredAt) return c.json({ error: "This question has already been answered." }, 409);
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.answers) || body.answers.length !== question.questions.length || body.answers.some((value: unknown) => typeof value !== "string" || !value.trim() || value.length > 2000)) return c.json({ error: "Answer each question with up to 2000 characters." }, 400);
  if (messageQuestion(question.id)?.answeredAt) return c.json({ error: "This question has already been answered." }, 409);
  const message = question.questions.map((q, index) => `${q.question}\n${body.answers[index].trim()}`).join("\n\n");
  const turn = await prepareChatTurn({ userId: c.get("user").id, conversationId: row.conversation_id, respondTo: row.bot_id, message, settings: body.settings, timeZone: body.timeZone });
  if (!turn.ok) return c.json({ error: turn.error }, turn.status);
  void turn.run((event) => {
    if (event.type === "error") insertMessage({ conversationId: row.conversation_id, role: "assistant", botId: row.bot_id, botName: row.bot_name, content: `Could not continue: ${event.message}` });
  }).catch(() => undefined);
  return c.json({ ok: true }, 202);
});
