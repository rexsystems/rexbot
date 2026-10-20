import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import { connectCursor, cursorStatus, disconnectCursor } from "../integrations/cursor.js";
import { deleteConnection, listModels, providerState, saveConnection, setActiveModel } from "../providers.js";

export const providerRoutes = new Hono<AppEnv>();

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

providerRoutes.get("/providers", (c) => c.json(providerState(c.get("user").id)));

providerRoutes.post("/providers/connections", async (c) => {
  const user = c.get("user");
  const input = await c.req.json().catch(() => null);
  if (!input || typeof input !== "object") return c.json({ error: "Send the connection details." }, 400);
  try {
    const connection = await saveConnection(user.id, user.role, input);
    return c.json({ connection, state: providerState(user.id) }, input.id ? 200 : 201);
  } catch (error) {
    return c.json({ error: message(error) }, 400);
  }
});

providerRoutes.delete("/providers/connections/:id", (c) => {
  const user = c.get("user");
  if (!deleteConnection(user.id, c.req.param("id"))) return c.json({ error: "Connection not found." }, 404);
  return c.json(providerState(user.id));
});

providerRoutes.post("/providers/models", async (c) => {
  const user = c.get("user");
  const input = await c.req.json().catch(() => ({}));
  try {
    return c.json({ models: await listModels(user.id, input ?? {}, user.role) });
  } catch (error) {
    return c.json({ error: message(error) }, 400);
  }
});

providerRoutes.put("/providers/active", async (c) => {
  const user = c.get("user");
  const input = await c.req.json().catch(() => undefined);
  try {
    setActiveModel(user.id, input ?? null);
    return c.json(providerState(user.id));
  } catch (error) {
    return c.json({ error: message(error) }, 400);
  }
});

providerRoutes.get("/integrations/cursor", (c) => c.json(cursorStatus(c.get("user").id)));

providerRoutes.put("/integrations/cursor", async (c) => {
  const input = await c.req.json().catch(() => null) as { apiKey?: unknown } | null;
  try {
    return c.json(await connectCursor(c.get("user").id, typeof input?.apiKey === "string" ? input.apiKey : ""));
  } catch (error) {
    return c.json({ error: message(error) }, 400);
  }
});

providerRoutes.delete("/integrations/cursor", (c) => c.json(disconnectCursor(c.get("user").id)));
