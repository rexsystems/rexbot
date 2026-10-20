import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT, DEFAULT_SETTINGS, type SseEvent } from "@rex/shared";
import { WebWorkflow } from "../src/webWorkflow.js";

test("website checks reject stale, failed, unrelated and deferred evidence without blocking questions or explicit stops", () => {
  assert.equal(new WebWorkflow("What is a website?", true).active, false);
  const flow = new WebWorkflow("Make a site like mythical.systems", true);
  assert.match(flow.before("computer_files", { action: "write", path: "site/index.html" })!, /Inspect the requested rendered reference/);
  flow.observe("computer_browser", {}, JSON.stringify({ url: "https://other.example", browser_launched: true }));
  flow.observe("computer_screenshot", {}, JSON.stringify({ pixels_included: true }));
  assert.ok(flow.missing().some((item) => item.includes("mythical.systems")));
  flow.observe("computer_browser", {}, JSON.stringify({ url: "https://mythical.systems", browser_launched: false }));
  flow.observe("computer_screenshot", {}, JSON.stringify({ pixels_included: true }));
  assert.ok(flow.before("computer_files", { action: "write", path: "index.html" }));
  flow.observe("computer_browser", {}, JSON.stringify({ url: "https://mythical.systems", browser_launched: true }));
  flow.observe("computer_screenshot", {}, JSON.stringify({ pixels_included: true }));
  assert.equal(flow.before("computer_files", { action: "write", path: "index.html" }), undefined);
  flow.observe("computer_files", {}, JSON.stringify({ path: "/workspace/bots/b/site/index.html", saved: true }));
  flow.observe("computer_project", {}, JSON.stringify({ directory: "/workspace/bots/b/wrong", running: true, check: { http_status: 200 }, browser_launched: true }));
  flow.observe("computer_screenshot", { share: true }, JSON.stringify({ shared: true, pixels_included: true }));
  assert.ok(flow.missing().some((item) => item.includes("HTTP")));
  flow.observe("computer_project", {}, JSON.stringify({ directory: "/workspace/bots/b/site", running: true, check: { http_status: 500 }, browser_launched: true }));
  assert.ok(flow.missing().some((item) => item.includes("HTTP")));
  flow.observe("computer_project", {}, JSON.stringify({ directory: "/workspace/bots/b/site", running: true, check: { http_status: 200 }, browser_launched: true }));
  flow.observe("computer_screenshot", { share: true }, JSON.stringify({ shared: true, pixels_included: false }));
  assert.ok(flow.missing().length);
  flow.observe("computer_screenshot", { share: true }, JSON.stringify({ shared: true, pixels_included: true }));
  assert.deepEqual(flow.missing(), []);
  flow.observe("computer_files", {}, JSON.stringify({ path: "/workspace/bots/b/site/style.css", saved: true }));
  assert.ok(flow.missing().length, "an old screenshot cannot verify new edits");
  flow.update("How is it going?");
  assert.equal(flow.active, true);
  flow.update("Stop, cancel this");
  assert.deepEqual(flow.missing(), []);
});

test("website runner withholds premature delivery, continues to a real preview and screenshot, and bounds failed retries", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rex-web-workflow-"));
  process.env.REX_DATA_DIR = dir;
  const { db } = await import("../src/db.js");
  const { createUser } = await import("../src/auth.js");
  const owner = await createUser({ email: "workflow@example.com", name: "Workflow", password: "workflow-test-password" });
  const { createConversation, listMessages } = await import("../src/conversations.js");
  const { prepareChatTurn } = await import("../src/chatTurn.js");
  const { saveConnection } = await import("../src/providers.js");
  const { computers } = await import("../src/computer.js");
  const { DesktopComputer } = await import("../src/computer/desktop.js");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6l8AAAAASUVORK5CYII=", "base64");
  const original = computers.forOwner;
  const guest = new DesktopComputer({ label: "Workflow guest", state: async () => "running", start: async () => {}, stop: async () => {} }, async () => { throw new Error("Unexpected SSH"); }, () => { throw new Error("Unexpected tunnel"); });
  const operations: string[] = [];
  guest.workspace = async (_bot, operation, args) => {
    operations.push(operation);
    if (operation === "browser") return JSON.stringify({ url: args.url, browser_launched: true });
    if (operation === "files") return JSON.stringify({ path: "/workspace/bots/fixture/site/index.html", saved: true });
    return JSON.stringify({ directory: "/workspace/bots/fixture/site", running: true, check: { http_status: 200 }, browser_launched: true });
  };
  guest.image = async () => ({ filename: "screen.png", bytes: png });
  computers.forOwner = () => guest;
  let requests = 0;
  let mode = "work";
  const steps: Array<[string, object] | string> = [
    ["computer_files", { action: "write", path: "site/index.html", content: "<h1>Premature</h1>" }],
    ["computer_browser", { url: "https://mythical.systems" }],
    ["computer_screenshot", {}],
    ["computer_files", { action: "write", path: "site/index.html", content: "<h1>Reference-based fixture</h1>" }],
    "Site ready! Run it locally with python3 -m http.server 8000",
    ["computer_project", { action: "start", directory: "site" }],
    ["computer_screenshot", { share: true }],
    "Preview running on my guest screen; screenshot shared.",
  ];
  const model = createServer(async (req, res) => {
    let raw = ""; for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    if (!body.stream) { res.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    const step = mode === "work" ? steps[requests++] : mode === "fail" ? (requests++, "Site ready! Open localhost:8000") : (requests++, "A website is a collection of web pages.");
    const delta = typeof step === "string" ? { content: step } : { ...(requests === 2 ? { content: "Site ready! Run it locally" } : {}), tool_calls: [{ index: 0, id: `call_${requests}`, function: { name: step[0], arguments: JSON.stringify(step[1]) } }] };
    res.setHeader("Content-Type", "text/event-stream");
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  try {
    await saveConnection(owner.id, "admin", { provider: "custom", label: "Workflow fixture", baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}`, defaultModel: "fixture", vision: true });
    const bot = createConversation("Workflow", DEFAULT_BOT, owner.id);
    const run = async (message: string) => {
      const turn = await prepareChatTurn({ userId: owner.id, conversationId: bot.id, message, settings: DEFAULT_SETTINGS });
      assert.ok(turn.ok);
      const events: SseEvent[] = [];
      await turn.run((event) => events.push(event));
      assert.ok(!events.some((event) => event.type === "error"));
      return events;
    };
    const events = await run("Make me a site like mythical.systems");
    assert.equal(requests, 8);
    assert.deepEqual(operations, ["browser", "files", "project"], "the premature write must not execute");
    assert.ok(!events.some((event) => event.type === "delta" && /Site ready|Run it locally/.test(event.text)));
    assert.ok(!listMessages(bot.id).some((item) => item.role === "assistant" && /Run it locally/.test(item.content)));
    assert.equal(listMessages(bot.id).at(-1)!.content, "Preview running on my guest screen; screenshot shared.");
    assert.ok(listMessages(bot.id).some((item) => item.attachments?.length));
    mode = "fail"; requests = 0;
    await run("Build another website");
    assert.equal(requests, 3, "noncompliant output has a bounded retry budget");
    assert.match(listMessages(bot.id).at(-1)!.content, /verification is incomplete/);
    assert.doesNotMatch(listMessages(bot.id).at(-1)!.content, /Site ready!/);
    mode = "question"; requests = 0;
    await run("What is a website?");
    assert.equal(requests, 1, "informational questions must not trigger website implementation");
  } finally {
    computers.forOwner = original;
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
