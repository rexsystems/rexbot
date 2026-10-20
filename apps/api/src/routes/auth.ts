import { Hono, type Context } from "hono";
import type { AuthState } from "@rex/shared";
import { getAppSettings } from "../appSettings.js";
import {
  clearedCookie, clearLoginFailures, createSession, createUser, deleteSession, deleteUserSessions, findUserByEmail,
  getUserRow, hashPassword, loginAllowed, normalizeEmail, recordLoginFailure, requireUser, sessionCookie, sessionToken,
  toAuthUser, userCount, userForToken, validName, validPassword, verifyPassword, type AppEnv,
} from "../auth.js";
import { db } from "../db.js";

async function body(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const value = await c.req.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function clientKey(c: Context, email: string) {
  return `${c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() || "local"}:${email}`;
}

const DUMMY_HASH = `scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$${Buffer.alloc(64).toString("base64")}`;

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/auth/state", (c) => {
  const token = sessionToken(c);
  const settings = getAppSettings();
  const state: AuthState = {
    user: token ? userForToken(token) : null,
    needsSetup: userCount() === 0,
    signupOpen: userCount() === 0 || settings.signupMode === "open",
    workspaceName: settings.workspaceName,
  };
  return c.json(state);
});

authRoutes.post("/auth/signup", async (c) => {
  const input = await body(c);
  if (!input) return c.json({ error: "Invalid JSON" }, 400);
  const first = userCount() === 0;
  if (!first && getAppSettings().signupMode !== "open") return c.json({ error: "Sign-up is turned off. Ask an admin to create your account." }, 403);
  const email = normalizeEmail(input.email);
  if (!email) return c.json({ error: "Enter a valid email address." }, 400);
  if (!validName(input.name)) return c.json({ error: "Enter a name of 1-64 characters." }, 400);
  if (!validPassword(input.password)) return c.json({ error: "Use a password of at least 8 characters." }, 400);
  try {
    const user = await createUser({ email, name: input.name, password: input.password });
    const session = createSession(user.id, c.req.header("User-Agent"));
    c.header("Set-Cookie", sessionCookie(c, session.token, session.expiresAt));
    return c.json({ user, token: session.token }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
  }
});

authRoutes.post("/auth/login", async (c) => {
  const input = await body(c);
  if (!input) return c.json({ error: "Invalid JSON" }, 400);
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password) return c.json({ error: "Enter your email and password." }, 400);
  const key = clientKey(c, email);
  if (!loginAllowed(key)) return c.json({ error: "Too many failed attempts. Wait 15 minutes and try again." }, 429);
  const row = findUserByEmail(email);
  // Verify against a dummy hash when the account is unknown so timing does not reveal which emails exist.
  const ok = row ? await verifyPassword(password, row.password_hash) : (await verifyPassword(password, DUMMY_HASH), false);
  if (!row || !ok) { recordLoginFailure(key); return c.json({ error: "Email or password is incorrect." }, 401); }
  if (row.status !== "active") return c.json({ error: "This account is disabled. Ask an admin to enable it." }, 403);
  clearLoginFailures(key);
  const session = createSession(row.id, c.req.header("User-Agent"));
  c.header("Set-Cookie", sessionCookie(c, session.token, session.expiresAt));
  return c.json({ user: toAuthUser(row), token: session.token });
});

authRoutes.post("/auth/logout", (c) => {
  const token = sessionToken(c);
  if (token) deleteSession(token);
  c.header("Set-Cookie", clearedCookie(c));
  return c.json({ ok: true });
});

authRoutes.post("/auth/profile", requireUser, async (c) => {
  const input = await body(c);
  if (!input || !validName(input.name)) return c.json({ error: "Enter a name of 1-64 characters." }, 400);
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(input.name.trim(), c.get("user").id);
  return c.json({ user: toAuthUser(getUserRow(c.get("user").id)!) });
});

authRoutes.post("/auth/password", requireUser, async (c) => {
  const input = await body(c);
  if (!input || typeof input.current !== "string" || !validPassword(input.next)) return c.json({ error: "Enter your current password and a new one of at least 8 characters." }, 400);
  const row = getUserRow(c.get("user").id)!;
  if (!await verifyPassword(input.current, row.password_hash)) return c.json({ error: "Your current password is incorrect." }, 401);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(input.next), row.id);
  // Other devices must sign in again with the new password.
  deleteUserSessions(row.id, sessionToken(c) ?? undefined);
  return c.json({ ok: true });
});
