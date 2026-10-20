import { db } from "../db.js";
import { decryptSecret, encryptSecret, secretHint } from "../secrets.js";

// Cursor Cloud Agents API (https://cursor.com/docs/cloud-agent/api/endpoints), with the user's own API key
// from Cursor Dashboard → API Keys. Agents run in Cursor's cloud on the user's repositories and account.
const API = () => (process.env.REX_CURSOR_API_URL?.trim() || "https://api.cursor.com").replace(/\/+$/, "");

interface StoredKey { key: string; hint: string | null; name: string | null }

function stored(userId: string): StoredKey | null {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'cursorKey'").get(userId) as { value: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value) as StoredKey; } catch { return null; }
}

function apiKey(userId: string): string | null {
  const entry = stored(userId);
  return entry ? decryptSecret(entry.key) : null;
}

export function cursorStatus(userId: string) {
  const entry = stored(userId);
  return { connected: Boolean(entry), keyHint: entry?.hint ?? null, keyName: entry?.name ?? null };
}

export function hasCursor(userId: string | undefined) {
  return Boolean(userId && apiKey(userId));
}

async function call<T>(key: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API()}${path}`, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (response.status === 401 || response.status === 403) throw new Error("Cursor rejected the API key. Create a new one in Cursor Dashboard → API Keys.");
  if (!response.ok) {
    let message = text.slice(0, 300);
    try { const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string }; message = (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ?? parsed.message ?? message; } catch { /* keep text */ }
    throw new Error(`Cursor answered ${response.status}: ${message}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export async function connectCursor(userId: string, key: string) {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 500) throw new Error("Paste your Cursor API key.");
  const me = await call<{ apiKeyName?: string; userEmail?: string }>(trimmed, "GET", "/v1/me");
  const value: StoredKey = { key: encryptSecret(trimmed), hint: secretHint(trimmed), name: me.apiKeyName ?? null };
  db.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (?, 'cursorKey', ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value").run(userId, JSON.stringify(value));
  return cursorStatus(userId);
}

export function disconnectCursor(userId: string) {
  db.prepare("DELETE FROM user_settings WHERE user_id = ? AND key = 'cursorKey'").run(userId);
  return cursorStatus(userId);
}

interface Agent { id: string; name?: string; status?: string; url?: string; latestRunId?: string; repos?: Array<{ url: string }> }
interface Run { id: string; status?: string; result?: string; durationMs?: number; git?: { branches?: Array<{ repoUrl?: string; branch?: string; prUrl?: string }> } }

function describe(agent: Agent, run?: Run) {
  return JSON.stringify({
    agent_id: agent.id, name: agent.name, agent_status: agent.status, url: agent.url,
    run_status: run?.status, result: run?.result?.slice(0, 6000), duration_ms: run?.durationMs,
    branches: run?.git?.branches,
  });
}

/** Runs the cursor_agent tool for one user. Errors come back as text the model can read. */
export async function cursorAgentTool(userId: string | undefined, args: Record<string, unknown>): Promise<string> {
  const key = userId ? apiKey(userId) : null;
  if (!key) return "cursor_agent unavailable: the user hasn't connected a Cursor API key (Settings → Models → Cursor).";
  const action = String(args.action ?? "");
  const prompt = typeof args.prompt === "string" ? args.prompt.trim().slice(0, 8000) : "";
  const agentId = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
  try {
    if (action === "start") {
      const repo = typeof args.repo_url === "string" ? args.repo_url.trim() : "";
      if (!prompt) return "cursor_agent failed: give the agent a prompt.";
      if (repo && !/^https:\/\/[^\s]+$/i.test(repo)) return "cursor_agent failed: repo_url must be an https URL.";
      const created = await call<{ agent: Agent; run: Run }>(key, "POST", "/v1/agents", {
        prompt: { text: prompt },
        ...(repo ? { repos: [{ url: repo, ...(typeof args.starting_ref === "string" && args.starting_ref.trim() ? { startingRef: args.starting_ref.trim() } : {}) }] } : {}),
        ...(args.auto_create_pr === true ? { autoCreatePR: true } : {}),
      });
      return describe(created.agent, created.run);
    }
    if (action === "status") {
      if (!/^bc-[\w-]+$/.test(agentId)) return "cursor_agent failed: pass the agent_id (bc-...) from start.";
      const agent = await call<Agent>(key, "GET", `/v1/agents/${encodeURIComponent(agentId)}`);
      const run = agent.latestRunId ? await call<Run>(key, "GET", `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(agent.latestRunId)}`) : undefined;
      return describe(agent, run);
    }
    if (action === "follow_up") {
      if (!/^bc-[\w-]+$/.test(agentId) || !prompt) return "cursor_agent failed: pass agent_id and a prompt.";
      const created = await call<{ run: Run }>(key, "POST", `/v1/agents/${encodeURIComponent(agentId)}/runs`, { prompt: { text: prompt } });
      return JSON.stringify({ agent_id: agentId, run_id: created.run.id, run_status: created.run.status });
    }
    if (action === "list") {
      const list = await call<{ items?: Agent[] }>(key, "GET", "/v1/agents?limit=10&includeArchived=false");
      return JSON.stringify((list.items ?? []).map((agent) => ({ agent_id: agent.id, name: agent.name, status: agent.status, url: agent.url })));
    }
    return "cursor_agent failed: action must be start, status, follow_up or list.";
  } catch (error) {
    return `cursor_agent failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
