import fs from "node:fs";
import { Hono } from "hono";
import type { AdminComputer, AdminOverview, AdminUsage, AdminUser, AppSettings, UserRole } from "@rex/shared";
import { getAppSettings, updateAppSettings } from "../appSettings.js";
import {
  createUser, deleteUserSessions, findUserByEmail, getUser, getUserRow, hashPassword, normalizeEmail,
  requireAdmin, sessionToken, toAuthUser, validName, validPassword, type AppEnv,
} from "../auth.js";
import { computers } from "../computer.js";
import { db } from "../db.js";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("/admin/*", requireAdmin);

const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
const since = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

adminRoutes.get("/admin/overview", (c) => {
  const vms = computers.list();
  const { template, build } = computers.templateInfo();
  const overview: AdminOverview = {
    users: count("SELECT COUNT(*) AS n FROM users"),
    activeUsers7d: count("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", since(7 * DAY)),
    disabledUsers: count("SELECT COUNT(*) AS n FROM users WHERE status = 'disabled'"),
    bots: count("SELECT COUNT(*) AS n FROM conversations WHERE kind = 'bot'"),
    groups: count("SELECT COUNT(*) AS n FROM conversations WHERE kind = 'group'"),
    messages: count("SELECT COUNT(*) AS n FROM messages WHERE role IN ('user', 'assistant')"),
    messages24h: count("SELECT COUNT(*) AS n FROM messages WHERE role IN ('user', 'assistant') AND created_at >= ?", since(DAY)),
    computers: { total: vms.length, running: vms.filter((vm) => vm.state === "running").length, kind: computers.kind, templateVersion: template?.version ?? null, buildRunning: build.running },
    signupMode: getAppSettings().signupMode,
  };
  return c.json(overview);
});

// ── Users ────────────────────────────────────────────────────────────────

function listAdminUsers(query: string): AdminUser[] {
  const like = `%${query.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM conversations WHERE user_id = u.id AND kind = 'bot') AS bots,
      (SELECT COUNT(*) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.user_id = u.id AND m.role IN ('user', 'assistant')) AS messages,
      (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND expires_at > ?) AS sessions
    FROM users u
    WHERE ? = '' OR lower(u.email) LIKE ? OR lower(u.name) LIKE ?
    ORDER BY u.created_at
  `).all(new Date().toISOString(), query, like, like) as Array<Parameters<typeof toAuthUser>[0] & { bots: number; messages: number; sessions: number }>;
  const states = new Map(computers.list().map((vm) => [vm.ownerId, vm.state]));
  return rows.map((row) => ({ ...toAuthUser(row), bots: row.bots, messages: row.messages, sessions: row.sessions, computerState: states.get(row.id) ?? null }));
}

function activeAdmins(excludeId?: string) {
  return count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?", excludeId ?? "");
}

adminRoutes.get("/admin/users", (c) => c.json(listAdminUsers((c.req.query("q") ?? "").trim())));

adminRoutes.post("/admin/users", async (c) => {
  const input = await c.req.json().catch(() => null) as { email?: unknown; name?: unknown; password?: unknown; role?: unknown } | null;
  const email = normalizeEmail(input?.email);
  if (!email) return c.json({ error: "Enter a valid email address." }, 400);
  if (!validName(input?.name)) return c.json({ error: "Enter a name of up to 64 characters." }, 400);
  if (!validPassword(input?.password)) return c.json({ error: "The password needs at least 8 characters." }, 400);
  if (findUserByEmail(email)) return c.json({ error: "An account with this email already exists." }, 409);
  const role: UserRole = input?.role === "admin" ? "admin" : "user";
  const user = await createUser({ email, name: String(input!.name).trim(), password: input!.password as string, role });
  return c.json(user, 201);
});

adminRoutes.patch("/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  const me = c.get("user");
  const row = getUserRow(id);
  if (!row) return c.json({ error: "User not found." }, 404);
  const input = await c.req.json().catch(() => null) as { name?: unknown; role?: unknown; status?: unknown } | null;
  if (!input) return c.json({ error: "Nothing to change." }, 400);
  const role = input.role === undefined ? row.role : input.role;
  const status = input.status === undefined ? row.status : input.status;
  if (role !== "admin" && role !== "user") return c.json({ error: "Role must be admin or user." }, 400);
  if (status !== "active" && status !== "disabled") return c.json({ error: "Status must be active or disabled." }, 400);
  if (input.name !== undefined && !validName(input.name)) return c.json({ error: "Enter a name of up to 64 characters." }, 400);
  if (id === me.id && (role !== "admin" || status !== "active")) return c.json({ error: "You can't remove your own admin access or disable yourself. Ask another admin." }, 400);
  if (row.role === "admin" && (role !== "admin" || status !== "active") && activeAdmins(id) === 0) return c.json({ error: "Keep at least one active admin." }, 400);
  const name = input.name === undefined ? row.name : String(input.name).trim();
  db.prepare("UPDATE users SET name = ?, role = ?, status = ? WHERE id = ?").run(name, role, status, id);
  if (status === "disabled") {
    deleteUserSessions(id);
    await computers.stopOwner(id).catch(() => undefined);
  }
  return c.json(getUser(id));
});

adminRoutes.post("/admin/users/:id/password", async (c) => {
  const id = c.req.param("id");
  if (!getUserRow(id)) return c.json({ error: "User not found." }, 404);
  const input = await c.req.json().catch(() => null) as { password?: unknown } | null;
  if (!validPassword(input?.password)) return c.json({ error: "The password needs at least 8 characters." }, 400);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(input!.password as string), id);
  // Everyone holding the old password loses access, except the admin's own current session.
  deleteUserSessions(id, id === c.get("user").id ? sessionToken(c) ?? undefined : undefined);
  return c.json({ ok: true });
});

adminRoutes.post("/admin/users/:id/sign-out", (c) => {
  const id = c.req.param("id");
  if (!getUserRow(id)) return c.json({ error: "User not found." }, 404);
  deleteUserSessions(id);
  return c.json({ ok: true });
});

adminRoutes.delete("/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  const row = getUserRow(id);
  if (!row) return c.json({ error: "User not found." }, 404);
  if (id === c.get("user").id) return c.json({ error: "You can't delete your own account here." }, 400);
  if (row.role === "admin" && activeAdmins(id) === 0) return c.json({ error: "Keep at least one active admin." }, 400);
  try {
    await computers.destroyOwner(id);
  } catch (error) {
    return c.json({ error: `The user's computer could not be removed: ${errorMessage(error)}` }, 500);
  }
  const files = db.prepare("SELECT path FROM uploads WHERE user_id = ?").all(id) as Array<{ path: string }>;
  db.transaction(() => {
    db.prepare("DELETE FROM conversations WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM memories WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM uploads WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM usage_events WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
  })();
  for (const file of files) fs.rmSync(file.path, { force: true });
  return c.json({ ok: true });
});

// ── Computers ────────────────────────────────────────────────────────────

adminRoutes.get("/admin/computers", (c) => {
  const owners = new Map((db.prepare("SELECT id, name, email FROM users").all() as Array<{ id: string; name: string; email: string }>).map((user) => [user.id, user]));
  const list: AdminComputer[] = computers.list().map((vm) => ({
    ownerId: vm.ownerId, ownerName: owners.get(vm.ownerId)?.name ?? null, ownerEmail: owners.get(vm.ownerId)?.email ?? null,
    name: vm.name, state: vm.state, memoryMb: vm.memoryMb, cores: vm.cores, diskGb: vm.diskGb, diskUsedBytes: vm.diskUsedBytes,
    templateVersion: vm.templateVersion, createdAt: vm.createdAt, lastStartedAt: vm.lastStartedAt,
  }));
  return c.json({ kind: computers.kind, ...computers.templateInfo(), computers: list });
});

adminRoutes.post("/admin/computers/template", async (c) => {
  const input = await c.req.json().catch(() => ({})) as { baseImageUrl?: unknown };
  const url = typeof input.baseImageUrl === "string" && input.baseImageUrl.trim() ? input.baseImageUrl.trim() : undefined;
  if (url && !/^https?:\/\//i.test(url)) return c.json({ error: "The base image URL must start with http:// or https://." }, 400);
  return c.json(computers.buildTemplate(url), 202);
});

adminRoutes.post("/admin/computers/:ownerId/:action", async (c) => {
  const ownerId = c.req.param("ownerId");
  const action = c.req.param("action");
  try {
    if (action === "start") await computers.forOwner(ownerId).start();
    else if (action === "stop") await computers.stopOwner(ownerId);
    else if (action === "kill") await computers.stopOwner(ownerId, true);
    else if (action === "reset") await computers.destroyOwner(ownerId);
    else return c.json({ error: "Unknown action." }, 404);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 500);
  }
  return c.json({ ok: true });
});

adminRoutes.patch("/admin/computers/:ownerId", async (c) => {
  const input = await c.req.json().catch(() => null) as { memoryMb?: unknown; cores?: unknown; diskGb?: unknown } | null;
  const int = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
  const spec = { memoryMb: int(input?.memoryMb, 1024, 65536), cores: int(input?.cores, 1, 32), diskGb: int(input?.diskGb, 8, 1024) };
  try {
    computers.resize(c.req.param("ownerId"), spec);
  } catch (error) {
    return c.json({ error: errorMessage(error) }, 400);
  }
  return c.json({ ok: true });
});

adminRoutes.get("/admin/computers/:ownerId/serial", (c) => c.json({ log: computers.serialLog(c.req.param("ownerId")) }));

// ── Usage ────────────────────────────────────────────────────────────────

adminRoutes.get("/admin/usage", (c) => {
  const days = Math.min(365, Math.max(1, Number.parseInt(c.req.query("days") ?? "30", 10) || 30));
  const from = since(days * DAY);
  const messages = db.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM messages WHERE role IN ('user', 'assistant') AND created_at >= ? GROUP BY day`).all(from) as Array<{ day: string; n: number }>;
  const details = `COUNT(*) AS requests, SUM(tool_calls) AS toolCalls, SUM(cache_read_tokens) AS cacheReadTokens, SUM(cache_write_tokens) AS cacheWriteTokens, SUM(reasoning_tokens) AS reasoningTokens, COUNT(cache_read_tokens) AS cacheReportedRequests`;
  const empty = { requests: 0, toolCalls: 0, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, cacheReportedRequests: 0 };
  const tokens = db.prepare(`SELECT substr(created_at, 1, 10) AS day, SUM(prompt_tokens) AS promptTokens, SUM(completion_tokens) AS completionTokens, ${details} FROM usage_events WHERE created_at >= ? GROUP BY day`).all(from) as AdminUsage["daily"];
  const daily: AdminUsage["daily"] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = new Date(Date.now() - index * DAY).toISOString().slice(0, 10);
    const tokenRow = tokens.find((row) => row.day === day);
    daily.push({ ...empty, promptTokens: 0, completionTokens: 0, ...tokenRow, day, messages: messages.find((row) => row.day === day)?.n ?? 0 });
  }
  const byUser = db.prepare(`
    SELECT u.id AS userId, u.name, u.email,
      (SELECT COUNT(*) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.user_id = u.id AND m.role IN ('user', 'assistant') AND m.created_at >= @from) AS messages,
      COALESCE((SELECT SUM(prompt_tokens) FROM usage_events WHERE user_id = u.id AND created_at >= @from), 0) AS promptTokens,
      COALESCE((SELECT SUM(completion_tokens) FROM usage_events WHERE user_id = u.id AND created_at >= @from), 0) AS completionTokens
    FROM users u ORDER BY messages DESC, u.created_at
  `).all({ from }) as AdminUsage["byUser"];
  const userDetails = db.prepare(`SELECT user_id AS userId, ${details} FROM usage_events WHERE created_at >= ? GROUP BY user_id`).all(from) as Array<AdminUsage["byUser"][number]>;
  for (const row of byUser) Object.assign(row, empty, userDetails.find((item) => item.userId === row.userId));
  const byModel = db.prepare(`
    SELECT provider, model, ${details}, SUM(prompt_tokens) AS promptTokens, SUM(completion_tokens) AS completionTokens
    FROM usage_events WHERE created_at >= ? GROUP BY provider, model ORDER BY requests DESC
  `).all(from) as AdminUsage["byModel"];
  const usage: AdminUsage = { days, daily, byUser, byModel };
  return c.json(usage);
});

// ── Settings ─────────────────────────────────────────────────────────────

adminRoutes.get("/admin/settings", (c) => c.json(getAppSettings()));

adminRoutes.patch("/admin/settings", async (c) => {
  const input = await c.req.json().catch(() => null) as Partial<AppSettings> | null;
  if (!input || typeof input !== "object") return c.json({ error: "Send the settings to change." }, 400);
  return c.json(updateAppSettings(input));
});
