import { Hono } from "hono";
import { BOT_MOTIONS, BOT_SHAPES, BOT_VOICES, DEFAULT_BOT, type BotProfile } from "@rex/shared";
import { getAppSettings } from "../appSettings.js";
import type { AppEnv } from "../auth.js";
import { countBots, createConversation, getOwnedConversation, updateBot } from "../conversations.js";

function parseProfile(value: unknown): BotProfile | null {
  if (!value || typeof value !== "object") return null;
  const bot = value as BotProfile;
  if (typeof bot.name !== "string" || !bot.name.trim() || bot.name.trim().length > 32 || /[\r\n\0]/.test(bot.name)) return null;
  if (typeof bot.color !== "string" || !/^#[a-f\d]{6}$/i.test(bot.color)) return null;
  if (!BOT_SHAPES.includes(bot.shape) || !BOT_MOTIONS.includes(bot.motion) || typeof bot.blink !== "boolean") return null;
  if (bot.voice !== undefined && !BOT_VOICES.includes(bot.voice)) return null;
  if (typeof bot.instructions !== "string" || bot.instructions.length > 1000) return null;
  return {
    name: bot.name.trim(),
    color: bot.color.toLowerCase(),
    shape: bot.shape,
    motion: bot.motion,
    blink: bot.blink,
    voice: bot.voice ?? DEFAULT_BOT.voice,
    instructions: bot.instructions.trim(),
  };
}

export const botRoutes = new Hono<AppEnv>();
botRoutes.post("/bots/:id?", async (c) => {
  let value: unknown;
  try { value = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const profile = parseProfile(value);
  if (!profile) return c.json({ error: "Provide a name (1-32 characters), hex color, valid shape and motion, blink preference, and instructions up to 1000 characters." }, 400);
  const id = c.req.param("id");
  const userId = c.get("user").id;
  if (id && !getOwnedConversation(id, userId)) return c.json({ error: "Bot not found" }, 404);
  const limit = getAppSettings().maxBotsPerUser;
  if (!id && countBots(userId) >= limit) return c.json({ error: `You have reached the limit of ${limit} bots. Delete one or ask an admin to raise the limit.` }, 409);
  const bot = id ? updateBot(id, profile) : createConversation(profile.name, profile, userId);
  if (!bot) return c.json({ error: "Bot not found" }, 404);
  return c.json(bot, id ? 200 : 201);
});
