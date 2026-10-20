import { Hono } from "hono";
import type { AuthUser } from "@rex/shared";
import type { AppEnv } from "../src/auth.js";

export const TEST_USER: AuthUser = { id: "test-user", email: "test@example.com", name: "Tester", role: "admin", status: "active", createdAt: "2026-10-20T00:00:00.000Z", lastSeenAt: null };

/** Mounts route modules behind a fake signed-in user, as index.ts does after its auth middleware. */
export function asUser(routes: Hono<AppEnv> | Hono, user: AuthUser = TEST_USER) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("user", user); await next(); });
  app.route("/", routes as Hono<AppEnv>);
  return app;
}
