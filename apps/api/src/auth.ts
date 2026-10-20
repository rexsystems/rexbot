import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Context, MiddlewareHandler } from "hono";
import { nanoid } from "nanoid";
import type { AuthUser, UserRole } from "@rex/shared";
import { claimLegacyData, db, nowIso } from "./db.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const SESSION_COOKIE = "rex_session";
const SESSION_DAYS = 30;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type AppEnv = { Variables: { user: AuthUser } };

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  status: "active" | "disabled";
  created_at: string;
  last_seen_at: string | null;
}

export function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 256;
}

export function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 64 && !/[\r\n\0]/.test(value);
}

export function userCount(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function findUserByEmail(email: string) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

export function getUser(id: string): AuthUser | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toAuthUser(row) : null;
}

export function getUserRow(id: string) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export async function createUser(input: { email: string; name: string; password: string; role?: UserRole }): Promise<AuthUser> {
  if (findUserByEmail(input.email)) throw new Error("An account with this email already exists.");
  const first = userCount() === 0;
  const row: UserRow = {
    id: nanoid(),
    email: input.email,
    name: input.name.trim(),
    password_hash: await hashPassword(input.password),
    role: first ? "admin" : input.role ?? "user",
    status: "active",
    created_at: nowIso(),
    last_seen_at: null,
  };
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, status, created_at, last_seen_at) VALUES (@id, @email, @name, @password_hash, @role, @status, @created_at, @last_seen_at)").run(row);
  if (first) claimLegacyData(row.id);
  return toAuthUser(row);
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(userId: string, userAgent?: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)").run(hashToken(token), userId, now.toISOString(), expiresAt.toISOString(), now.toISOString(), userAgent?.slice(0, 200) ?? null);
  db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), userId);
  return { token, expiresAt };
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
}

export function deleteUserSessions(userId: string, exceptToken?: string) {
  if (exceptToken) db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, hashToken(exceptToken));
  else db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Resolves a session token to an active user, sliding the user's last-seen time. */
export function userForToken(token: string): AuthUser | null {
  const id = hashToken(token);
  const row = db.prepare(`SELECT u.*, s.expires_at AS session_expires, s.last_seen_at AS session_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id) as (UserRow & { session_expires: string; session_seen: string }) | undefined;
  if (!row) return null;
  if (row.session_expires < nowIso() || row.status !== "active") { db.prepare("DELETE FROM sessions WHERE id = ?").run(id); return null; }
  // Write at most once a minute per session.
  if (Date.now() - Date.parse(row.session_seen) > 60_000) {
    const ts = nowIso();
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(ts, id);
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(ts, row.id);
    row.last_seen_at = ts;
  }
  return toAuthUser(row);
}

export function sessionToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  const cookie = c.req.header("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("=")) || null;
  }
  return null;
}

function secureRequest(c: Context) {
  return c.req.header("X-Forwarded-Proto") === "https" || new URL(c.req.url).protocol === "https:";
}

export function sessionCookie(c: Context, token: string, expiresAt: Date) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureRequest(c) ? "; Secure" : ""}`;
}

export function clearedCookie(c: Context) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(c) ? "; Secure" : ""}`;
}

/** Requires a signed-in, active user and exposes it as c.get("user"). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = sessionToken(c);
  const user = token ? userForToken(token) : null;
  if (!user) return c.json({ error: "Sign in to continue." }, 401);
  c.set("user", user);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") return c.json({ error: "Admins only." }, 403);
  await next();
};

/** Small in-memory limiter for sign-in attempts: 10 failures per key per 15 minutes. */
const failures = new Map<string, { count: number; reset: number }>();
export function loginAllowed(key: string) {
  const entry = failures.get(key);
  if (!entry || entry.reset < Date.now()) return true;
  return entry.count < 10;
}
export function recordLoginFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || entry.reset < Date.now()) failures.set(key, { count: 1, reset: Date.now() + 15 * 60_000 });
  else entry.count++;
}
export function clearLoginFailures(key: string) {
  failures.delete(key);
}
