import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./db.js";
import {
  deleteConversation,
  getConversation,
  listConversations,
  listMessages,
} from "./conversations.js";
import { deleteMemory, listMemories } from "./memory/store.js";
import { chatRoutes } from "./routes/chat.js";
import { uploadRoutes } from "./routes/uploads.js";
import { computerRoutes } from "./routes/computer.js";
import { db } from "./db.js";
import { isReaction, setReaction } from "./reactions.js";
import { botRoutes } from "./routes/bots.js";

const app = new Hono();
const allowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "http://tauri.localhost", ...(process.env.REX_WEB_ORIGIN ? [process.env.REX_WEB_ORIGIN] : [])];

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && !allowedOrigins.includes(origin)) return c.json({ error: "Origin not allowed" }, 403);
  if (c.req.method === "POST" && !c.req.header("Content-Type")?.startsWith("application/json") && !c.req.path.startsWith("/uploads")) {
    return c.json({ error: "application/json required" }, 415);
  }
  await next();
});

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, name: "rex-api" }));

app.get("/conversations", (c) => c.json(listConversations()));

app.get("/conversations/:id", (c) => {
  const conv = getConversation(c.req.param("id"));
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json({
    conversation: conv,
    messages: listMessages(conv.id),
  });
});

app.delete("/conversations/:id", (c) => {
  deleteConversation(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/memories", (c) => c.json(listMemories()));

app.delete("/memories/:id", (c) => {
  deleteMemory(c.req.param("id"));
  return c.json({ ok: true });
});

app.route("/", chatRoutes);
app.route("/", uploadRoutes);
app.route("/", computerRoutes);
app.route("/", botRoutes);

app.post("/messages/:id/reactions", async (c) => {
  const id = c.req.param("id");
  let body: { emoji?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || !isReaction(body.emoji)) return c.json({ error: "Invalid reaction" }, 400);
  if (!db.prepare("SELECT id FROM messages WHERE id = ? AND role = 'assistant'").get(id)) return c.json({ error: "Message not found" }, 404);
  return c.json({ reactions: setReaction(id, "user", body.emoji, true) });
});

const port = Number(process.env.PORT || 8787);
console.log(`Rex API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
