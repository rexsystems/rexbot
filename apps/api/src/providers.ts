import type { UsageCounters } from "./usage.js";
import { lookup } from "node:dns/promises";
import { nanoid } from "nanoid";
import {
  providerInfo, type ClientSettings, type ModelChoice, type ProviderConnection, type ProviderId, type ProviderKind,
  type ProviderModel, type ProviderState, type UserRole, PROVIDERS,
} from "@rex/shared";
import { db, nowIso } from "./db.js";
import { decryptSecret, encryptSecret, secretHint } from "./secrets.js";
import { isPublicAddress, privateFetchAllowed } from "./tools/safeFetch.js";

/** Where a model request goes. Set only on the server; client-sent settings never carry it. */
export interface ModelRoute {
  kind: ProviderKind;
  provider: ProviderId | "client";
  streamUsage: boolean;
  /** Send image attachments as images. */
  vision?: boolean;
  userId?: string;
  botId?: string;
}

export type ModelSettings = ClientSettings & { route?: ModelRoute };

interface ConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  base_url: string;
  api_key: string | null;
  key_hint: string | null;
  default_model: string;
  vision: number | null;
  created_at: string;
  updated_at: string;
}

function toConnection(row: ConnectionRow): ProviderConnection {
  return {
    id: row.id, provider: providerInfo(row.provider).id, label: row.label, baseUrl: row.base_url, keyHint: row.key_hint,
    defaultModel: row.default_model, vision: row.vision === null ? providerInfo(row.provider).vision : row.vision === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function connectionRow(userId: string, id: string) {
  return db.prepare("SELECT * FROM provider_connections WHERE id = ? AND user_id = ?").get(id, userId) as ConnectionRow | undefined;
}

export function listConnections(userId: string): ProviderConnection[] {
  return (db.prepare("SELECT * FROM provider_connections WHERE user_id = ? ORDER BY created_at").all(userId) as ConnectionRow[]).map(toConnection);
}

function userSetting(userId: string, key: string): unknown {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?").get(userId, key) as { value: string } | undefined;
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

function setUserSetting(userId: string, key: string, value: unknown) {
  if (value === undefined || value === null) db.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = ?").run(userId, key);
  else db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(userId, key, JSON.stringify(value));
}

function validChoice(userId: string, value: unknown): ModelChoice | null {
  const choice = value as ModelChoice | undefined;
  if (!choice || typeof choice.connectionId !== "string" || typeof choice.model !== "string" || !choice.model.trim()) return null;
  return connectionRow(userId, choice.connectionId) ? { connectionId: choice.connectionId, model: choice.model.trim() } : null;
}

export function providerState(userId: string): ProviderState {
  const connections = listConnections(userId);
  let active = validChoice(userId, userSetting(userId, "activeModel"));
  // With one connection and no explicit choice, that connection's default model is the obvious one.
  if (!active && connections.length) {
    const first = connections.find((connection) => connection.defaultModel);
    if (first) active = { connectionId: first.id, model: first.defaultModel };
  }
  return { connections, active };
}

export function setActiveModel(userId: string, choice: unknown): ModelChoice | null {
  const valid = choice === null ? null : validChoice(userId, choice);
  if (choice !== null && !valid) throw new Error("Choose one of your connected providers and a model.");
  setUserSetting(userId, "activeModel", valid);
  return valid;
}

function normalizeBaseUrl(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid base URL, such as https://api.example.com/v1."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The base URL must start with https:// or http://.");
  return url.toString().replace(/\/+$/, "");
}

/**
 * Provider URLs are fetched by the server, so they are an SSRF path like http_fetch. Members may only
 * use public hosts; admins may point at local servers (Ollama, LM Studio) on the same machine.
 */
export async function assertProviderUrlAllowed(baseUrl: string, role: UserRole) {
  if (role === "admin" || privateFetchAllowed()) return;
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error(`${host} could not be resolved.`);
  if (addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error("Only admins can connect providers on private or local addresses.");
}

export async function saveConnection(userId: string, role: UserRole, input: { id?: unknown; provider?: unknown; label?: unknown; baseUrl?: unknown; apiKey?: unknown; defaultModel?: unknown; vision?: unknown }): Promise<ProviderConnection> {
  const existing = typeof input.id === "string" ? connectionRow(userId, input.id) : undefined;
  if (typeof input.id === "string" && !existing) throw new Error("Connection not found.");
  const info = providerInfo(typeof input.provider === "string" ? input.provider : existing?.provider ?? "custom");
  if (!PROVIDERS.some((provider) => provider.id === info.id)) throw new Error("Unknown provider.");
  const baseUrl = normalizeBaseUrl(input.baseUrl, existing?.base_url ?? info.baseUrl);
  await assertProviderUrlAllowed(baseUrl, role);
  const newKey = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
  if (newKey !== undefined && newKey.length > 1000) throw new Error("That key is too long.");
  const keepKey = newKey === undefined || newKey === "";
  if (info.keyRequired && keepKey && !existing?.api_key) throw new Error(`Paste your ${info.name} API key.`);
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 60) : existing?.label ?? info.name;
  const defaultModel = typeof input.defaultModel === "string" ? input.defaultModel.trim().slice(0, 200) : existing?.default_model ?? "";
  const vision = typeof input.vision === "boolean" ? (input.vision ? 1 : 0) : existing?.vision ?? null;
  const ts = nowIso();
  const id = existing?.id ?? nanoid(12);
  const apiKey = keepKey ? existing?.api_key ?? null : encryptSecret(newKey);
  const keyHint = keepKey ? existing?.key_hint ?? null : secretHint(newKey);
  db.prepare(`INSERT INTO provider_connections (id, user_id, provider, label, base_url, api_key, key_hint, default_model, vision, created_at, updated_at)
    VALUES (@id, @user_id, @provider, @label, @base_url, @api_key, @key_hint, @default_model, @vision, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, label = excluded.label, base_url = excluded.base_url, api_key = excluded.api_key,
      key_hint = excluded.key_hint, default_model = excluded.default_model, vision = excluded.vision, updated_at = excluded.updated_at`).run({
    id, user_id: userId, provider: info.id, label, base_url: baseUrl, api_key: apiKey, key_hint: keyHint, default_model: defaultModel, vision,
    created_at: existing?.created_at ?? ts, updated_at: ts,
  });
  return toConnection(connectionRow(userId, id)!);
}

export function deleteConnection(userId: string, id: string): boolean {
  const result = db.prepare("DELETE FROM provider_connections WHERE id = ? AND user_id = ?").run(id, userId);
  const active = userSetting(userId, "activeModel") as ModelChoice | undefined;
  if (active?.connectionId === id) setUserSetting(userId, "activeModel", null);
  return result.changes > 0;
}

interface Target { kind: ProviderKind; provider: ProviderId; baseUrl: string; apiKey: string; streamUsage: boolean; vision: boolean }

function target(row: ConnectionRow): Target {
  const info = providerInfo(row.provider);
  const apiKey = row.api_key ? decryptSecret(row.api_key) : "";
  if (apiKey === null) throw new Error(`The saved ${info.name} key can't be read any more (the server's secret key changed). Paste it again in Settings → Models.`);
  return { kind: info.kind, provider: info.id, baseUrl: row.base_url, apiKey, streamUsage: info.streamUsage, vision: toConnection(row).vision };
}

/**
 * Picks the model for one reply: the bot's own model, else the user's active model, else the legacy
 * key the browser sent. Returns settings with the key and URL filled in, ready for the LLM adapter.
 */
export function resolveModelSettings(userId: string, base: ClientSettings, bot?: { model?: ModelChoice } | null, botId?: string): ModelSettings {
  const choice = (bot?.model && validChoice(userId, bot.model)) || providerState(userId).active;
  if (choice) {
    const row = connectionRow(userId, choice.connectionId)!;
    const t = target(row);
    return {
      ...base, llmApiKey: t.apiKey, llmBaseUrl: t.baseUrl, llmModel: choice.model,
      route: { kind: t.kind, provider: t.provider, streamUsage: t.streamUsage, vision: t.vision, userId, botId },
    };
  }
  if (!base.llmApiKey) throw new Error("Connect a model provider in Settings → Models first.");
  return { ...base, route: { kind: "openai", provider: "client", streamUsage: false, userId, botId } };
}

export function hasUsableModel(userId: string, base: ClientSettings) {
  return Boolean(providerState(userId).active || base.llmApiKey);
}

/** Lists models from the provider itself, so the picker never offers ids that don't exist. */
export async function listModels(userId: string, input: { connectionId?: unknown; provider?: unknown; baseUrl?: unknown; apiKey?: unknown }, role: UserRole): Promise<ProviderModel[]> {
  let t: Target;
  if (typeof input.connectionId === "string") {
    const row = connectionRow(userId, input.connectionId);
    if (!row) throw new Error("Connection not found.");
    t = target(row);
    if (typeof input.apiKey === "string" && input.apiKey.trim()) t.apiKey = input.apiKey.trim();
  } else {
    const info = providerInfo(typeof input.provider === "string" ? input.provider : "custom");
    const baseUrl = normalizeBaseUrl(input.baseUrl, info.baseUrl);
    await assertProviderUrlAllowed(baseUrl, role);
    t = { kind: info.kind, provider: info.id, baseUrl, apiKey: typeof input.apiKey === "string" ? input.apiKey.trim() : "", streamUsage: info.streamUsage, vision: info.vision };
  }
  const headers: Record<string, string> = t.kind === "anthropic"
    ? { "x-api-key": t.apiKey, "anthropic-version": "2023-06-01" }
    : t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : {};
  const response = await fetch(`${t.baseUrl}/models${t.kind === "anthropic" ? "?limit=1000" : ""}`, { headers, signal: AbortSignal.timeout(15_000), redirect: "error" });
  if (response.status === 401 || response.status === 403) throw new Error("The provider rejected this key.");
  if (!response.ok) throw new Error(`The provider answered ${response.status} when listing models.`);
  const body = await response.json() as { data?: Array<{ id?: unknown; display_name?: unknown; name?: unknown }>; models?: Array<{ id?: unknown; name?: unknown }> };
  const list = body.data ?? body.models ?? [];
  const models = list
    .map((entry) => ({ id: typeof entry.id === "string" ? entry.id : "", name: typeof (entry as { display_name?: unknown }).display_name === "string" ? (entry as { display_name: string }).display_name : typeof entry.name === "string" ? entry.name : undefined }))
    .filter((entry) => entry.id)
    .map((entry) => ({ id: entry.id.replace(/^models\//, ""), ...(entry.name && entry.name !== entry.id ? { name: entry.name } : {}) }));
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export function recordUsage(route: ModelRoute | undefined, model: string, usage: UsageCounters, toolCalls: number) {
  if (!route?.userId) return;
  db.prepare("INSERT INTO usage_events (user_id, bot_id, provider, model, prompt_tokens, completion_tokens, tool_calls, created_at, cache_read_tokens, cache_write_tokens, reasoning_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(route.userId, route.botId ?? null, route.provider, model, usage.prompt, usage.completion, toolCalls, nowIso(), usage.cacheRead ?? null, usage.cacheWrite ?? null, usage.reasoning ?? null);
}
