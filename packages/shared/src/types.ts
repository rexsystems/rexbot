import type { ModelChoice } from "./providers.js";
export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  question?: ChatQuestion;
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

export type ComputerBackendKind = "podman" | "qemu";

export interface ComputerStatus {
  available: boolean;
  running: boolean;
  busy: boolean;
  imageReady: boolean;
  detail: string;
  backend?: ComputerBackendKind;
  /** True when bots get their own screens and mouse/keyboard tools. */
  desktop?: boolean;
  /** VM power state: running, stopped, missing, starting or stopping. */
  vmState?: string;
  /** True when the QEMU computer image has not been built yet. */
  setupNeeded?: boolean;
  /** Guest session manager answered over SSH. */
  guestReady?: boolean;
}

export interface ComputerSessionState {
  botId: string;
  locked: boolean;
}

export interface ComputerSession extends ComputerSessionState {
  slot: number;
  display: string;
  width: number;
  height: number;
  /** API-relative noVNC page for this bot's screen. */
  viewPath: string;
}

export const COMPUTER_INPUT_ACTIONS = ["move", "click", "double_click", "right_click", "type", "key", "scroll"] as const;
export type ComputerInputActionName = (typeof COMPUTER_INPUT_ACTIONS)[number];
export interface ComputerInputAction {
  action: ComputerInputActionName;
  x?: number;
  y?: number;
  text?: string;
  keys?: string;
  direction?: "up" | "down";
  amount?: number;
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
/** Google Live prebuilt voices (speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName). */
export const BOT_VOICES = [
  "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr",
  "Autonoe", "Umbriel", "Erinome", "Algieba", "Despina", "Alnilam", "Schedar", "Sulafat",
] as const;
export interface BotProfile {
  name: string;
  color: string;
  shape: (typeof BOT_SHAPES)[number];
  motion: (typeof BOT_MOTIONS)[number];
  blink: boolean;
  /** Google Live prebuilt voice name. */
  voice: (typeof BOT_VOICES)[number];
  instructions: string;
  /** This bot's own model; without one it uses the owner's active model. */
  model?: ModelChoice;
}
export const DEFAULT_BOT: BotProfile = {
  name: "Rex", color: "#66b8ff", shape: "orb", motion: "float", blink: true, voice: "Kore", instructions: "",
};

export function normalizeBotProfile(value: Partial<BotProfile> | null | undefined): BotProfile | undefined {
  if (!value || typeof value.name !== "string") return undefined;
  return {
    name: value.name,
    color: typeof value.color === "string" ? value.color : DEFAULT_BOT.color,
    shape: BOT_SHAPES.includes(value.shape as BotProfile["shape"]) ? value.shape as BotProfile["shape"] : DEFAULT_BOT.shape,
    motion: BOT_MOTIONS.includes(value.motion as BotProfile["motion"]) ? value.motion as BotProfile["motion"] : DEFAULT_BOT.motion,
    blink: typeof value.blink === "boolean" ? value.blink : DEFAULT_BOT.blink,
    voice: BOT_VOICES.includes(value.voice as BotProfile["voice"]) ? value.voice as BotProfile["voice"] : DEFAULT_BOT.voice,
    instructions: typeof value.instructions === "string" ? value.instructions : "",
    ...(value.model && typeof value.model.connectionId === "string" && typeof value.model.model === "string" && value.model.model.trim()
      ? { model: { connectionId: value.model.connectionId, model: value.model.model.trim().slice(0, 200) } }
      : {}),
  };
}

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
  embeddingProvider?: "google" | "openai";
  googleApiKey?: string;
  liveModel?: string;
  /** When false (default), hide tool rows in chat while the bot works. */
  showAgentActivity?: boolean;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  llmApiKey: "",
  llmBaseUrl: "https://api.deepseek.com",
  llmModel: "deepseek-flash",
  searchApiKey: "",
  embeddingModel: "gemini-embedding-2",
  embeddingProvider: "google",
  googleApiKey: "",
  liveModel: "gemini-3.8-live",
  showAgentActivity: false,
};

export interface VoiceSessionConfig {
  id: string;
  url: string;
  setup: Record<string, unknown>;
  history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
}

export type ToolName = "web_search" | "read_upload" | "http_fetch" | "computer_exec" | "computer_files" | "computer_project" | "computer_input" | "computer_screenshot" | "react_message" | "message_bot" | "end_call" | "cursor_agent" | "routine" | "load_skill" | "ask_user";

export interface ChatQuestion {
  id: string;
  questions: Array<{ id: string; question: string; options: string[] }>;
  answeredAt: string | null;
}

export interface ToolCallEvent {
  type: "tool_start" | "tool_end";
  tool: ToolName | string;
  input?: unknown;
  output?: string;
  error?: string;
}

export type SseEvent =
  | { type: "user_message"; message: ChatMessage }
  | { type: "assistant_message"; message: ChatMessage }
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
  respondTo?: string;
  message: string;
  uploadIds?: string[];
  settings: ClientSettings;
  /** The browser's IANA time zone, used for the bot's sense of "now" and for routines. */
  timeZone?: string;
}

export interface UploadMeta {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** Workspace settings controlled from the admin panel. */
export interface AppSettings {
  /** open: anyone can create an account. closed: only admins add people. */
  signupMode: "open" | "closed";
  workspaceName: string;
  vmMemoryMb: number;
  vmCores: number;
  vmDiskGb: number;
  /** Minutes without bot or user activity before a VM is powered off. 0 keeps VMs on. */
  vmIdleMinutes: number;
  vmMaxRunning: number;
  maxBotsPerUser: number;
  /** Users without their own provider connection may use the admin's workspace connections. */
  shareWorkspaceKeys: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  signupMode: "closed",
  workspaceName: "Rex",
  vmMemoryMb: 4096,
  vmCores: 2,
  vmDiskGb: 32,
  vmIdleMinutes: 0,
  vmMaxRunning: 4,
  maxBotsPerUser: 50,
  shareWorkspaceKeys: false,
};

export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: "active" | "disabled";
  createdAt: string;
  lastSeenAt: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  /** No accounts exist yet: the next sign-up creates the admin. */
  needsSetup: boolean;
  signupOpen: boolean;
  workspaceName: string;
}

/** Admin panel data. Every number is counted from the database at request time. */
export interface AdminOverview {
  users: number;
  activeUsers7d: number;
  disabledUsers: number;
  bots: number;
  groups: number;
  messages: number;
  messages24h: number;
  computers: { total: number; running: number; kind: ComputerBackendKind; templateVersion: number | null; buildRunning: boolean };
  signupMode: AppSettings["signupMode"];
}

export interface AdminUser extends AuthUser {
  bots: number;
  messages: number;
  sessions: number;
  computerState: string | null;
}

export interface AdminComputer {
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  name: string;
  state: string;
  memoryMb: number;
  cores: number;
  diskGb: number;
  diskUsedBytes: number;
  templateVersion: number | null;
  createdAt: string;
  lastStartedAt: string | null;
}

export interface AdminUsage {
  days: number;
  daily: Array<{ day: string; messages: number; promptTokens: number; completionTokens: number }>;
  byUser: Array<{ userId: string; name: string; email: string; messages: number; promptTokens: number; completionTokens: number }>;
  byModel: Array<{ provider: string; model: string; requests: number; promptTokens: number; completionTokens: number }>;
}

/** When a routine runs. Days are 0 (Sunday) to 6; an empty or missing list means every day. */
export type RoutineSchedule =
  | { kind: "daily"; time: string; days?: number[] }
  | { kind: "interval"; hours: number };

export interface Routine {
  id: string;
  conversationId: string;
  title: string;
  prompt: string;
  schedule: RoutineSchedule;
  timeZone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  createdAt: string;
}

export interface RoutineInput {
  conversationId: string;
  title: string;
  prompt: string;
  schedule: RoutineSchedule;
  timeZone: string;
  enabled?: boolean;
}

/** A reusable instruction pack. Bots see the name and description and load the instructions when a task matches. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}
