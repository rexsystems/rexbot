import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT, DEFAULT_SETTINGS, type SseEvent } from "@rex/shared";
import { asUser, TEST_USER } from "./helpers.js";

test("messages sent during generation are saved immediately and interrupt the model with updated context", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-realtime-"));
  process.env.REX_DATA_DIR = directory;
  const { db } = await import("../src/db.js");
  const { createConversation, listMessages } = await import("../src/conversations.js");
  const { chatRoutes } = await import("../src/routes/chat.js");
  const { activeChats } = await import("../src/groups.js");
  const { saveGroup } = await import("../src/groups.js");
  const { computers, UnavailableComputer } = await import("../src/computer.js");
  const originalComputer = computers.forOwner;
  let toolStarted!: () => void;
  const toolWaiting = new Promise<void>((resolve) => { toolStarted = resolve; });
  let finishTool!: () => void;
  const toolFinished = new Promise<void>((resolve) => { finishTool = resolve; });
  const commands: string[] = [];
  const guest = new UnavailableComputer("qemu", "fixture");
  guest.execute = async (command: string) => {
    commands.push(command);
    toolStarted();
    await toolFinished;
    return { command, output: "Finished the already-running command", exitCode: 0, timedOut: false };
  };
  computers.forOwner = () => guest;
  let groupStarted!: () => void;
  const groupWaiting = new Promise<void>((resolve) => { groupStarted = resolve; });
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  let sawUpdate = false;
  let firstClosed = false;
  const model = createServer(async (request, response) => {
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    response.setHeader("Content-Type", "text/event-stream");
    const users = body.messages.filter((item: { role: string }) => item.role === "user");
    if (users.at(-1).content === "How is it going?") {
      assert.ok(users.some((item: { content: string }) => item.content === "Run commands"), "the original task stays in context");
      assert.match(body.messages[0].content, /Keep unfinished authorized work active/);
      const resumed = body.messages.some((item: { role: string; content: string }) => item.role === "tool" && item.content.includes('"command":"resume"'));
      const delta = resumed ? { content: "Status answered; original work finished." } : { tool_calls: [{ index: 0, id: "resume_work", type: "function", function: { name: "computer_exec", arguments: JSON.stringify({ command: "resume" }) } }] };
      response.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    if (users.at(-1).content === "Run commands") {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: ["first", "second"].map((command, index) => ({ index, id: `test_${index}`, type: "function", function: { name: "computer_exec", arguments: JSON.stringify({ command }) } })) } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    if (users.at(-1).content === "@Live Wait here") {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Waiting for details." } }] })}\n\n`);
      groupStarted();
      return;
    }
    if (users.at(-1).content === "@Peer Take over") {
      const name = JSON.parse(body.messages[0].content.match(/Your display name is ("[^"\n]*")/)[1]);
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `${name} took over.` } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    if (users.at(-1).content === "Build a red site") {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Starting the layout." } }] })}\n\n`);
      response.once("close", () => { firstClosed = true; });
      firstStarted();
      return;
    }
    sawUpdate = users.some((item: { content: string }) => item.content === "Actually, use green");
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "Using green." } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const settings = { ...DEFAULT_SETTINGS, llmApiKey: "test-only-key", llmBaseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, llmModel: "fixture" };
  const bot = createConversation("Live", { ...DEFAULT_BOT, name: "Live" }, TEST_USER.id);
  const send = (message: string) => asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: bot.id, message, settings }) });
  try {
    const first = await send("Build a red site");
    await started;
    const second = await send("Actually, use green");
    assert.equal(second.status, 200);
    assert.equal(listMessages(bot.id).filter((item) => item.content === "Actually, use green").length, 1);
    const accepted = await second.text();
    assert.match(accepted, /user_message/);
    const events = (await first.text()).split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)) as SseEvent);
    assert.ok(!events.some((event) => event.type === "error"), JSON.stringify(events));
    assert.equal(sawUpdate, true);
    assert.equal(firstClosed, true);
    assert.equal(listMessages(bot.id).at(-1)!.content, "Using green.");
    assert.ok(listMessages(bot.id).findIndex((item) => item.content === "Starting the layout.") < listMessages(bot.id).findIndex((item) => item.content === "Actually, use green"));
    assert.equal(activeChats.has(bot.id), false);

    const work = await send("Run commands");
    await toolWaiting;
    await (await send("Skip second command")).text();
    finishTool();
    await work.text();
    assert.deepEqual(commands, ["first"], "obsolete tool calls must not execute after a user update");
    assert.ok(listMessages(bot.id).some((item) => item.role === "tool" && item.content.startsWith("Skipped:")));

    await (await send("How is it going?")).text();
    assert.deepEqual(commands, ["first", "resume"], "a side question must still allow work on the original task");
    assert.equal(listMessages(bot.id).at(-1)!.content, "Status answered; original work finished.");

    const peer = createConversation("Peer", { ...DEFAULT_BOT, name: "Peer" }, TEST_USER.id);
    const group = saveGroup("Live group", [bot.id, peer.id], TEST_USER.id);
    const sendGroup = (message: string) => asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: group.id, message, settings }) });
    const groupWork = await sendGroup("@Live Wait here");
    await groupWaiting;
    await (await sendGroup("@Peer Take over")).text();
    await groupWork.text();
    assert.equal(listMessages(group.id).at(-1)!.botId, peer.id);
    assert.equal(listMessages(group.id).at(-1)!.content, "Peer took over.");
  } finally {
    finishTool();
    computers.forOwner = originalComputer;
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
