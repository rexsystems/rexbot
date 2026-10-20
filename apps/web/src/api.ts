import type {
  Routine,
  RoutineInput,
  ModelChoice,
  ProviderConnection,
  ProviderModel,
  ProviderState,
  AdminComputer,
  AdminOverview,
  AdminUsage,
  AdminUser,
  AppSettings,
  AuthState,
  AuthUser,
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

const configuredBase = import.meta.env.VITE_API_URL;
/** "same-origin" is for builds the API serves itself; otherwise the dev server and the desktop app talk to localhost:8787. */
export const API_BASE = configuredBase === "same-origin" ? window.location.origin : configuredBase ?? "http://localhost:8787";

/** Fired when the session ends (expired, signed out elsewhere, account disabled). */
export const SESSION_ENDED = "rex:session-ended";

// Browsers keep the session in an HttpOnly cookie. The desktop app's webview is a different site
// from the local API, so it cannot use that cookie and keeps the token itself instead.
const TOKEN_KEY = "rex.sessionToken";
const usesBearer = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function authHeaders(headers?: HeadersInit): HeadersInit | undefined {
  const token = usesBearer ? localStorage.getItem(TOKEN_KEY) : null;
  if (!token) return headers;
  const merged = new Headers(headers);
  merged.set("Authorization", `Bearer ${token}`);
  return merged;
}

function keepToken(token: string | undefined) {
  if (!usesBearer) return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init, headers: authHeaders(init?.headers) });
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(SESSION_ENDED));
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
    credentials: "include",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      conversationId: opts.conversationId,
      respondTo: opts.respondTo,
      message: opts.message,
      uploadIds: opts.uploadIds,
      settings: opts.settings,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

const post = (body: unknown = {}): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const authState = () => json<AuthState>("/auth/state");
type SignedIn = { user: AuthUser; token?: string };
const remember = (result: SignedIn) => { keepToken(result.token); return { user: result.user }; };
export const signIn = (email: string, password: string) => json<SignedIn>("/auth/login", post({ email, password })).then(remember);
export const signUp = (name: string, email: string, password: string) => json<SignedIn>("/auth/signup", post({ name, email, password })).then(remember);
export const signOut = () => json<{ ok: boolean }>("/auth/logout", post()).finally(() => keepToken(undefined));
export const updateProfile = (name: string) => json<{ user: AuthUser }>("/auth/profile", post({ name }));
export const changePassword = (current: string, next: string) => json<{ ok: boolean }>("/auth/password", post({ current, next }));

const send = (method: string, body: unknown = {}): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const id = (value: string) => encodeURIComponent(value);

export const admin = {
  overview: () => json<AdminOverview>("/admin/overview"),
  users: (query = "") => json<AdminUser[]>(`/admin/users${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  createUser: (input: { email: string; name: string; password: string; role: "admin" | "user" }) => json<AuthUser>("/admin/users", post(input)),
  updateUser: (userId: string, patch: Partial<Pick<AuthUser, "name" | "role" | "status">>) => json<AuthUser>(`/admin/users/${id(userId)}`, send("PATCH", patch)),
  setPassword: (userId: string, password: string) => json<{ ok: boolean }>(`/admin/users/${id(userId)}/password`, post({ password })),
  signOutUser: (userId: string) => json<{ ok: boolean }>(`/admin/users/${id(userId)}/sign-out`, post()),
  deleteUser: (userId: string) => json<{ ok: boolean }>(`/admin/users/${id(userId)}`, { method: "DELETE" }),
  computers: () => json<TemplateState & { kind: "qemu" | "podman"; computers: AdminComputer[] }>("/admin/computers"),
  buildTemplate: (baseImageUrl?: string) => json<TemplateState["build"]>("/admin/computers/template", post({ baseImageUrl })),
  computerAction: (ownerId: string, action: "start" | "stop" | "kill" | "reset") => json<{ ok: boolean }>(`/admin/computers/${id(ownerId)}/${action}`, post()),
  resizeComputer: (ownerId: string, spec: { memoryMb?: number; cores?: number; diskGb?: number }) => json<{ ok: boolean }>(`/admin/computers/${id(ownerId)}`, send("PATCH", spec)),
  serialLog: (ownerId: string) => json<{ log: string }>(`/admin/computers/${id(ownerId)}/serial`),
  usage: (days: number) => json<AdminUsage>(`/admin/usage?days=${days}`),
  settings: () => json<AppSettings>("/admin/settings"),
  updateSettings: (patch: Partial<AppSettings>) => json<AppSettings>("/admin/settings", send("PATCH", patch)),
};

export const providers = {
  state: () => json<ProviderState>("/providers"),
  save: (input: { id?: string; provider?: string; label?: string; baseUrl?: string; apiKey?: string; defaultModel?: string }) =>
    json<{ connection: ProviderConnection; state: ProviderState }>("/providers/connections", post(input)),
  remove: (connectionId: string) => json<ProviderState>(`/providers/connections/${id(connectionId)}`, { method: "DELETE" }),
  models: (input: { connectionId?: string; provider?: string; baseUrl?: string; apiKey?: string }) => json<{ models: ProviderModel[] }>("/providers/models", post(input)),
  setActive: (choice: ModelChoice | null) => json<ProviderState>("/providers/active", send("PUT", choice)),
};

export const routines = {
  list: () => json<{ routines: Routine[] }>("/routines").then((result) => result.routines),
  create: (input: RoutineInput) => json<{ routine: Routine }>("/routines", post(input)).then((result) => result.routine),
  update: (routineId: string, patch: Partial<RoutineInput>) => json<{ routine: Routine }>(`/routines/${id(routineId)}`, send("PATCH", patch)).then((result) => result.routine),
  remove: (routineId: string) => json<{ ok: boolean }>(`/routines/${id(routineId)}`, { method: "DELETE" }),
  run: (routineId: string) => json<{ ok: boolean; error?: string; routine: Routine }>(`/routines/${id(routineId)}/run`, post()),
};

export interface CursorStatus { connected: boolean; keyHint: string | null; keyName: string | null }

export const cursor = {
  status: () => json<CursorStatus>("/integrations/cursor"),
  connect: (apiKey: string) => json<CursorStatus>("/integrations/cursor", send("PUT", { apiKey })),
  disconnect: () => json<CursorStatus>("/integrations/cursor", { method: "DELETE" }),
};
