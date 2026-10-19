import { Hono } from "hono";
import { getConversation } from "../conversations.js";
import { activeChats, listExchanges, saveGroup } from "../groups.js";

export const groupRoutes = new Hono();
groupRoutes.post("/groups/:id?", async (c) => {
  let body: { title?: unknown; memberIds?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 64 || /[\r\n\0]/.test(body.title)) return c.json({ error: "Use a group name of 1-64 characters." }, 400);
  const members = body.memberIds;
  if (!Array.isArray(members) || members.length < 2 || members.length > 6 || members.some((id) => typeof id !== "string" || !getConversation(id)?.bot) || new Set(members).size !== members.length) return c.json({ error: "Choose 2-6 different bots." }, 400);
  const id = c.req.param("id");
  if (id && getConversation(id)?.kind !== "group") return c.json({ error: "Group not found" }, 404);
  if (id && activeChats.has(id)) return c.json({ error: "Wait for the group to finish before editing it." }, 409);
  return c.json(saveGroup(body.title.trim(), members, id), id ? 200 : 201);
});
groupRoutes.get("/groups/:id/exchanges", (c) => {
  if (getConversation(c.req.param("id"))?.kind !== "group") return c.json({ error: "Group not found" }, 404);
  return c.json(listExchanges(c.req.param("id")));
});
