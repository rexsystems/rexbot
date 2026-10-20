import "./env.js";
import { Hono } from "hono";
import { requireUser, type AppEnv } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { providerRoutes } from "./routes/providers.js";
import { routineRoutes } from "./routes/routines.js";
import { skillRoutes } from "./routes/skills.js";
import { cors } from "hono/cors";
import "./db.js";
import {
  deleteConversation,
  getOwnedConversation,
  listConversations,
  listMessages,
} from "./conversations.js";
import { deleteMemory, listMemories } from "./memory/store.js";
import { chatRoutes } from "./routes/chat.js";
import { uploadRoutes } from "./routes/uploads.js";
import { computerRoutes, computerViewRoutes } from "./routes/computer.js";
import { db } from "./db.js";
import { isReaction, setReaction } from "./reactions.js";
import { botRoutes } from "./routes/bots.js";
import { groupRoutes } from "./routes/groups.js";
import { activeChats } from "./groups.js";
import { voiceRoutes } from "./routes/voice.js";

export const app = new Hono<AppEnv>();
const port = Number(process.env.PORT || 8787);
// The API's own origins load the noVNC page shown inside the computer panel.
export const allowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "http://tauri.localhost", `http://localhost:${port}`, `http://127.0.0.1:${port}`, ...(process.env.REX_WEB_ORIGIN ? [process.env.REX_WEB_ORIGIN] : [])];

app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && !allowedOrigins.includes(origin)) return c.json({ error: "Origin not allowed" }, 403);
  if (["POST", "PUT", "PATCH"].includes(c.req.method) && !c.req.header("Content-Type")?.startsWith("application/json") && !c.req.path.startsWith("/uploads")) {
    return c.json({ error: "application/json required" }, 415);
  }
  await next();
});

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true, name: "rex-api" }));
app.route("/", authRoutes);
app.route("/", computerViewRoutes);

// Everything below needs a signed-in account.
const PUBLIC_PATHS = [/^\/health$/, /^\/auth\//, /^\/computer\/vnc\//];
app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS" || PUBLIC_PATHS.some((pattern) => pattern.test(c.req.path))) return next();
  return requireUser(c, next);
});

app.get("/conversations", (c) => c.json(listConversations(c.get("user").id)));

app.get("/conversations/:id", (c) => {
  const conv = getOwnedConversation(c.req.param("id"), c.get("user").id);
  if (!conv) return c.json({ error: "Not found" }, 404);
  return c.json({
    conversation: conv,
    messages: listMessages(conv.id),
    busy: activeChats.has(conv.id),
  });
});

app.delete("/conversations/:id", (c) => {
  if (!getOwnedConversation(c.req.param("id"), c.get("user").id)) return c.json({ error: "Not found" }, 404);
  if (activeChats.size) return c.json({ error: "Wait for active bot work to finish before deleting a conversation." }, 409);
  deleteConversation(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/memories", (c) => c.json(listMemories(c.get("user").id)));

app.delete("/memories/:id", (c) => {
  deleteMemory(c.req.param("id"), c.get("user").id);
  return c.json({ ok: true });
});

app.route("/", chatRoutes);
app.route("/", uploadRoutes);
app.route("/", computerRoutes);
app.route("/", botRoutes);
app.route("/", groupRoutes);
app.route("/", voiceRoutes);
app.route("/", adminRoutes);
app.route("/", providerRoutes);
app.route("/", routineRoutes);
app.route("/", skillRoutes);

app.post("/messages/:id/reactions", async (c) => {
  const id = c.req.param("id");
  let body: { emoji?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || !isReaction(body.emoji)) return c.json({ error: "Invalid reaction" }, 400);
  if (!db.prepare("SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND m.role = 'assistant' AND c.user_id = ?").get(id, c.get("user").id)) return c.json({ error: "Message not found" }, 404);
  return c.json({ reactions: setReaction(id, "user", body.emoji, true) });
});

