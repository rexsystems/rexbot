import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSystemPrompt, toOpenAiTools } from "@rex/shared";
import { asUser, TEST_USER } from "./helpers.js";

const directory = mkdtempSync(path.join(tmpdir(), "rex-skills-test-"));
process.env.REX_DATA_DIR = directory;
process.env.REX_SKIP_ENV_FILE = "1";

test("skills are per user, named uniquely, and load on demand", async () => {
  const { db } = await import("../src/db.js");
  const { skillRoutes } = await import("../src/routes/skills.js");
  const { loadSkillTool, skillSummaries } = await import("../src/skills.js");
  const insertUser = db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', ?, '2026-10-20')");
  insertUser.run(TEST_USER.id, TEST_USER.email, TEST_USER.name, "admin");
  insertUser.run("other", "other@example.com", "Other", "user");
  const other = { ...TEST_USER, id: "other", email: "other@example.com", role: "user" as const };
  const call = (method: string, url: string, body?: unknown, user = TEST_USER) => asUser(skillRoutes, user).request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const skill = { name: "Release notes", description: "When asked to write release notes from commits", instructions: "Group by feature, fix, chore. Plain sentences, no emoji." };
    assert.equal((await call("POST", "/skills", { ...skill, instructions: "" })).status, 400);
    const created = await call("POST", "/skills", skill);
    assert.equal(created.status, 201);
    const { skill: saved } = await created.json() as { skill: { id: string } };
    assert.equal((await call("POST", "/skills", { ...skill, name: "release NOTES" })).status, 400);
    assert.equal((await call("PATCH", `/skills/${saved.id}`, { description: "x" }, other)).status, 404);
    assert.equal(((await (await call("GET", "/skills", undefined, other)).json()) as { skills: unknown[] }).skills.length, 0);

    const summaries = skillSummaries(TEST_USER.id);
    assert.deepEqual(summaries, [{ name: "Release notes", description: skill.description }]);
    const prompt = buildSystemPrompt("", undefined, { skills: summaries });
    assert.match(prompt, /## Skills[\s\S]*"Release notes": When asked to write release notes/);
    assert.ok(!prompt.includes("Group by feature"), "instructions load on demand, not in every prompt");
    assert.ok(toOpenAiTools({ skills: true }).some((tool) => tool.function.name === "load_skill"));
    assert.match(loadSkillTool(TEST_USER.id, "release notes"), /Group by feature/);
    assert.match(loadSkillTool("other", "Release notes"), /no skill named/);
    assert.equal((await call("DELETE", `/skills/${saved.id}`)).status, 200);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
