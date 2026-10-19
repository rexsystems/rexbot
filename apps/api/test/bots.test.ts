import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_BOT } from "@rex/shared";

test("legacy conversations survive profile migration; bot profiles validate and persist", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-bots-test-"));
  process.env.REX_DATA_DIR = directory;
  const legacy = new Database(path.join(directory, "rex.db"));
  legacy.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO conversations VALUES ('legacy', 'Previous conversation', '2026-10-19', '2026-10-19')");
  legacy.close();
  const { db } = await import("../src/db.js");
  try {
    const { botRoutes } = await import("../src/routes/bots.js");
    const { getConversation, listConversations } = await import("../src/conversations.js");
    assert.equal(getConversation("legacy")?.title, "Previous conversation");
    assert.equal(getConversation("legacy")?.bot, undefined);
    const post = (url: string, body: unknown) => botRoutes.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const profile = { ...DEFAULT_BOT, name: "Milo", shape: "cube", motion: "spin", color: "#83cba2", instructions: "Keep answers short." };
    const created = await post("/bots", profile);
    assert.equal(created.status, 201);
    const bot = await created.json() as { id: string };
    assert.deepEqual(getConversation(bot.id)?.bot, profile);
    assert.equal((await post(`/bots/${bot.id}`, { ...profile, name: "Milo Two", blink: false, voice: "Puck" })).status, 200);
    assert.equal(getConversation(bot.id)?.bot?.name, "Milo Two");
    assert.equal(getConversation(bot.id)?.bot?.blink, false);
    assert.equal(getConversation(bot.id)?.bot?.voice, "Puck");
    assert.equal(listConversations().length, 2);
    for (const invalid of [null, { ...profile, color: "not-a-color" }, { ...profile, name: "" }, { ...profile, shape: "bad" }, { ...profile, motion: "bad" }, { ...profile, voice: "NotAVoice" }, { ...profile, instructions: "a".repeat(1001) }]) {
      assert.equal((await post("/bots", invalid)).status, 400);
    }
    assert.equal((await post("/bots/missing", profile)).status, 404);
    assert.equal(getConversation("legacy")?.title, "Previous conversation");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
