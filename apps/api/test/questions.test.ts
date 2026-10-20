import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT, DEFAULT_SETTINGS, type SseEvent } from "@rex/shared";
import { asUser, TEST_USER } from "./helpers.js";

test("clarification cards persist, pause dependent tools and resume once with the owner's answers", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rex-questions-"));
  process.env.REX_DATA_DIR = dir;
  const { db } = await import("../src/db.js");
  const { createConversation, listMessages } = await import("../src/conversations.js");
  const { chatRoutes } = await import("../src/routes/chat.js");
  const { questionRoutes } = await import("../src/routes/questions.js");
  const { activeChats } = await import("../src/groups.js");
  let calls = 0;
  const model = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    calls++;
    const answered = body.messages.some((message: any) => message.role === "user" && message.content.includes("Visual style"));
    const delta = answered ? { content: "I will build the visual style you chose." } : { tool_calls: [
      { index: 0, id: "question", function: { name: "ask_user", arguments: JSON.stringify({ questions: [{ question: "Which part of the reference should match?", options: ["Visual style", "DNS functionality"] }] }) } },
      { index: 1, id: "dependent", function: { name: "computer_exec", arguments: '{"command":"must-not-run"}' } },
    ] };
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const settings = { ...DEFAULT_SETTINGS, llmApiKey: "test-only", llmBaseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}` };
  const bot = createConversation("Questions", DEFAULT_BOT, TEST_USER.id);
  try {
    const first = await asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: bot.id, message: "Make it like the reference", settings }) });
    const events = (await first.text()).split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)) as SseEvent);
    const question = listMessages(bot.id).find((message) => message.question)!;
    assert.ok(question.question);
    assert.equal(calls, 1);
    assert.equal(activeChats.has(bot.id), false);
    assert.ok(!listMessages(bot.id).some((message) => message.content === "(no response)"));
    assert.ok(listMessages(bot.id).some((message) => message.toolName === "computer_exec" && message.content.startsWith("Skipped:")));
    assert.ok(events.some((event) => event.type === "assistant_message" && event.message.question));
    const answer = (user = TEST_USER, answers = ["Visual style"]) => asUser(questionRoutes, user).request(`/questions/${question.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers, settings }) });
    assert.equal((await answer({ ...TEST_USER, id: "another-owner" })).status, 404);
    assert.equal((await answer(TEST_USER, [""])).status, 400);
    assert.deepEqual((await Promise.all([answer(), answer()])).map((response) => response.status).sort(), [202, 409]);
    for (let attempt = 0; attempt < 100 && activeChats.has(bot.id); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(listMessages(bot.id).at(-1)!.content, "I will build the visual style you chose.");
    assert.ok(listMessages(bot.id).find((message) => message.id === question.id)!.question!.answeredAt);
  } finally {
    model.closeAllConnections(); await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
