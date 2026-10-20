import { test } from "node:test";
import { asUser, TEST_USER } from "./helpers.js";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { botReplyText, DEFAULT_BOT, DEFAULT_SETTINGS, type SseEvent } from "@rex/shared";

test("thinking tools replay streamed reasoning in public/private rounds and later turns without visible speaker prefixes", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-reasoning-test-"));
  process.env.REX_DATA_DIR = directory;
  const { db } = await import("../src/db.js");
  const { createConversation, insertMessage, listMessages } = await import("../src/conversations.js");
  const { chatRoutes, historyToLlm } = await import("../src/routes/chat.js");
  const { messageBot } = await import("../src/botMessaging.js");
  const { saveGroup, listExchanges } = await import("../src/groups.js");
  const { messageReasoning } = await import("../src/reasoning.js");
  const bix = createConversation("Bix", { ...DEFAULT_BOT, name: "Bix" }, TEST_USER.id);
  const puck = createConversation("Puck", { ...DEFAULT_BOT, name: "Puck" }, TEST_USER.id);
  const group = saveGroup("Team", [bix.id, puck.id], TEST_USER.id);
  insertMessage({ conversationId: bix.id, role: "assistant", content: "[Bix]: Legacy visible answer.", botId: bix.id, botName: "Bix" });
  const expectedCalls = new Map<string, string>();
  let count = 0;
  const failures: string[] = [];
  const model = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (!body.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const name = JSON.parse(body.messages[0].content.match(/Your display name is ("[^"\n]*")/)![1]);
    for (const message of body.messages.filter((message: any) => message.role === "assistant")) {
      const expected = message.tool_calls ? expectedCalls.get(message.tool_calls[0].id) : message.content.includes("Legacy visible") ? "" : message.content.includes("Checking 0") ? "tool-thought-0" : message.content.includes("Checking 1") ? "tool-thought-1" : "final-thought";
      if (message.reasoning_content !== expected) failures.push(`Missing/incomplete reasoning: ${message.content ?? message.tool_calls?.[0]?.id}`);
      if (!message.tool_calls && message.content?.startsWith(`[${name}]:`)) failures.push("Own speaker label returned in history");
    }
    if (failures.length) { response.writeHead(400, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: { message: "The `reasoning_content` in the thinking mode must be passed back to the API." } })); return; }
    const round = body.messages.filter((message: any) => message.role === "tool").length;
    const thought = round < 2 ? `tool-thought-${round}` : "final-thought";
    const id = `fixture_${count++}`;
    expectedCalls.set(id, thought);
    const deltas = [
      { reasoning_content: thought.slice(0, 5) }, { reasoning_content: thought.slice(5) },
      { content: `[${name.slice(0, 1)}` }, { content: `${name.slice(1)}]: ` },
      { content: round < 2 ? `Checking ${round}.` : "Done." },
      ...(round < 2 ? [{ tool_calls: [{ index: 0, id, type: "function", function: { name: "web_search", arguments: '{"query":"fixture"}' } }] }] : []),
    ];
    response.setHeader("Content-Type", "text/event-stream");
    response.end(deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join("") + "data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const settings = { ...DEFAULT_SETTINGS, llmApiKey: "test-only-key", llmBaseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, llmModel: "deepseek-flash" };
  try {
    for (let turn = 0; turn < 2; turn++) {
      const response = await asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: bix.id, message: "Do work", settings }) });
      const events = (await response.text()).split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)) as SseEvent);
      assert.ok(!events.some((event) => event.type === "error"), JSON.stringify(events));
      assert.equal(events.filter((event) => event.type === "delta").map((event) => event.text).join(""), "Checking 0.Checking 1.Done.");
      assert.ok(!JSON.stringify(events).includes("thought"));
      const final = listMessages(bix.id).at(-1)!;
      assert.equal(final.content, "Done.");
      assert.equal(messageReasoning(final.id, settings).reasoning_content, "final-thought");
      assert.ok(!JSON.stringify(listMessages(bix.id)).includes("thought"));
    }
    for (let turn = 0; turn < 2; turn++) {
      const result = JSON.parse(await messageBot(settings, { ownerId: TEST_USER.id, botId: bix.id, groupId: group.id, budget: { remaining: 6 } }, puck.id, "Do work"));
      assert.equal(result.reply, "Done.");
      assert.ok(!JSON.stringify(listExchanges(group.id)).includes("thought"));
    }
    assert.deepEqual(failures, []);
    const ownHistory = historyToLlm(listMessages(bix.id), settings, bix.id);
    assert.ok(ownHistory.every((message) => !message.content?.startsWith("[Bix]:")));
    const groupHistory = historyToLlm(listMessages(bix.id), settings, puck.id);
    assert.ok(groupHistory.some((message) => message.content === "[Bix]: Done."));
    const otherProvider = historyToLlm(listMessages(bix.id), { ...settings, llmModel: "other-provider" }, bix.id);
    assert.ok(otherProvider.every((message) => message.reasoning_content === undefined));
  } finally {
    await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("speaker labels are removed only at the start of the current bot's reply", () => {
  assert.equal(botReplyText("[Bix]: Salut!", "Bix"), "Salut!");
  assert.equal(botReplyText(" [Bix] : Salut!", "Bix"), "Salut!");
  assert.equal(botReplyText("[Bi", "Bix", false), "");
  assert.equal(botReplyText("[Bix]", "Bix", false), "");
  assert.equal(botReplyText("[Bix]", "Bix"), "[Bix]");
  assert.equal(botReplyText("[1, 2, 3]", "Bix", false), "[1, 2, 3]");
  assert.equal(botReplyText("[Puck]: Salut!", "Bix"), "[Puck]: Salut!");
  assert.equal(botReplyText("Citat: [Bix]: Salut!", "Bix"), "Citat: [Bix]: Salut!");
});
