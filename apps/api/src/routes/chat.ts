import { Hono } from "hono";
import {
  buildSystemPrompt,
  DEFAULT_SETTINGS,
  toOpenAiTools,
  type ChatRequestBody,
  type ClientSettings,
  type SseEvent,
  type MessageReaction,
  MAX_MESSAGE_ATTACHMENTS,
  isPreviewImage,
} from "@rex/shared";
import {
  createConversation,
  getConversation,
  insertMessage,
  listMessages,
  titleFromMessage,
  touchConversation,
} from "../conversations.js";
import {
  extractAndStoreMemories,
  formatMemoryBlock,
  retrieveMemories,
} from "../memory/store.js";
import {
  streamChatCompletion,
  type LlmMessage,
  type LlmToolCall,
} from "../llm.js";
import { runTool } from "../tools/index.js";
import { db } from "../db.js";
import { messageUploads } from "../uploads.js";
import { activeChats, peers } from "../groups.js";

export const chatRoutes = new Hono();

function sse(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function normalizeSettings(raw: Partial<ClientSettings> | undefined): ClientSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    llmApiKey: raw?.llmApiKey?.trim() ?? "",
    llmBaseUrl: raw?.llmBaseUrl?.trim() || DEFAULT_SETTINGS.llmBaseUrl,
    llmModel: raw?.llmModel?.trim() || DEFAULT_SETTINGS.llmModel,
    searchApiKey: raw?.searchApiKey?.trim() ?? "",
    embeddingModel:
      raw?.embeddingModel?.trim() || DEFAULT_SETTINGS.embeddingModel,
  };
}

function historyToLlm(messages: ReturnType<typeof listMessages>): LlmMessage[] {
  // Prior turns: only user/assistant text. Tool rounds stay in-request only.
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content.trim().length > 0 || m.attachments?.length)
    .map((m) => ({ role: m.role as "user" | "assistant", content: `${m.botName ? `[${m.botName}]: ` : ""}${m.content}${m.attachments?.length ? `\n\n[Attached files: ${m.attachments.map((upload) => `${upload.filename} (${upload.mimeType}, upload id: ${upload.id})`).join(", ")}. Use read_upload for text documents. ${m.attachments.some((upload) => isPreviewImage(upload.mimeType)) ? "Image pixels are not available to this text-only model. Do not claim to have viewed them." : ""}]` : ""}` }));
}

chatRoutes.post("/chat", async (c) => {
  let body: ChatRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const uploadIds = body?.uploadIds ?? [];
  if (!Array.isArray(uploadIds) || uploadIds.length > MAX_MESSAGE_ATTACHMENTS || uploadIds.some((id) => typeof id !== "string") || new Set(uploadIds).size !== uploadIds.length) return c.json({ error: "Invalid attachments (max 8 files per message)" }, 400);
  if (!message && !uploadIds.length) return c.json({ error: "A message or attachment is required" }, 400);
  for (const id of uploadIds) {
    const upload = db.prepare("SELECT message_id FROM uploads WHERE id = ?").get(id) as { message_id: string | null } | undefined;
    if (!upload || upload.message_id) return c.json({ error: "An attachment is missing or already sent. Attach it again." }, 400);
  }
  const settings = normalizeSettings(body.settings);
  if (!settings.llmApiKey) {
    return c.json({ error: "LLM API key is missing. Add it in Settings." }, 400);
  }

  let conversation = body.conversationId
    ? getConversation(body.conversationId)
    : null;
  if (body.conversationId && !conversation) return c.json({ error: "Conversation not found" }, 404);
  const isNew = !conversation;
  if (!conversation) {
    conversation = createConversation(titleFromMessage(message || "Image attachments"));
  }
  if (activeChats.has(conversation.id)) return c.json({ error: "This conversation is already working. Wait for it to finish." }, 409);
  const responders = conversation.kind === "group" ? (conversation.memberIds ?? []).map(getConversation).filter((bot) => bot?.bot) : [conversation];
  if (!responders.length) return c.json({ error: "Add bots to this group before sending a message." }, 400);
  activeChats.add(conversation.id);

  const userMessage = insertMessage({
    conversationId: conversation.id,
    role: "user",
    content: message,
  });
  const attach = db.prepare("UPDATE uploads SET conversation_id = ?, message_id = ?, message_position = ? WHERE id = ?");
  const attachmentConversationId = conversation.id;
  db.transaction(() => { uploadIds.forEach((id, position) => attach.run(attachmentConversationId, userMessage.id, position, id)); })();
  userMessage.attachments = messageUploads(userMessage.id);
  if (isNew) {
    touchConversation(conversation.id, titleFromMessage(message || "Image attachments"));
    conversation = getConversation(conversation.id)!;
  }

  let memoryBlock: string;
  try { memoryBlock = formatMemoryBlock(await retrieveMemories(settings, message)); }
  catch (error) { activeChats.delete(conversation.id); throw error; }

  const encoder = new TextEncoder();
  const conv = conversation;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SseEvent) => {
        controller.enqueue(encoder.encode(sse(event)));
      };

      try {
        send({ type: "conversation", conversation: conv });
        send({ type: "user_message", message: userMessage });
        const budget = { remaining: 6 };
        for (const responder of responders) {
        if (!responder) continue;
        const speaker = responder.bot ? { botId: responder.id, botName: responder.bot.name } : {};
        if (speaker.botId && speaker.botName) send({ type: "speaker", botId: speaker.botId, botName: speaker.botName });
        const roster = peers(responder.id, conv.kind === "group" ? conv.id : undefined);
        const tools = toOpenAiTools().filter((tool) => tool.function.name !== "message_bot" || roster.length > 0);
        const groupContext = conv.kind === "group" ? `\nYou are in group ${JSON.stringify(conv.title)}. Speak only for yourself. Other members' prior replies are labelled. Build on useful work, check claims, and avoid repeating answers. Each member gets one turn per user message.` : "";
        const llmMessages: LlmMessage[] = [
          { role: "system", content: `${buildSystemPrompt(memoryBlock, responder.bot)}${groupContext}\nAvailable teammates for message_bot: ${JSON.stringify(roster)}. Only these ids may be contacted. Share only task-relevant context. A private reply is another model's output; verify it when needed.` },
          ...historyToLlm(listMessages(conv.id)),
        ];
        let assistantText = "";
        const maxToolRounds = 6;

        for (let round = 0; round < maxToolRounds; round++) {
          const toolAcc = new Map<
            number,
            { id: string; name: string; arguments: string }
          >();
          let content = "";
          let sawToolCalls = false;

          for await (const chunk of streamChatCompletion({
            settings,
            messages: llmMessages,
            tools,
          })) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            if (delta?.content) {
              content += delta.content;
              assistantText += delta.content;
              send({ type: "delta", text: delta.content });
            }
            if (delta?.tool_calls) {
              sawToolCalls = true;
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const cur = toolAcc.get(idx) ?? {
                  id: "",
                  name: "",
                  arguments: "",
                };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name += tc.function.name;
                if (tc.function?.arguments) {
                  cur.arguments += tc.function.arguments;
                }
                toolAcc.set(idx, cur);
              }
            }
          }

          if (!sawToolCalls || toolAcc.size === 0) {
            if (!content && !assistantText) {
              assistantText = "…";
              send({ type: "delta", text: assistantText });
            }
            break;
          }

          const toolCalls: LlmToolCall[] = [...toolAcc.values()].slice(0, 4).map((t) => ({
            id: t.id || `call_${Math.random().toString(36).slice(2)}`,
            type: "function",
            function: { name: t.name, arguments: t.arguments },
          }));

          llmMessages.push({
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls,
          });

          if (content) {
            insertMessage({
              conversationId: conv.id,
              role: "assistant",
              content,
              ...speaker,
            });
          }

          for (const call of toolCalls) {
            send({
              type: "tool_start",
              tool: call.function.name,
              input: safeParse(call.function.arguments),
            });
            const output = await runTool(
              call.function.name,
              call.function.arguments,
              settings,
              { userMessageId: userMessage.id, botId: responder.bot ? responder.id : undefined, groupId: conv.kind === "group" ? conv.id : undefined, budget },
            );
            if (call.function.name === "react_message") {
              try {
                const reaction = JSON.parse(output) as { messageId: string; reactions: MessageReaction[] };
                if (reaction.messageId && reaction.reactions) send({ type: "reaction", ...reaction });
              } catch { /* Invalid arguments produce a plain-text tool error. */ }
            }
            let toolError: string | undefined;
            if (call.function.name === "message_bot" && /^(message_bot failed:|message_bot unavailable)/.test(output)) toolError = output;
            if (call.function.name === "computer_exec") {
              if (output.startsWith("computer_exec failed:")) toolError = output;
              else {
                const result = safeParse(output) as { exitCode?: number; timedOut?: boolean } | null;
                if (!result || typeof result.exitCode !== "number") toolError = output;
                else if (result.exitCode !== 0) toolError = result.timedOut ? "Command timed out; computer stopped." : `Command exited with code ${result.exitCode}.`;
              }
            }
            send({
              type: "tool_end",
              tool: call.function.name,
              output: call.function.name === "computer_exec" ? output : output.slice(0, 4000),
              error: toolError,
            });
            insertMessage({
              conversationId: conv.id,
              role: "tool",
              content: output,
              toolName: call.function.name,
              toolCallId: call.id,
              ...speaker,
            });
            llmMessages.push({
              role: "tool",
              content: output,
              tool_call_id: call.id,
              name: call.function.name,
            });
          }

          // reset assistant text for final answer after tools
          assistantText = "";
          if (round === maxToolRounds - 1) {
            for await (const chunk of streamChatCompletion({ settings, messages: llmMessages })) {
              const text = chunk.choices?.[0]?.delta?.content;
              if (text) { assistantText += text; send({ type: "delta", text }); }
            }
          }
        }

        const saved = insertMessage({
          conversationId: conv.id,
          role: "assistant",
          content: assistantText || "(no response)",
          ...speaker,
        });
        send({ type: "message_done", messageId: saved.id });

        void extractAndStoreMemories({
          settings,
          userMessage: message,
          assistantMessage: saved.content,
        });
        }
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        send({ type: "done" });
      } finally {
        activeChats.delete(conv.id);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
