import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toOpenAiTools } from "@rex/shared";

test("a user's own Cursor key starts and reads Cloud Agents and never leaves the server", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-cursor-test-"));
  process.env.REX_DATA_DIR = directory;
  process.env.REX_SKIP_ENV_FILE = "1";
  const requests: Array<{ method: string; url: string; auth?: string; body?: any }> = [];
  const cursor = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    requests.push({ method: request.method!, url: request.url!, auth: request.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
    if (request.headers.authorization !== `Basic ${Buffer.from("crsr_good:").toString("base64")}`) { response.writeHead(401).end("{}"); return; }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/me") return response.end(JSON.stringify({ apiKeyName: "Rex" }));
    if (request.method === "POST" && request.url === "/v1/agents") return response.end(JSON.stringify({ agent: { id: "bc-1", name: "Fix", status: "ACTIVE", url: "https://cursor.com/agents/bc-1", latestRunId: "run-1" }, run: { id: "run-1", status: "CREATING" } }));
    if (request.url === "/v1/agents/bc-1") return response.end(JSON.stringify({ id: "bc-1", status: "IDLE", url: "https://cursor.com/agents/bc-1", latestRunId: "run-1" }));
    if (request.url === "/v1/agents/bc-1/runs/run-1") return response.end(JSON.stringify({ id: "run-1", status: "FINISHED", result: "Fixed the bug.", git: { branches: [{ repoUrl: "github.com/a/b", branch: "cursor/fix" }] } }));
    response.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => cursor.listen(0, "127.0.0.1", resolve));
  process.env.REX_CURSOR_API_URL = `http://127.0.0.1:${(cursor.address() as AddressInfo).port}`;
  const { db } = await import("../src/db.js");
  const { connectCursor, cursorAgentTool, hasCursor, cursorStatus } = await import("../src/integrations/cursor.js");
  for (const id of ["u1", "u2"]) db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'user', '2026-10-20')").run(id, `${id}@example.com`, id);
  try {
    assert.equal(hasCursor("u1"), false);
    assert.match(await cursorAgentTool("u1", { action: "list" }), /unavailable/);
    assert.ok(!toOpenAiTools({}).some((tool) => tool.function.name === "cursor_agent"));
    await assert.rejects(connectCursor("u1", "crsr_bad"), /rejected/);
    assert.deepEqual(await connectCursor("u1", "crsr_good"), { connected: true, keyHint: "…good", keyName: "Rex" });
    assert.ok(!JSON.stringify(db.prepare("SELECT value FROM user_settings").all()).includes("crsr_good"));
    assert.equal(hasCursor("u1"), true);
    assert.equal(cursorStatus("u2").connected, false);
    assert.ok(toOpenAiTools({ cursor: true }).some((tool) => tool.function.name === "cursor_agent"));

    const started = JSON.parse(await cursorAgentTool("u1", { action: "start", prompt: "Fix the login bug", repo_url: "https://github.com/a/b", starting_ref: "main" }));
    assert.equal(started.agent_id, "bc-1");
    assert.deepEqual(requests.find((entry) => entry.url === "/v1/agents")!.body, { prompt: { text: "Fix the login bug" }, repos: [{ url: "https://github.com/a/b", startingRef: "main" }] });
    const status = JSON.parse(await cursorAgentTool("u1", { action: "status", agent_id: "bc-1" }));
    assert.equal(status.run_status, "FINISHED");
    assert.equal(status.result, "Fixed the bug.");
    assert.match(await cursorAgentTool("u1", { action: "status", agent_id: "../etc" }), /agent_id/);
    assert.match(await cursorAgentTool("u1", { action: "start", prompt: "x", repo_url: "file:///etc" }), /https/);
  } finally {
    cursor.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
