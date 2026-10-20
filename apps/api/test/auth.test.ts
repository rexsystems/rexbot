import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT } from "@rex/shared";

test("first account is admin, sign-up follows the admin setting, and accounts never see each other's data", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-auth-test-"));
  process.env.REX_DATA_DIR = directory;
  process.env.REX_SKIP_ENV_FILE = "1";
  process.env.REX_COMPUTER_BACKEND = "podman";
  const { db } = await import("../src/db.js");
  // A conversation from before accounts existed belongs to whoever sets the workspace up.
  db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('legacy', 'Before accounts', '2026-10-01', '2026-10-01')").run();
  const { app } = await import("../src/app.js");
  const { updateAppSettings } = await import("../src/appSettings.js");
  const call = async (url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (init.cookie) headers.Cookie = init.cookie;
    const response = await app.request(url, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
    const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
    return { status: response.status, json: await response.json() as Record<string, any>, cookie };
  };
  try {
    assert.equal((await call("/conversations")).status, 401);
    assert.equal((await app.request("/auth/state", { headers: { Origin: "null" } })).status, 403, "guest sandbox scripts cannot call account APIs");
    let state = await call("/auth/state");
    assert.equal(state.json.needsSetup, true);
    assert.equal(state.json.signupOpen, true);

    assert.equal((await call("/auth/signup", { body: { email: "bad", name: "A", password: "longenough" } })).status, 400);
    assert.equal((await call("/auth/signup", { body: { email: "a@example.com", name: "A", password: "short" } })).status, 400);
    const admin = await call("/auth/signup", { body: { email: "Alex@Example.com", name: "Alex", password: "correct horse" } });
    assert.equal(admin.status, 201);
    assert.equal(admin.json.user.role, "admin");
    assert.equal(admin.json.token, undefined, "session credentials stay in the HttpOnly cookie");
    assert.equal(admin.json.user.email, "alex@example.com");
    assert.match(admin.cookie ?? "", /^rex_session=/);
    const adminConversations = await call("/conversations", { cookie: admin.cookie });
    assert.deepEqual(adminConversations.json.map((item: { id: string }) => item.id), ["legacy"]);

    // Default is closed: nobody else can sign up until an admin opens it.
    state = await call("/auth/state");
    assert.equal(state.json.needsSetup, false);
    assert.equal(state.json.signupOpen, false);
    assert.equal((await call("/auth/signup", { body: { email: "b@example.com", name: "B", password: "password b" } })).status, 403);
    updateAppSettings({ signupMode: "open" });
    const user = await call("/auth/signup", { body: { email: "b@example.com", name: "B", password: "password b" } });
    assert.equal(user.status, 201);
    assert.equal(user.json.user.role, "user");
    assert.equal((await call("/auth/signup", { body: { email: "B@example.com", name: "B2", password: "password b" } })).status, 409);

    const bot = await call("/bots", { cookie: user.cookie, body: { ...DEFAULT_BOT, name: "Bee" } });
    assert.equal(bot.status, 201);
    assert.equal((await call(`/conversations/${bot.json.id}`, { cookie: admin.cookie })).status, 404, "admins use the admin panel, not other people's chats");
    assert.equal((await call(`/conversations/${bot.json.id}`, { method: "DELETE", cookie: admin.cookie })).status, 404);
    assert.equal((await call(`/bots/${bot.json.id}`, { cookie: admin.cookie, body: { ...DEFAULT_BOT, name: "Hijack" } })).status, 404);
    assert.equal((await call("/conversations/legacy", { cookie: user.cookie })).status, 404);
    assert.deepEqual((await call("/conversations", { cookie: user.cookie })).json.map((item: { id: string }) => item.id), [bot.json.id]);

    assert.equal((await call("/auth/login", { body: { email: "b@example.com", password: "wrong password" } })).status, 401);
    const login = await call("/auth/login", { body: { email: "B@EXAMPLE.com", password: "password b" } });
    assert.equal(login.status, 200);
    assert.equal((await call("/auth/state", { cookie: login.cookie })).json.user.email, "b@example.com");
    await call("/auth/logout", { method: "POST", body: {}, cookie: login.cookie });
    assert.equal((await call("/conversations", { cookie: login.cookie })).status, 401);
    assert.equal((await call("/conversations", { cookie: user.cookie })).status, 200, "other sessions stay signed in");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
