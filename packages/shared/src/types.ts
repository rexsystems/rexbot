export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  createdAt: string;
  reactions?: MessageReaction[];
  attachments?: UploadMeta[];
  botId?: string | null;
  botName?: string | null;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENTS = 8;
export function isPreviewImage(mime: string) {
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(mime);
}

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export interface MessageReaction {
  actor: "user" | "rex";
  emoji: ReactionEmoji;
}

export interface ComputerStatus {
  available: boolean;
  running: boolean;
  busy: boolean;
  imageReady: boolean;
  detail: string;
}

export interface ComputerResult {
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bot?: BotProfile;
  kind?: "group";
  memberIds?: string[];
}

export interface BotExchange {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  message: string;
  reply: string;
  createdAt: string;
}

export const BOT_SHAPES = ["orb", "pebble", "cube", "capsule", "diamond"] as const;
export const BOT_MOTIONS = ["float", "orbit", "spin", "still"] as const;
export interface BotProfile {
  name: string;
  color: string;
  shape: (typeof BOT_SHAPES)[number];
  motion: (typeof BOT_MOTIONS)[number];
  blink: boolean;
  instructions: string;
}
export const DEFAULT_BOT: BotProfile = {
  name: "Rex", color: "#66b8ff", shape: "orb", motion: "float", blink: true, instructions: "",
};

export interface MemoryItem {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientSettings {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  searchApiKey: string;
  embeddingModel: string;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  llmApiKey: "",
  llmBaseUrl: "https://api.deepseek.com",
  llmModel: "deepseek-flash",
  searchApiKey: "",
  embeddingModel: "",
};

export type ToolName = "web_search" | "read_upload" | "http_fetch" | "computer_exec" | "react_message" | "message_bot";

export interface ToolCallEvent {
  type: "tool_start" | "tool_end";
  tool: ToolName | string;
  input?: unknown;
  output?: string;
  error?: string;
}

export type SseEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "reaction"; messageId: string; reactions: MessageReaction[] }
  | { type: "delta"; text: string }
  | { type: "speaker"; botId: string; botName: string }
  | { type: "tool_start"; tool: string; input?: unknown }
  | { type: "tool_end"; tool: string; output?: string; error?: string }
  | { type: "message_done"; messageId: string }
  | { type: "conversation"; conversation: Conversation }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatRequestBody {
  conversationId?: string;
  message: string;
  uploadIds?: string[];
  settings: ClientSettings;
}

export interface UploadMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}
