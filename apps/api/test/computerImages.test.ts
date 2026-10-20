import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT, DEFAULT_SETTINGS, type SseEvent } from "@rex/shared";
import { asUser, TEST_USER } from "./helpers.js";

test("bots share real guest images as owner-scoped persisted chat attachments", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-computer-images-"));
  process.env.REX_DATA_DIR = directory;
  const { db } = await import("../src/db.js");
  const { createConversation, listMessages } = await import("../src/conversations.js");
  const { shareComputerImage } = await import("../src/computerImages.js");
  const { chatRoutes } = await import("../src/routes/chat.js");
  const { uploadRoutes } = await import("../src/routes/uploads.js");
  const { computers } = await import("../src/computer.js");
  const { DesktopComputer } = await import("../src/computer/desktop.js");
  const original = computers.forOwner;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=", "base64");
  let requestedLimit = 0;
  const desktop = new DesktopComputer({ label: "Fixture guest", state: async () => "running", start: async () => {}, stop: async () => {} }, async (args, _input, _timeout, limit) => {
    if (args[0] === "python3") { requestedLimit = limit!; return { code: 0, timedOut: false, output: JSON.stringify({ filename: "result.png", data: png.toString("base64") }) }; }
    return { code: 0, timedOut: false, output: args[1] === "ping" ? "ok" : JSON.stringify({ slot: 0, wsPort: 6080 }) };
  }, () => { throw new Error("No VNC tunnel needed"); });
  computers.forOwner = () => desktop;
  const model = createServer(async (request, response) => {
    let raw = "";
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const text = body.messages.some((message: { role: string }) => message.role === "tool") ? "Screenshot attached." : '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="computer_screenshot"><｜｜DSML｜｜ parameter name="share" string="false">true</｜｜DSML｜｜ parameter><｜｜DSML｜｜ parameter name="caption" string="true">The project screen</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>';
    response.setHeader("Content-Type", "text/event-stream");
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const bot = createConversation("Photo", { ...DEFAULT_BOT, name: "Photo" }, TEST_USER.id);
  try {
    const response = await asUser(chatRoutes).request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: bot.id, message: "Show the result", settings: { ...DEFAULT_SETTINGS, llmApiKey: "test-only-key", llmBaseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}` } }) });
    const events = (await response.text()).split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)) as SseEvent);
    assert.ok(!events.some((event) => event.type === "error"), JSON.stringify(events));
    assert.ok(!JSON.stringify(events).includes("DSML"));
    const shared = events.find((event) => event.type === "assistant_message");
    assert.ok(shared?.type === "assistant_message", JSON.stringify(events));
    const image = shared.message.attachments![0]!;
    assert.equal(shared.message.botId, bot.id);
    assert.equal(shared.message.content, "The project screen");
    assert.equal(image.mimeType, "image/png");
    assert.ok(requestedLimit > 8 * 1024 * 1024);
    assert.equal(listMessages(bot.id).filter((message) => message.attachments?.length).length, 1);
    const content = await asUser(uploadRoutes).request(`/uploads/${image.id}/content`);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), png);
    assert.equal((await asUser(uploadRoutes, { ...TEST_USER, id: "another-owner" }).request(`/uploads/${image.id}/content`)).status, 404);
    const foreign = createConversation("Other", DEFAULT_BOT, "another-owner");
    assert.throws(() => shareComputerImage(TEST_USER.id, foreign.id, bot.id, { filename: "x.png", bytes: png }), /cannot attach/);
    assert.throws(() => shareComputerImage(TEST_USER.id, bot.id, bot.id, { filename: "x.svg", bytes: Buffer.from("<svg/>") }), /Use a PNG/);
  } finally {
    computers.forOwner = original;
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
