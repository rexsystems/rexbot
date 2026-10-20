import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { webApp } from "../src/webApp.js";

test("website routes serve the SPA while API requests remain JSON and traversal stays outside", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rex-web-test-"));
  fs.writeFileSync(path.join(root, "index.html"), "<h1>Rex website</h1>");
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log('fixture')");
  const app = new Hono();
  app.use("*", webApp(root));
  app.get("/admin/users", (c) => c.json({ users: [] }));
  try {
    const html = await app.request("/admin/users", { headers: { Accept: "text/html" } });
    assert.match(await html.text(), /Rex website/);
    assert.match(html.headers.get("Content-Security-Policy")!, /frame-ancestors 'self'/);
    assert.deepEqual(await (await app.request("/admin/users", { headers: { Accept: "application/json" } })).json(), { users: [] });
    assert.match((await app.request("/assets/app.js")).headers.get("Content-Type")!, /javascript/);
    assert.equal((await app.request("/assets/%2e%2e%2f%2e%2e%2fetc/passwd")).status, 404);
    assert.equal((await app.request("/login", { headers: { Accept: "text/html" } })).status, 200);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
