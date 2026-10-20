import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT, DEFAULT_SETTINGS } from "@rex/shared";

test("vision connections receive screenshot pixels after tool results and text-only connections do not", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rex-vision-"));
  process.env.REX_DATA_DIR = dir;
  const { db } = await import("../src/db.js");
  const { createUser } = await import("../src/auth.js");
  const owner = await createUser({ email: "vision@example.com", name: "Vision", password: "vision-fixture-password" });
  const { createConversation } = await import("../src/conversations.js");
  const { listMessages } = await import("../src/conversations.js");
  const { shareComputerImage } = await import("../src/computerImages.js");
  const { historyToLlm } = await import("../src/chatTurn.js");
  const { prepareChatTurn } = await import("../src/chatTurn.js");
  const { saveConnection } = await import("../src/providers.js");
  const { resolveModelSettings } = await import("../src/providers.js");
  const { computers } = await import("../src/computer.js");
  const { DesktopComputer } = await import("../src/computer/desktop.js");
  const { toAnthropicMessages, streamChatCompletion } = await import("../src/llm.js");
  const { modelImage, uploadImages } = await import("../src/vision.js");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=", "base64");
  const original = computers.forOwner;
  const computer = new DesktopComputer({ label: "Vision guest", state: async () => "running", start: async () => {}, stop: async () => {} }, async (args) => ({ code: 0, timedOut: false, output: args[0] === "python3" ? JSON.stringify({ filename: "screen.png", data: png.toString("base64") }) : args[1] === "ping" ? "ok" : JSON.stringify({ slot: 0, wsPort: 6080 }) }), () => { throw new Error("No tunnel needed"); });
  computers.forOwner = () => computer;
  let pixels = 0;
  let boundedImages = 0;
  let fail: string | undefined;
  const model = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const afterTool = body.messages.some((message: any) => message.role === "tool");
    if (!afterTool && Array.isArray(body.messages.at(-1).content)) boundedImages = body.messages.at(-1).content.filter((part: any) => part.type === "image_url").length;
    if (afterTool) {
      const image = body.messages.at(-1).content;
      if (!Array.isArray(image) || image[0]?.image_url?.url !== `data:image/png;base64,${png.toString("base64")}`) fail = "Screenshot bytes were missing or changed";
      else pixels++;
      if (body.messages.findIndex((message: any) => Array.isArray(message.content)) < body.messages.findIndex((message: any) => message.role === "tool")) fail = "Image preceded its tool result";
    }
    res.setHeader("Content-Type", "text/event-stream");
    const delta = afterTool ? { content: "The image input is present." } : { tool_calls: [{ index: 0, id: "screen", function: { name: "computer_screenshot", arguments: "{}" } }] };
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  try {
    await saveConnection(owner.id, "admin", { provider: "custom", label: "Vision fixture", baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, defaultModel: "fixture", vision: true });
    const bot = createConversation("Vision", DEFAULT_BOT, owner.id);
    const turn = await prepareChatTurn({ userId: owner.id, conversationId: bot.id, message: "Inspect the page", settings: DEFAULT_SETTINGS });
    assert.ok(turn.ok);
    const errors: string[] = [];
    await turn.run((event) => { if (event.type === "error") errors.push(event.message); });
    assert.deepEqual(errors, []);
    assert.equal(fail, undefined);
    assert.equal(pixels, 1);
    const { runTool } = await import("../src/tools/index.js");
    const originalWorkspace = computer.workspace.bind(computer);
    computer.workspace = async () => JSON.stringify({ browser_launched: true, url: "https://example.com" });
    const automatic: string[] = [];
    const context = { ownerId: owner.id, botId: bot.id, userMessageId: "fixture", onImage: (image: { data: string }) => automatic.push(image.data) };
    const observed = JSON.parse(await runTool("computer_browser", JSON.stringify({ url: "https://example.com" }), DEFAULT_SETTINGS, context));
    assert.equal(observed.observation.pixels_included, true);
    assert.deepEqual(automatic, [png.toString("base64")]);
    computer.workspace = async () => JSON.stringify({ browser_launched: false, note: "Owner controls screen" });
    await runTool("computer_browser", JSON.stringify({ url: "https://example.com" }), DEFAULT_SETTINGS, context);
    assert.equal(automatic.length, 1);
    computer.workspace = originalWorkspace;
    const originalInput = computer.input.bind(computer);
    computer.input = async () => "click done";
    const inputObservation = JSON.parse(await runTool("computer_input", '{"action":"click","x":10,"y":10}', DEFAULT_SETTINGS, context));
    assert.equal(inputObservation.observation.pixels_included, true);
    assert.equal(automatic.length, 2);
    computer.input = async () => { throw new Error("The user has the mouse and keyboard"); };
    assert.match(await runTool("computer_input", '{"action":"click","x":10,"y":10}', DEFAULT_SETTINGS, context), /user has the mouse/);
    assert.equal(automatic.length, 2);
    computer.input = originalInput;
    const shared = shareComputerImage(owner.id, bot.id, bot.id, { filename: "saved-screen.png", bytes: png });
    const settings = resolveModelSettings(owner.id, DEFAULT_SETTINGS, bot.bot, bot.id);
    const restored = historyToLlm(listMessages(bot.id), settings, bot.id);
    assert.ok(restored.some((message) => message.images?.[0]?.data === png.toString("base64")));
    assert.deepEqual(uploadImages([shared.attachments![0]!.id], { ...settings, route: { ...settings.route!, userId: "another-owner" } }), []);
    const image = modelImage(png)!;
    for await (const _chunk of streamChatCompletion({ settings, messages: [{ role: "user", content: "Bound the visual context", images: Array.from({ length: 8 }, () => image) }] })) { /* Only inspect the outgoing wire payload. */ }
    assert.equal(boundedImages, 4);
    const native = toAnthropicMessages([{ role: "user", content: "Inspect", images: [image] }]);
    assert.deepEqual(native.messages[0]!.content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } });
    assert.deepEqual(uploadImages(["anything"], DEFAULT_SETTINGS), []);
    assert.equal(modelImage(Buffer.alloc(6 * 1024 * 1024)), null);
  } finally {
    computers.forOwner = original; model.closeAllConnections(); await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
