import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("concurrent initial signups create exactly one account when registration is closed", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rex-signup-race-"));
  process.env.REX_DATA_DIR = directory;
  process.env.REX_SKIP_ENV_FILE = "1";
  const { app } = await import("../src/app.js");
  const { db } = await import("../src/db.js");
  try {
    const responses = await Promise.all(["one", "two"].map((name) => app.request("/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email: `${name}@example.com`, password: "test-only-password" }) })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.deepEqual(db.prepare("SELECT role FROM users").all(), [{ role: "admin" }]);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
