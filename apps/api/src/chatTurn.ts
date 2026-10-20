import {
  buildSystemPrompt,
  DEFAULT_SETTINGS,
  toOpenAiTools,
  type ClientSettings,
  type SseEvent,
  type MessageReaction,
  MAX_MESSAGE_ATTACHMENTS,
  isPreviewImage,
  botReplyText,
} from "@rex/shared";
import {
  createConversation,
  getConversation,
  getOwnedConversation,
  insertMessage,
  listMessages,
  titleFromMessage,
  touchConversation,
} from "./conversations.js";
import {
  extractAndStoreMemories,
  formatMemoryBlock,
  retrieveMemories,
} from "./memory/store.js";
import {
  streamChatCompletion,
  type LlmMessage,
  type LlmToolCall,
} from "./llm.js";
import { runTool } from "./tools/index.js";
import { computers } from "./computer.js";
import { db } from "./db.js";
import { messageUploads } from "./uploads.js";
import { activeChats, peers, selectGroupResponders } from "./groups.js";
import { messageReasoning, reasoningScope, responseReasoning } from "./reasoning.js";
import { hasCursor } from "./integrations/cursor.js";
import { userTimeZone } from "./routines.js";
import { skillSummaries } from "./skills.js";
import { hasUsableModel, resolveModelSettings, type ModelSettings } from "./providers.js";

export type TurnEvent = SseEvent;

export function normalizeSettings(raw: Partial<ClientSettings> | undefined): ModelSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    // Routing is decided on the server from the user's saved connections, never by the request.
    route: undefined,
    llmApiKey: raw?.llmApiKey?.trim() ?? "",
    llmBaseUrl: raw?.llmBaseUrl?.trim() || DEFAULT_SETTINGS.llmBaseUrl,
    llmModel: raw?.llmModel?.trim() || DEFAULT_SETTINGS.llmModel,
    searchApiKey: raw?.searchApiKey?.trim() ?? "",
    embeddingModel:
      raw?.embeddingModel?.trim() || DEFAULT_SETTINGS.embeddingModel,
    googleApiKey: raw?.googleApiKey?.trim() ?? "",
    liveModel: raw?.liveModel?.trim() || DEFAULT_SETTINGS.liveModel,
  };
}

export function historyToLlm(messages: ReturnType<typeof listMessages>, settings: ClientSettings, speakerId?: string): LlmMessage[] {
  // Prior turns: only user/assistant text. Tool rounds stay in-request only.
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content.trim().length > 0 || m.attachments?.length)
    .map((m) => ({ role: m.role as "user" | "assistant", ...(m.role === "assistant" ? messageReasoning(m.id, settings) : {}), content: `${m.botName && m.botId !== speakerId ? `[${m.botName}]: ` : ""}${m.role === "assistant" ? botReplyText(m.content, m.botName) : m.content}${m.attachments?.length ? `\n\n[Attached files: ${m.attachments.map((upload) => `${upload.filename} (${upload.mimeType}, upload id: ${upload.id})`).join(", ")}. Use read_upload for text documents. ${m.attachments.some((upload) => isPreviewImage(upload.mimeType)) ? "Image pixels are not available to this text-only model. Do not claim to have viewed them." : ""}]` : ""}` }));
}

export interface TurnInput {
  userId: string;
  conversationId?: string;
  respondTo?: unknown;
  message: string;
  uploadIds?: unknown;
  settings?: Partial<ClientSettings>;
  /** Extra system text for this turn only, e.g. "this is a scheduled routine". */
  note?: string;
  /** The browser's IANA zone; remembered per user so routines and the clock use it. */
  timeZone?: unknown;
  /** Routine runs can't schedule more routines. */
  allowRoutines?: boolean;
}

export type PreparedTurn =
  | { ok: false; status: 400 | 404 | 409; error: string }
  | { ok: true; conversationId: string; run: (send: (event: SseEvent) => void) => Promise<void> };

/**
 * Validates a chat turn, saves the user message, and returns a runner that streams the bot replies.
 * Used by POST /chat and by scheduled routines.
 */
export async function prepareChatTurn(input: TurnInput): Promise<PreparedTurn> {
  const fail = (status: 400 | 404 | 409, error: string): PreparedTurn => ({ ok: false, status, error });
  const userId = input.userId;
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const uploadIds = input.uploadIds ?? [];
  const body = { conversationId: input.conversationId, respondTo: input.respondTo };
  if (!Array.isArray(uploadIds) || uploadIds.length > MAX_MESSAGE_ATTACHMENTS || uploadIds.some((id) => typeof id !== "string") || new Set(uploadIds).size !== uploadIds.length) return fail(400, "Invalid attachments (max 8 files per message)");
  if (!message && !uploadIds.length) return fail(400, "A message or attachment is required");
  for (const id of uploadIds as string[]) {
    const upload = db.prepare("SELECT message_id FROM uploads WHERE id = ? AND user_id = ?").get(id, userId) as { message_id: string | null } | undefined;
    if (!upload || upload.message_id) return fail(400, "An attachment is missing or already sent. Attach it again.");
  }
  const clientSettings = normalizeSettings(input.settings);
  if (!hasUsableModel(userId, clientSettings)) {
    return fail(400, "Connect a model provider in Settings → Models first.");
  }

  let conversation = body.conversationId
    ? getOwnedConversation(body.conversationId, userId)
    : null;
  if (body.conversationId && !conversation) return fail(404, "Conversation not found");
  const isNew = !conversation;
  if (!conversation) {
    conversation = createConversation(titleFromMessage(message || "Image attachments"), undefined, userId);
  }
  if (activeChats.has(conversation.id)) return fail(409, "This conversation is already working. Wait for it to finish.");
  if (body.respondTo !== undefined && typeof body.respondTo !== "string") return fail(400, "Choose a valid responding bot.");
  const responders = conversation.kind === "group" ? selectGroupResponders(conversation.memberIds ?? [], message, body.respondTo) : [conversation];
  if (!responders.length) return fail(400, "Choose a current group member, or add bots to this group before sending.");
  let responderSettings: ModelSettings[];
  try {
    responderSettings = responders.map((responder) => resolveModelSettings(userId, clientSettings, responder?.bot, responder?.bot ? responder.id : undefined));
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : String(error));
  }
  const settings = responderSettings[0]!;
  activeChats.add(conversation.id);

  const userMessage = insertMessage({
    conversationId: conversation.id,
    role: "user",
    content: message,
  });
  const attach = db.prepare("UPDATE uploads SET conversation_id = ?, message_id = ?, message_position = ? WHERE id = ?");
  const attachmentConversationId = conversation.id;
  db.transaction(() => { (uploadIds as string[]).forEach((id, position) => attach.run(attachmentConversationId, userMessage.id, position, id)); })();
  userMessage.attachments = messageUploads(userMessage.id);
  if (isNew) {
    touchConversation(conversation.id, titleFromMessage(message || "Image attachments"));
    conversation = getConversation(conversation.id)!;
  }

  const timeZone = userTimeZone(userId, input.timeZone);
  const now = { text: new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "full", timeStyle: "short" }).format(new Date()), timeZone };
  const skills = skillSummaries(userId);
  const conv = conversation;
  const note = input.note ? `\n${input.note}` : "";
  return {
    ok: true,
    conversationId: conv.id,
    run: async (send) => {
      try {
        // Persist + notify immediately so a reload already sees the user message.
        send({ type: "conversation", conversation: conv });
        send({ type: "user_message", message: userMessage });
        let memoryBlock: string;
        try {
          memoryBlock = formatMemoryBlock(await retrieveMemories(settings, userId, message));
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
          send({ type: "done" });
          return;
        }
        const budget = { remaining: 6 };
        for (const [responderIndex, responder] of responders.entries()) {
        if (!responder) continue;
        const settings = responderSettings[responderIndex]!;
        const speaker = responder.bot ? { botId: responder.id, botName: responder.bot.name } : {};
        if (speaker.botId && speaker.botName) send({ type: "speaker", botId: speaker.botId, botName: speaker.botName });
        const roster = peers(responder.id, conv.kind === "group" ? conv.id : undefined);
        const tools = toOpenAiTools({ desktop: computers.desktop, cursor: hasCursor(userId), routines: input.allowRoutines !== false, skills: skills.length > 0 }).filter((tool) => tool.function.name !== "message_bot" || roster.length > 0);
        const groupContext = conv.kind === "group" ? `\nYou are in group ${JSON.stringify(conv.title)}. You were selected to answer this message. Speak only for yourself, without a speaker label. Other members' prior replies are labelled for context. Build on useful work, check claims, and avoid repeating answers. Use message_bot for a specific teammate's private help when useful; do not invent replies on their behalf. ${responders.length > 1 ? "The user explicitly requested everyone; you each get one turn, in order." : "Only one member is replying publicly to this message."}` : "";
        const llmMessages: LlmMessage[] = [
          { role: "system", content: `${buildSystemPrompt(memoryBlock, responder.bot, { desktop: computers.desktop, now, skills })}${groupContext}\nAvailable teammates for message_bot: ${JSON.stringify(roster)}. Only these ids may be contacted. Share only task-relevant context. A private reply is another model's output; verify it when needed.${note}` },
          ...historyToLlm(listMessages(conv.id), settings, responder.id),
        ];
        let assistantText = "";
        let assistantReasoning: string | undefined;
        let emittedAnswer = "";
        const emitAnswer = (text: string, complete = false) => {
          const visible = botReplyText(text, responder.bot?.name, complete);
          if (visible.length > emittedAnswer.length) send({ type: "delta", text: visible.slice(emittedAnswer.length) });
          emittedAnswer = visible;
        };
        const maxToolRounds = 16;

        for (let round = 0; round < maxToolRounds; round++) {
          const toolAcc = new Map<
            number,
            { id: string; name: string; arguments: string }
          >();
          let content = "";
          let reasoning: string | undefined;
          emittedAnswer = "";
          let sawToolCalls = false;

          for await (const chunk of streamChatCompletion({
            settings,
            messages: llmMessages,
            tools,
          })) {
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            if (typeof delta?.reasoning_content === "string") reasoning = (reasoning ?? "") + delta.reasoning_content;
            if (delta?.content) {
              content += delta.content;
              assistantText += delta.content;
              emitAnswer(content);
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
          emitAnswer(content, true);
          assistantReasoning = reasoning;

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
            ...responseReasoning(reasoning, settings),
          });

          if (content) {
            insertMessage({
              conversationId: conv.id,
              role: "assistant",
              content: botReplyText(content, responder.bot?.name),
              reasoning: reasoning === undefined ? undefined : { content: reasoning, scope: reasoningScope(settings) },
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
              { userMessageId: userMessage.id, ownerId: userId, conversationId: conv.id, timeZone, botId: responder.bot ? responder.id : undefined, groupId: conv.kind === "group" ? conv.id : undefined, budget },
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
                else if (result.exitCode !== 0) toolError = result.timedOut ? (computers.kind === "podman" ? "Command timed out; computer stopped." : "Command timed out.") : `Command exited with code ${result.exitCode}.`;
              }
            }
            if ((call.function.name === "computer_input" || call.function.name === "computer_screenshot") && /^computer_\w+ (failed|unavailable)/.test(output)) toolError = output;
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
          assistantReasoning = undefined;
          if (round === maxToolRounds - 1) {
            emittedAnswer = "";
            for await (const chunk of streamChatCompletion({ settings, messages: llmMessages })) {
              const reasoningPart = chunk.choices?.[0]?.delta?.reasoning_content;
              if (typeof reasoningPart === "string") assistantReasoning = (assistantReasoning ?? "") + reasoningPart;
              const text = chunk.choices?.[0]?.delta?.content;
              if (text) { assistantText += text; emitAnswer(assistantText); }
            }
            emitAnswer(assistantText, true);
          }
        }

        const saved = insertMessage({
          conversationId: conv.id,
          role: "assistant",
          content: botReplyText(assistantText, responder.bot?.name) || "(no response)",
          reasoning: assistantReasoning === undefined ? undefined : { content: assistantReasoning, scope: reasoningScope(settings) },
          ...speaker,
        });
        send({ type: "message_done", messageId: saved.id });

        void extractAndStoreMemories({
          settings,
          userId,
          userMessage: message,
          assistantMessage: saved.content,
        });
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
        send({ type: "done" });
      } finally {
        activeChats.delete(conv.id);
      }
    },
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
