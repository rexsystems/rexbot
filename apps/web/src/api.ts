import type {
  ChatMessage,
  ClientSettings,
  Conversation,
  MemoryItem,
  SseEvent,
  UploadMeta,
  ComputerStatus,
  ComputerResult,
  ComputerSession,
  ComputerSessionState,
  MessageReaction,
  ReactionEmoji,
  BotProfile,
  BotExchange,
  VoiceSessionConfig,
} from "@rex/shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* Keep non-JSON server errors readable. */ }
    throw new Error(message || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const computerStatus = () => json<ComputerStatus>("/computer");
export const startComputer = () => json<ComputerStatus>("/computer/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
export const stopComputer = () => json<ComputerStatus>("/computer/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
export const execComputer = (command: string, botId?: string) => json<ComputerResult>("/computer/exec", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command, botId }) });
export const computerSession = (botId: string) => json<ComputerSession>(`/computer/session/${encodeURIComponent(botId)}`);
export const computerSessionState = (botId: string) => json<ComputerSessionState>(`/computer/session/${encodeURIComponent(botId)}/state`);
export const unlockComputerSession = (botId: string) => json<ComputerSessionState>(`/computer/session/${encodeURIComponent(botId)}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
export const computerViewUrl = (viewPath: string) => `${API_BASE}${viewPath}`;
export interface TemplateState {
  host: { qemu: string | null; qemuImg: string | null; isoTool: string | null; ssh: boolean; kvm: boolean; accel: "kvm" | "tcg"; problems: string[] };
  template: { version: number; builtAt: string; sizeBytes: number; baseImage: string } | null;
  build: { running: boolean; log: string[]; error: string | null; startedAt: string | null; finishedAt: string | null };
}
export const computerTemplate = () => json<TemplateState>("/computer/template");
export const buildComputerTemplate = () => json<TemplateState["build"]>("/computer/template/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
export const reactToMessage = (id: string, emoji: ReactionEmoji) => json<{ reactions: MessageReaction[] }>(`/messages/${encodeURIComponent(id)}/reactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }) });

export function listConversations() {
  return json<Conversation[]>("/conversations");
}

export const uploadUrl = (id: string) => `${API_BASE}/uploads/${encodeURIComponent(id)}/content`;
export const deleteUpload = (id: string) => json<{ ok: boolean }>(`/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });

export function saveBot(profile: BotProfile, id?: string) {
  return json<Conversation>(`/bots${id ? `/${encodeURIComponent(id)}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
}

export const saveGroup = (title: string, memberIds: string[], id?: string) => json<Conversation>(`/groups${id ? `/${encodeURIComponent(id)}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, memberIds }) });
export const groupExchanges = (id: string) => json<BotExchange[]>(`/groups/${encodeURIComponent(id)}/exchanges`);
export const startVoiceSession = (conversationId: string, settings: ClientSettings, signal: AbortSignal) => json<VoiceSessionConfig>("/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, settings }), signal });
export const voiceTool = (id: string, name: string, args: unknown) => json<{ output: string; endCall?: boolean }>(`/voice/${encodeURIComponent(id)}/tool`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, args }) });
export const saveVoiceTurn = (id: string, turn: { id: string; user: string; assistant: string }) => json<{ ok: boolean }>(`/voice/${encodeURIComponent(id)}/turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(turn) });
export const endVoiceSession = (id: string) => json<{ ok: boolean }>(`/voice/${encodeURIComponent(id)}`, { method: "DELETE" });

export function getConversation(id: string) {
  return json<{ conversation: Conversation; messages: ChatMessage[] }>(
    `/conversations/${id}`,
  );
}

export function deleteConversation(id: string) {
  return json<{ ok: boolean }>(`/conversations/${id}`, { method: "DELETE" });
}

export function listMemories() {
  return json<MemoryItem[]>("/memories");
}

export function deleteMemory(id: string) {
  return json<{ ok: boolean }>(`/memories/${id}`, { method: "DELETE" });
}

export async function uploadFile(file: File): Promise<UploadMeta> {
  const body = new FormData();
  body.append("file", file);
  return json<UploadMeta>("/uploads", { method: "POST", body });
}

export async function streamChat(opts: {
  conversationId?: string;
  respondTo?: string;
  message: string;
  uploadIds?: string[];
  settings: ClientSettings;
  onEvent: (event: SseEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: opts.conversationId,
      respondTo: opts.respondTo,
      message: opts.message,
      uploadIds: opts.uploadIds,
      settings: opts.settings,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `Chat failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        opts.onEvent(JSON.parse(data) as SseEvent);
      } catch {
        // ignore
      }
    }
  }
}
