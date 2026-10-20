import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT, DEFAULT_SETTINGS, type SseEvent } from "@rex/shared";

test("provider keys stay encrypted on the server, models are listed live, and Claude answers through the native API", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-providers-test-"));
  process.env.REX_DATA_DIR = directory;
  process.env.REX_SKIP_ENV_FILE = "1";
  process.env.REX_COMPUTER_BACKEND = "podman";
  delete process.env.REX_SECRET_KEY;
  const { db } = await import("../src/db.js");
  const { app } = await import("../src/app.js");
  const { updateAppSettings } = await import("../src/appSettings.js");

  const seen: any[] = [];
  const anthropic = createServer(async (request, response) => {
    if (request.headers["x-api-key"] !== "sk-ant-test-secret") { response.writeHead(401).end("{}"); return; }
    if (request.method === "GET" && request.url?.startsWith("/v1/models")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "claude-fixture-2", display_name: "Claude Fixture 2" }, { id: "claude-fixture-1", display_name: "Claude Fixture 1" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    seen.push(body);
    if (!body.stream) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ content: [{ type: "text", text: "[]" }], usage: { input_tokens: 3, output_tokens: 1 } })); return; }
    const toolTurn = !body.messages.some((message: any) => message.content.some((block: any) => block.type === "tool_result"));
    const events = toolTurn ? [
      { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me react." } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "react_message", input: {} } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"emoji":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"👍"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
      { type: "message_stop" },
    ] : [
      { type: "message_start", message: { usage: { input_tokens: 200, output_tokens: 0 } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done, reacted." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];
    response.setHeader("Content-Type", "text/event-stream");
    response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
  });
  await new Promise<void>((resolve) => anthropic.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(anthropic.address() as AddressInfo).port}/v1`;

  const call = async (url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (init.cookie) headers.Cookie = init.cookie;
    const response = await app.request(url, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, json, text, cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
  };
  try {
    const admin = await call("/auth/signup", { body: { email: "admin@example.com", name: "Admin", password: "admin password" } });
    updateAppSettings({ signupMode: "open" });
    const member = await call("/auth/signup", { body: { email: "m@example.com", name: "M", password: "member password" } });

    // Members can't aim the server at loopback; admins can (local Ollama, or this fixture).
    assert.match((await call("/providers/connections", { cookie: member.cookie, body: { provider: "anthropic", baseUrl, apiKey: "sk-ant-test-secret" } })).json.error, /private or local/);
    assert.match((await call("/providers/connections", { cookie: admin.cookie, body: { provider: "anthropic", baseUrl } })).json.error, /API key/);
    assert.match((await call("/providers/models", { cookie: admin.cookie, body: { provider: "anthropic", baseUrl, apiKey: "wrong" } })).json.error, /rejected/);
    const models = await call("/providers/models", { cookie: admin.cookie, body: { provider: "anthropic", baseUrl, apiKey: "sk-ant-test-secret" } });
    assert.deepEqual(models.json.models.map((model: { id: string }) => model.id), ["claude-fixture-1", "claude-fixture-2"]);

    const saved = await call("/providers/connections", { cookie: admin.cookie, body: { provider: "anthropic", baseUrl, apiKey: "sk-ant-test-secret", defaultModel: "claude-fixture-2" } });
    assert.equal(saved.status, 201);
    assert.equal(saved.json.connection.keyHint, "…cret");
    assert.ok(!saved.text.includes("sk-ant-test-secret"), "the key never comes back");
    assert.deepEqual(saved.json.state.active, { connectionId: saved.json.connection.id, model: "claude-fixture-2" });
    const stored = db.prepare("SELECT api_key FROM provider_connections").get() as { api_key: string };
    assert.ok(stored.api_key.startsWith("v1:") && !stored.api_key.includes("sk-ant"), "encrypted at rest");
    assert.ok(!readFileSync(path.join(directory, "rex.db")).includes("sk-ant-test-secret"));
    assert.equal((await call(`/providers/connections/${saved.json.connection.id}`, { method: "DELETE", cookie: member.cookie })).status, 404);
    assert.equal((await call("/providers", { cookie: member.cookie })).json.connections.length, 0);

    // Editing without a new key keeps the old one.
    const renamed = await call("/providers/connections", { cookie: admin.cookie, body: { id: saved.json.connection.id, label: "Work Claude" } });
    assert.equal(renamed.json.connection.label, "Work Claude");
    assert.equal(renamed.json.connection.keyHint, "…cret");

    const bot = await call("/bots", { cookie: admin.cookie, body: { ...DEFAULT_BOT, name: "Clawd" } });
    const chat = await call("/chat", { cookie: admin.cookie, body: { conversationId: bot.json.id, message: "React to this", settings: { ...DEFAULT_SETTINGS, llmApiKey: "" } } });
    const events = chat.text.split("\n\n").filter(Boolean).map((line) => JSON.parse(line.slice(6)) as SseEvent);
    assert.ok(!events.some((event) => event.type === "error"), chat.text);
    assert.ok(events.some((event) => event.type === "tool_end" && event.tool === "react_message"));
    assert.equal(events.filter((event) => event.type === "delta").map((event) => event.text).join(""), "Let me react.Done, reacted.");
    const first = seen.find((body) => body.stream)!;
    assert.equal(first.model, "claude-fixture-2");
    assert.ok(first.system.includes("Clawd"));
    assert.ok(first.tools.some((tool: { name: string; input_schema: unknown }) => tool.name === "react_message" && tool.input_schema));
    const second = seen.filter((body) => body.stream)[1]!;
    const toolResult = second.messages.at(-1).content.find((block: any) => block.type === "tool_result");
    assert.equal(toolResult.tool_use_id, "toolu_1");
    assert.deepEqual(second.messages.at(-2).content.find((block: any) => block.type === "tool_use").input, { emoji: "👍" });

    const usage = db.prepare("SELECT provider, model, prompt_tokens, completion_tokens, tool_calls FROM usage_events WHERE prompt_tokens >= 100 ORDER BY id").all();
    assert.deepEqual(usage, [
      { provider: "anthropic", model: "claude-fixture-2", prompt_tokens: 120, completion_tokens: 30, tool_calls: 1 },
      { provider: "anthropic", model: "claude-fixture-2", prompt_tokens: 200, completion_tokens: 5, tool_calls: 0 },
    ]);

    // Without any connection or browser key, a member gets a clear message instead of a request.
    assert.match((await call("/chat", { cookie: member.cookie, body: { message: "Hi", settings: { ...DEFAULT_SETTINGS, llmApiKey: "" } } })).json.error, /Connect a model provider/);
  } finally {
    anthropic.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Chat Completions history converts to Anthropic turns", async () => {
  const { toAnthropicMessages } = await import("../src/llm.js");
  const converted = toAnthropicMessages([
    { role: "system", content: "Be brief." },
    { role: "assistant", content: "Earlier answer" },
    { role: "user", content: "Search" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "web_search", arguments: "{\"query\":\"x\"}" } }] },
    { role: "tool", content: "result", tool_call_id: "c1" },
    { role: "tool", content: "second", tool_call_id: "c2" },
  ]);
  assert.equal(converted.system, "Be brief.");
  assert.deepEqual(converted.messages.map((message) => message.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.equal(converted.messages.at(-1)!.content.length, 2);
});
