import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_BOT, DEFAULT_SETTINGS, buildSystemPrompt, type Conversation, type SseEvent } from "@rex/shared";

test("groups preserve speakers, permit real private replies only among peers, and enforce turn limits", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-groups-test-"));
  process.env.REX_DATA_DIR = directory;
  const { db } = await import("../src/db.js");
  const { createConversation, getConversation, listMessages, deleteConversation } = await import("../src/conversations.js");
  const { groupRoutes } = await import("../src/routes/groups.js");
  const { chatRoutes } = await import("../src/routes/chat.js");
  const { botRoutes } = await import("../src/routes/bots.js");
  const { activeChats, listExchanges } = await import("../src/groups.js");
  const { messageBot } = await import("../src/botMessaging.js");
  const alpha = createConversation("Alpha", { ...DEFAULT_BOT, name: "Alpha" });
  const beta = createConversation("Beta", { ...DEFAULT_BOT, name: "Beta" });
  const outsider = createConversation("Outsider", { ...DEFAULT_BOT, name: "Outsider" });
  const legacy = createConversation("Old conversation");
  const calls: Array<{ messages: Array<{ role: string; content: string }>; tools?: Array<{ function: { name: string } }> }> = [];
  let fetchedFact = false;
  let modelUrl = "";
  const model = createServer(async (request, response) => {
    if (request.url === "/fact") { fetchedFact = true; response.end("Verified fixture value: 42"); return; }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    if (!body.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    calls.push(body);
    const system = body.messages[0].content as string;
    const hasTool = body.messages.some((message: { role: string }) => message.role === "tool");
    const privateRequest = system.includes("answering a private request");
    const alphaTurn = system.includes('Your display name is "Alpha"');
    const tool = (name: string, args: unknown) => ({ tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const delta = privateRequest ? hasTool ? { content: "I fetched and verified the fixture: 42." } : tool("http_fetch", { url: `${modelUrl}/fact` }) : alphaTurn && !hasTool ? tool("message_bot", { bot_id: beta.id, message: "Check the fixture for me." }) : { content: alphaTurn ? "Beta checked the fixture: 42." : "I reviewed Alpha's result: 42." };
    response.setHeader("Content-Type", "text/event-stream");
    response.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  modelUrl = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
  const settings = { ...DEFAULT_SETTINGS, llmApiKey: "test-only-key", llmBaseUrl: modelUrl };
  const post = (route: { request: typeof groupRoutes.request }, url: string, body: unknown) => route.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    for (const memberIds of [[], [alpha.id], [alpha.id, alpha.id], [alpha.id, "missing"], [alpha.id, legacy.id], Array(7).fill(beta.id)]) {
      assert.equal((await post(groupRoutes, "/groups", { title: "Team", memberIds })).status, 400);
    }
    const response = await post(groupRoutes, "/groups", { title: "Team", memberIds: [alpha.id, beta.id] });
    assert.equal(response.status, 201);
    const group = await response.json() as Conversation;
    assert.equal(group.kind, "group");
    assert.deepEqual(getConversation(group.id)?.memberIds, [alpha.id, beta.id]);
    assert.equal((await post(botRoutes, `/bots/${group.id}`, DEFAULT_BOT)).status, 404);
    assert.equal((await post(groupRoutes, `/groups/${alpha.id}`, { title: "Bad", memberIds: [alpha.id, beta.id] })).status, 404);
    assert.equal((await post(groupRoutes, "/groups", { title: "Bad", memberIds: [alpha.id, group.id] })).status, 400);
    activeChats.add(group.id);
    assert.equal((await post(groupRoutes, `/groups/${group.id}`, { title: "Busy", memberIds: [alpha.id, beta.id] })).status, 409);
    assert.equal((await post(chatRoutes, "/chat", { conversationId: group.id, message: "Coordinate", settings })).status, 409);
    activeChats.delete(group.id);
    const budget = { remaining: 2 };
    assert.match(await messageBot(settings, { botId: alpha.id, budget }, outsider.id, "Hello"), /must share a group/);
    assert.match(await messageBot(settings, { botId: alpha.id, budget }, alpha.id, "Hello"), /another bot/);
    assert.match(await messageBot(settings, { botId: alpha.id, budget: { remaining: 0 } }, beta.id, "Hello"), /budget is exhausted/);
    assert.equal(budget.remaining, 2);
    const result = await post(chatRoutes, "/chat", { conversationId: group.id, message: "Coordinate", settings });
    assert.equal(result.status, 200);
    const events = (await result.text()).split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)) as SseEvent);
    assert.deepEqual(events.filter((event) => event.type === "speaker").map((event) => event.botId), [alpha.id, beta.id]);
    assert.ok(!events.some((event) => event.type === "error"));
    assert.equal(events.filter((event) => event.type === "done").length, 1);
    assert.equal(activeChats.has(group.id), false);
    assert.equal(fetchedFact, true);
    const messages = listMessages(group.id).filter((message) => message.role === "assistant");
    assert.deepEqual(messages.map((message) => message.botName), ["Alpha", "Beta"]);
    assert.match(messages[0]!.content, /42/);
    assert.equal(listMessages(alpha.id).length, 0);
    assert.equal(listMessages(beta.id).length, 0);
    const exchanges = listExchanges(group.id);
    assert.equal(exchanges.length, 1);
    assert.equal(exchanges[0]!.fromId, alpha.id);
    assert.match(exchanges[0]!.reply, /fetched and verified/);
    const privateCalls = calls.filter((call) => call.messages[0]!.content.includes("answering a private request"));
    assert.ok(privateCalls.length >= 2);
    assert.ok(privateCalls.every((call) => !call.tools?.some((tool) => tool.function.name === "message_bot" || tool.function.name === "react_message")));
    assert.ok(calls.filter((call) => !call.messages[0]!.content.includes("answering a private request")).every((call) => call.messages[0]!.content.includes("R-38")));
    const log = await groupRoutes.request(`/groups/${group.id}/exchanges`);
    assert.deepEqual(await log.json(), exchanges);
    await post(groupRoutes, `/groups/${group.id}`, { title: "Renamed team", memberIds: [alpha.id, outsider.id] });
    assert.equal(getConversation(group.id)?.title, "Renamed team");
    assert.match(await messageBot(settings, { botId: alpha.id, budget }, beta.id, "Hello"), /must share a group/);
    deleteConversation(outsider.id);
    assert.deepEqual(getConversation(group.id)?.memberIds, [alpha.id]);
    deleteConversation(group.id);
    assert.equal(listExchanges(group.id).length, 0);
    assert.ok(getConversation(alpha.id));
    assert.ok(getConversation(beta.id));
    const prompt = buildSystemPrompt(undefined, DEFAULT_BOT);
    for (let i = 1; i <= 38; i++) assert.ok(prompt.includes(`R-${String(i).padStart(2, "0")}:`));
  } finally {
    await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
