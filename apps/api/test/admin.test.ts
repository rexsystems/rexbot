import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_BOT } from "@rex/shared";

test("admins manage accounts and settings; the last admin can't lock everyone out", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rex-admin-test-"));
  process.env.REX_DATA_DIR = directory;
  process.env.REX_SKIP_ENV_FILE = "1";
  process.env.REX_COMPUTER_BACKEND = "podman";
  const { db } = await import("../src/db.js");
  const { app } = await import("../src/app.js");
  const call = async (url: string, init: { method?: string; body?: unknown; cookie?: string } = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (init.cookie) headers.Cookie = init.cookie;
    const response = await app.request(url, { method: init.method ?? (init.body ? "POST" : "GET"), headers, body: init.body ? JSON.stringify(init.body) : undefined });
    return { status: response.status, json: await response.json() as any, cookie: response.headers.get("Set-Cookie")?.split(";")[0] };
  };
  try {
    const admin = await call("/auth/signup", { body: { email: "admin@example.com", name: "Admin", password: "admin password" } });
    const adminId = admin.json.user.id as string;
    const created = await call("/admin/users", { cookie: admin.cookie, body: { email: "Sam@Example.com", name: "Sam", password: "sam password" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.role, "user");
    assert.equal((await call("/admin/users", { cookie: admin.cookie, body: { email: "sam@example.com", name: "Sam", password: "sam password" } })).status, 409);
    const sam = await call("/auth/login", { body: { email: "sam@example.com", password: "sam password" } });
    assert.equal((await call("/admin/overview", { cookie: sam.cookie })).status, 403);
    assert.equal((await call("/admin/settings", { method: "PATCH", cookie: sam.cookie, body: { signupMode: "open" } })).status, 403);
    assert.equal((await call("/bots", { cookie: sam.cookie, body: { ...DEFAULT_BOT, name: "Sammy" } })).status, 201);

    const overview = await call("/admin/overview", { cookie: admin.cookie });
    assert.equal(overview.json.users, 2);
    assert.equal(overview.json.bots, 1);
    assert.equal(overview.json.signupMode, "closed");
    const users = await call("/admin/users?q=sam", { cookie: admin.cookie });
    assert.deepEqual(users.json.map((user: { email: string; bots: number }) => [user.email, user.bots]), [["sam@example.com", 1]]);

    assert.equal((await call(`/admin/users/${adminId}`, { method: "PATCH", cookie: admin.cookie, body: { role: "user" } })).status, 400);
    assert.equal((await call(`/admin/users/${adminId}`, { method: "DELETE", cookie: admin.cookie })).status, 400);

    // Disabling ends Sam's sessions at once; enabling lets Sam sign in again with a reset password.
    assert.equal((await call(`/admin/users/${created.json.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "disabled" } })).status, 200);
    assert.equal((await call("/conversations", { cookie: sam.cookie })).status, 401);
    assert.equal((await call("/auth/login", { body: { email: "sam@example.com", password: "sam password" } })).status, 403);
    await call(`/admin/users/${created.json.id}`, { method: "PATCH", cookie: admin.cookie, body: { status: "active" } });
    assert.equal((await call(`/admin/users/${created.json.id}/password`, { cookie: admin.cookie, body: { password: "short" } })).status, 400);
    assert.equal((await call(`/admin/users/${created.json.id}/password`, { cookie: admin.cookie, body: { password: "new sam password" } })).status, 200);
    assert.equal((await call("/auth/login", { body: { email: "sam@example.com", password: "sam password" } })).status, 401);
    assert.equal((await call("/auth/login", { body: { email: "sam@example.com", password: "new sam password" } })).status, 200);

    // A second admin can be demoted, but then the first one is again the last.
    await call(`/admin/users/${created.json.id}`, { method: "PATCH", cookie: admin.cookie, body: { role: "admin" } });
    assert.equal((await call(`/admin/users/${created.json.id}`, { method: "PATCH", cookie: admin.cookie, body: { role: "user" } })).status, 200);

    const settings = await call("/admin/settings", { method: "PATCH", cookie: admin.cookie, body: { signupMode: "open", vmCores: 999, workspaceName: "  Team Rex  " } });
    assert.equal(settings.json.signupMode, "open");
    assert.equal(settings.json.vmCores, 32);
    assert.equal(settings.json.workspaceName, "Team Rex");
    assert.equal((await call("/auth/state")).json.signupOpen, true);

    const usage = await call("/admin/usage?days=7", { cookie: admin.cookie });
    assert.equal(usage.json.daily.length, 7);

    assert.equal((await call(`/admin/users/${created.json.id}`, { method: "DELETE", cookie: admin.cookie })).status, 200);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as { n: number }).n, 0);
    assert.equal((await call("/admin/overview", { cookie: admin.cookie })).json.users, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
