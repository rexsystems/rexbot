import { Hono } from "hono";
import type { AppEnv } from "../auth.js";
import { getOwnedConversation } from "../conversations.js";
import { activeChats, listExchanges, saveGroup } from "../groups.js";

export const groupRoutes = new Hono<AppEnv>();
groupRoutes.post("/groups/:id?", async (c) => {
  let body: { title?: unknown; memberIds?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 64 || /[\r\n\0]/.test(body.title)) return c.json({ error: "Use a group name of 1-64 characters." }, 400);
  const userId = c.get("user").id;
  const members = body.memberIds;
  if (!Array.isArray(members) || members.length < 2 || members.length > 6 || members.some((id) => typeof id !== "string" || !getOwnedConversation(id, userId)?.bot) || new Set(members).size !== members.length) return c.json({ error: "Choose 2-6 different bots." }, 400);
  const id = c.req.param("id");
  if (id && getOwnedConversation(id, userId)?.kind !== "group") return c.json({ error: "Group not found" }, 404);
  if (id && activeChats.has(id)) return c.json({ error: "Wait for the group to finish before editing it." }, 409);
  return c.json(saveGroup(body.title.trim(), members, userId, id), id ? 200 : 201);
});
groupRoutes.get("/groups/:id/exchanges", (c) => {
  if (getOwnedConversation(c.req.param("id"), c.get("user").id)?.kind !== "group") return c.json({ error: "Group not found" }, 404);
  return c.json(listExchanges(c.req.param("id")));
});
