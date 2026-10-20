import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT } from "@rex/shared";
import { asUser, TEST_USER } from "./helpers.js";

// Set before anything imports db.ts, so neither test touches the default data directory.
const directory = mkdtempSync(path.join(tmpdir(), "rex-routines-test-"));
process.env.REX_DATA_DIR = directory;
process.env.REX_SKIP_ENV_FILE = "1";

test("routine schedules follow the user's wall clock, including DST changes", async () => {
  const { nextRun, validateSchedule } = await import("../src/routines.js");
  const at = (iso: string) => Date.parse(iso);
  const daily = { kind: "daily" as const, time: "08:00" };
  // Bucharest is UTC+3 in summer, UTC+2 after 2026-10-25 04:00 local.
  assert.equal(new Date(nextRun(daily, "Europe/Bucharest", at("2026-10-20T04:00:00Z"))).toISOString(), "2026-10-20T05:00:00.000Z");
  assert.equal(new Date(nextRun(daily, "Europe/Bucharest", at("2026-10-20T05:00:00Z"))).toISOString(), "2026-10-21T05:00:00.000Z");
  assert.equal(new Date(nextRun(daily, "Europe/Bucharest", at("2026-10-24T06:00:00Z"))).toISOString(), "2026-10-25T06:00:00.000Z");
  // Fridays only (5), from Tuesday.
  assert.equal(new Date(nextRun({ kind: "daily", time: "18:30", days: [5] }, "UTC", at("2026-10-20T12:00:00Z"))).toISOString(), "2026-10-23T18:30:00.000Z");
  assert.equal(nextRun({ kind: "interval", hours: 6 }, "UTC", 1000), 1000 + 6 * 3_600_000);
  assert.throws(() => validateSchedule({ kind: "daily", time: "25:00" }), /time/);
  assert.throws(() => validateSchedule({ kind: "interval", hours: 0 }), /1 to 168/);
  assert.deepEqual(validateSchedule({ kind: "daily", time: "07:15", days: [0, 1, 2, 3, 4, 5, 6] }), { kind: "daily", time: "07:15" });
});

test("routines post their prompt to the bot on schedule and stay private to their owner", async () => {
  const seen: Array<{ system: string; last: string; tools: string[] }> = [];
  const model = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    response.setHeader("Content-Type", body.stream ? "text/event-stream" : "application/json");
    if (!body.stream) { response.end(JSON.stringify({ choices: [{ message: { content: "[]" } }] })); return; }
    seen.push({ system: body.messages[0].content, last: body.messages.at(-1).content, tools: (body.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name) });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "Brief: all quiet." } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  const { db } = await import("../src/db.js");
  const { createConversation, listMessages } = await import("../src/conversations.js");
  const { saveConnection } = await import("../src/providers.js");
  const { routineRoutes } = await import("../src/routes/routines.js");
  const { runDueRoutines, routineTool, getRoutine } = await import("../src/routines.js");
  const insertUser = db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', ?, '2026-10-20')");
  insertUser.run(TEST_USER.id, TEST_USER.email, TEST_USER.name, "admin");
  insertUser.run("other", "other@example.com", "Other", "user");
  const other = { ...TEST_USER, id: "other", email: "other@example.com", role: "user" as const };
  await saveConnection(TEST_USER.id, "admin", { provider: "custom", label: "Fixture", baseUrl: `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`, defaultModel: "fixture" });
  const bot = createConversation("Nova", { ...DEFAULT_BOT, name: "Nova" }, TEST_USER.id);
  const send = (method: string, url: string, body?: unknown, user = TEST_USER) => asUser(routineRoutes, user).request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await send("POST", "/routines", { conversationId: bot.id, title: "Brief", prompt: "Summarise the news", schedule: { kind: "daily", time: "08:00" }, timeZone: "Mars/Olympus" })).status, 400);
    assert.equal((await send("POST", "/routines", { conversationId: bot.id, title: "Brief", prompt: "x", schedule: { kind: "daily", time: "08:00" }, timeZone: "UTC" }, other)).status, 400);
    const created = await send("POST", "/routines", { conversationId: bot.id, title: "Brief", prompt: "Summarise the news", schedule: { kind: "daily", time: "08:00" }, timeZone: "Europe/Bucharest" });
    assert.equal(created.status, 201);
    const { routine } = await created.json() as { routine: { id: string; nextRunAt: string } };
    assert.ok(Date.parse(routine.nextRunAt) > Date.now());
    assert.equal((await send("GET", "/routines", undefined, other).then((r) => r.json()) as { routines: unknown[] }).routines.length, 0);
    assert.equal((await send("DELETE", `/routines/${routine.id}`, undefined, other)).status, 404);

    assert.equal(await runDueRoutines(Date.now()), 0);
    assert.equal(await runDueRoutines(Date.parse(routine.nextRunAt) + 1000), 1);
    const messages = listMessages(bot.id);
    assert.equal(messages.at(-2)?.content, 'Routine "Brief": Summarise the news');
    assert.equal(messages.at(-1)?.content, "Brief: all quiet.");
    assert.match(seen[0]!.system, /scheduled routine "Brief"/);
    assert.ok(!seen[0]!.tools.includes("routine"), "a routine run can't schedule more routines");
    const after = getRoutine(TEST_USER.id, routine.id)!;
    assert.equal(after.lastStatus, "ok");
    assert.ok(Date.parse(after.nextRunAt!) > Date.parse(routine.nextRunAt));

    const viaTool = JSON.parse(routineTool(TEST_USER.id, bot.id, "UTC", { action: "create", title: "Check", prompt: "Check the build", every_hours: 6 }));
    assert.equal(viaTool.created.schedule, "every 6 hours");
    const duplicate = JSON.parse(routineTool(TEST_USER.id, bot.id, "UTC", { action: "create", title: "Check", prompt: "Check the build", every_hours: 6 }));
    assert.equal(duplicate.existing.routine_id, viaTool.created.routine_id);
    assert.match(routineTool(TEST_USER.id, "someone-elses-chat", "UTC", { action: "list" }), /^\[\]$/);
    assert.match(routineTool(TEST_USER.id, "another-chat", "UTC", { action: "delete", routine_id: viaTool.created.routine_id }), /no routine/);
    assert.equal(JSON.parse(routineTool(TEST_USER.id, bot.id, "UTC", { action: "pause", routine_id: viaTool.created.routine_id })).updated.enabled, false);
    assert.equal((await send("PATCH", `/routines/${routine.id}`, { enabled: false })).status, 200);
    assert.equal(getRoutine(TEST_USER.id, routine.id)!.nextRunAt, null);
  } finally {
    model.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
