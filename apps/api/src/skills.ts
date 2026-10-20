import { randomUUID } from "node:crypto";
import type { Skill } from "@rex/shared";
import { db, nowIso } from "./db.js";

export const MAX_SKILLS_PER_USER = 50;
const MAX_INSTRUCTIONS = 12_000;
const MAX_DESCRIPTION = 300;

db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, name)
  );
`);

interface Row { id: string; name: string; description: string; instructions: string; created_at: string; updated_at: string }
const toSkill = (row: Row): Skill => ({ id: row.id, name: row.name, description: row.description, instructions: row.instructions, createdAt: row.created_at, updatedAt: row.updated_at });

export function listSkills(userId: string): Skill[] {
  return (db.prepare("SELECT * FROM skills WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(userId) as Row[]).map(toSkill);
}

export function skillSummaries(userId: string) {
  return db.prepare("SELECT name, description FROM skills WHERE user_id = ? ORDER BY name COLLATE NOCASE").all(userId) as Array<{ name: string; description: string }>;
}

function clean(input: { name?: unknown; description?: unknown; instructions?: unknown }, existing?: Skill) {
  const name = String(input.name ?? existing?.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) throw new Error("Give the skill a name.");
  const description = String(input.description ?? existing?.description ?? "").trim().replace(/\s+/g, " ");
  if (!description) throw new Error("Say when a bot should use this skill.");
  if (description.length > MAX_DESCRIPTION) throw new Error(`Keep "when to use" under ${MAX_DESCRIPTION} characters.`);
  const instructions = String(input.instructions ?? existing?.instructions ?? "").trim();
  if (!instructions) throw new Error("Write the instructions.");
  if (instructions.length > MAX_INSTRUCTIONS) throw new Error(`Keep instructions under ${MAX_INSTRUCTIONS} characters.`);
  return { name, description, instructions };
}

function getSkill(userId: string, id: string) {
  const row = db.prepare("SELECT * FROM skills WHERE id = ? AND user_id = ?").get(id, userId) as Row | undefined;
  return row ? toSkill(row) : null;
}

function nameTaken(userId: string, name: string, exceptId?: string) {
  return Boolean(db.prepare("SELECT 1 FROM skills WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?").get(userId, name, exceptId ?? ""));
}

export function createSkill(userId: string, input: { name?: unknown; description?: unknown; instructions?: unknown }): Skill {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM skills WHERE user_id = ?").get(userId) as { n: number }).n;
  if (count >= MAX_SKILLS_PER_USER) throw new Error(`You can have up to ${MAX_SKILLS_PER_USER} skills.`);
  const value = clean(input);
  if (nameTaken(userId, value.name)) throw new Error("You already have a skill with that name.");
  const id = randomUUID();
  const now = nowIso();
  db.prepare("INSERT INTO skills (id, user_id, name, description, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, value.name, value.description, value.instructions, now, now);
  return getSkill(userId, id)!;
}

export function updateSkill(userId: string, id: string, input: { name?: unknown; description?: unknown; instructions?: unknown }): Skill | null {
  const existing = getSkill(userId, id);
  if (!existing) return null;
  const value = clean(input, existing);
  if (nameTaken(userId, value.name, id)) throw new Error("You already have a skill with that name.");
  db.prepare("UPDATE skills SET name = ?, description = ?, instructions = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(value.name, value.description, value.instructions, nowIso(), id, userId);
  return getSkill(userId, id);
}

export function deleteSkill(userId: string, id: string) {
  return db.prepare("DELETE FROM skills WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function loadSkillTool(userId: string | undefined, name: unknown): string {
  if (!userId) return "load_skill unavailable in this context.";
  const row = db.prepare("SELECT name, instructions FROM skills WHERE user_id = ? AND name = ? COLLATE NOCASE").get(userId, String(name ?? "").trim()) as { name: string; instructions: string } | undefined;
  if (!row) return `load_skill failed: no skill named ${JSON.stringify(name)}. Available: ${JSON.stringify(skillSummaries(userId).map((skill) => skill.name))}`;
  return `Skill ${JSON.stringify(row.name)} instructions:\n\n${row.instructions}`;
}
