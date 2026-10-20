import { Hono } from "hono";
import { nanoid } from "nanoid";
import { buildSystemPrompt, DEFAULT_SETTINGS, END_CALL_TOOL, toolDefinitions, type ClientSettings, type VoiceSessionConfig } from "@rex/shared";
import { computers } from "../computer.js";
import { getConversation, insertMessage, listMessages } from "../conversations.js";
import { activeChats, peers } from "../groups.js";
import { runTool } from "../tools/index.js";
import { db } from "../db.js";
import { formatMemoryBlock, listMemories } from "../memory/store.js";

interface Session {
  conversationId: string; settings: ClientSettings; expires: number;
  tools: Set<string>; remaining: number; budget: { remaining: number }; turns: Set<string>;
  timer: ReturnType<typeof setTimeout>;
  pendingTools: Array<{ name: string; output: string }>;
  closing: boolean;
  activeTools: number;
}
const sessions = new Map<string, Session>();
function flushTools(session: Session) {
  const bot = getConversation(session.conversationId);
  if (bot) for (const tool of session.pendingTools) insertMessage({ conversationId: bot.id, role: "tool", toolName: tool.name, content: tool.output, botId: bot.id, botName: bot.bot?.name });
  session.pendingTools = [];
}
function closeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  clearTimeout(session.timer);
  session.closing = true;
  if (session.activeTools > 0) return;
  flushTools(session);
  activeChats.delete(session.conversationId);
  sessions.delete(id);
}
function sessionFor(id: string) {
  const session = sessions.get(id);
  if (!session || session.closing || session.expires < Date.now()) { closeSession(id); return undefined; }
  return session;
}

export const voiceRoutes = new Hono();
voiceRoutes.post("/voice", async (c) => {
  let body: { conversationId?: string; settings?: Partial<ClientSettings> };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const bot = typeof body?.conversationId === "string" ? getConversation(body.conversationId) : null;
  if (!bot?.bot || bot.kind) return c.json({ error: "Choose an individual bot for live voice." }, 400);
  const settings = { ...DEFAULT_SETTINGS, ...body.settings };
  const key = typeof settings.googleApiKey === "string" ? settings.googleApiKey.trim() : "";
  if (!key) return c.json({ error: "Add your Google AI Studio API key in Settings." }, 400);
  const model = typeof settings.liveModel === "string" ? settings.liveModel.trim() : "gemini-3.8-live";
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) return c.json({ error: "Use a valid Live model id." }, 400);
  if (activeChats.has(bot.id)) return c.json({ error: "This bot is already working." }, 409);
  activeChats.add(bot.id);
  const roster = peers(bot.id);
  const definitions = [
    ...toolDefinitions({ desktop: computers.desktop }).filter((tool) => tool.name !== "react_message" && (tool.name !== "message_bot" || roster.length)),
    END_CALL_TOOL,
  ];
  const history = listMessages(bot.id).filter((message) => ["user", "assistant"].includes(message.role) && (message.content.trim() || message.attachments?.length)).slice(-20).map((message) => ({ role: message.role === "user" ? "user" as const : "model" as const, parts: [{ text: `${message.content.slice(0, 4000)}${message.attachments?.length ? `\nFiles: ${message.attachments.map((file) => `${file.filename} (${file.mimeType}, upload id ${file.id})`).join(", ")}. Use read_upload for text. Image pixels are not provided in this voice session.` : ""}` }] }));
  const setup = {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: bot.bot.voice || "Kore" },
        },
      },
    },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    ...(history.length ? { historyConfig: { initialHistoryInClientContent: true } } : {}),
    systemInstruction: { parts: [{ text: `${buildSystemPrompt(formatMemoryBlock(listMemories().slice(0, 8)), bot.bot, { desktop: computers.desktop })}\nThis is a live voice conversation. Speak naturally and concisely. Only use the tools actually provided in this session. Available teammates: ${JSON.stringify(roster)}. If the user asks to hang up, end the call, stop the call, or clearly says goodbye to close it, or you decide the call should end, say a brief goodbye if natural and then call end_call so the client disconnects. Do not claim a tool action succeeded until its result is returned.` }] },
    tools: [{ functionDeclarations: definitions.map(({ name, description, parameters }) => ({ name, description, parameters })) }],
  };
  try {
    const expires = Date.now() + 10 * 60_000;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ uses: 1, expireTime: new Date(expires).toISOString(), newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(), bidiGenerateContentSetup: setup }),
      signal: AbortSignal.any([AbortSignal.timeout(20_000), c.req.raw.signal]),
    });
    if (!response.ok) throw new Error(`Google AI Studio could not start voice (${response.status}). Check your key, model access, and quota.`);
    const token = await response.json() as { name?: string };
    c.req.raw.signal.throwIfAborted();
    if (!token.name) throw new Error("Google returned no Live session token.");
    const id = nanoid();
    const timer = setTimeout(() => closeSession(id), 10 * 60_000);
    timer.unref();
    sessions.set(id, { conversationId: bot.id, settings, expires, tools: new Set(definitions.map((tool) => tool.name)), remaining: 24, budget: { remaining: 6 }, turns: new Set(), timer, pendingTools: [], closing: false, activeTools: 0 });
    const config: VoiceSessionConfig = { id, url: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`, setup, history };
    return c.json(config);
  } catch (error) {
    activeChats.delete(bot.id);
    return c.json({ error: error instanceof Error ? error.message : "Could not start voice." }, 502);
  }
});

voiceRoutes.post("/voice/:id/tool", async (c) => {
  const session = sessionFor(c.req.param("id"));
  if (!session) return c.json({ error: "Voice session ended. Start a new call." }, 410);
  let body: { name?: string; args?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || !session.tools.has(body.name ?? "") || session.remaining <= 0) return c.json({ error: "Tool unavailable or voice tool limit reached." }, 400);
  if (body.name === "end_call") {
    const reason = body.args && typeof body.args === "object" && typeof (body.args as { reason?: unknown }).reason === "string"
      ? (body.args as { reason: string }).reason.trim().slice(0, 200)
      : "";
    const output = reason ? `Ending the call: ${reason}` : "Ending the call.";
    return c.json({ output, endCall: true });
  }
  session.remaining--;
  session.activeTools++;
  try {
    let output: string;
    try { output = await runTool(body.name!, JSON.stringify(body.args ?? {}), session.settings, { userMessageId: "", botId: session.conversationId, budget: session.budget }); }
    catch (error) { output = `Tool failed: ${error instanceof Error ? error.message : String(error)}`; }
    session.pendingTools.push({ name: body.name!, output });
    return c.json({ output });
  } finally { session.activeTools--; if (session.closing) closeSession(c.req.param("id")); }
});

voiceRoutes.post("/voice/:id/turn", async (c) => {
  const session = sessionFor(c.req.param("id"));
  if (!session) return c.json({ error: "Voice session ended." }, 410);
  let body: { id?: string; user?: string; assistant?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body.id !== "string" || body.id.length > 100 || typeof body.user !== "string" || typeof body.assistant !== "string" || body.user.length > 20_000 || body.assistant.length > 20_000) return c.json({ error: "Invalid voice transcript." }, 400);
  if (session.turns.has(body.id)) return c.json({ ok: true });
  const bot = getConversation(session.conversationId)!;
  db.transaction(() => {
    if (body.user!.trim()) insertMessage({ conversationId: bot.id, role: "user", content: body.user!.trim() });
    flushTools(session);
    if (body.assistant!.trim()) insertMessage({ conversationId: bot.id, role: "assistant", content: body.assistant!.trim(), botId: bot.id, botName: bot.bot?.name });
  })();
  session.turns.add(body.id);
  return c.json({ ok: true });
});
voiceRoutes.delete("/voice/:id", (c) => { closeSession(c.req.param("id")); return c.json({ ok: true }); });
