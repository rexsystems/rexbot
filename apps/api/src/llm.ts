import { providerInfo, type ClientSettings } from "@rex/shared";
import { recordUsage, type ModelSettings } from "./providers.js";
import { normalizeToolMarkup } from "./dsml.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  reasoning_content?: string | null;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
  name?: string;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

function baseUrl(settings: ClientSettings) {
  return settings.llmBaseUrl.replace(/\/$/, "");
}

export async function* streamChatCompletion(opts: {
  settings: ModelSettings;
  messages: LlmMessage[];
  tools?: unknown[];
}): AsyncGenerator<ChatCompletionChunk> {
  const { settings } = opts;
  const route = settings.route;
  if (!settings.llmApiKey.trim() && (!route || route.provider === "client" || providerInfo(route.provider).keyRequired)) {
    throw new Error("No model is connected. Add a provider in Settings → Models.");
  }
  const usage = { prompt: 0, completion: 0 };
  let toolCalls = 0;
  const source = route?.kind === "anthropic" ? streamAnthropic(opts, usage) : streamOpenAi(opts, usage);
  try {
    for await (const chunk of normalizeToolMarkup(source, opts.tools)) {
      toolCalls += chunk.choices?.[0]?.delta?.tool_calls?.filter((call) => call.id).length ?? 0;
      yield chunk;
    }
  } finally {
    recordUsage(route, settings.llmModel, usage, toolCalls);
  }
}

async function* sseEvents(res: Response): AsyncGenerator<{ event?: string; data: string }> {
  if (!res.body) throw new Error("The model's response had no body.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("event:")) event = trimmed.slice(6).trim();
      else if (trimmed.startsWith("data:")) { yield { event, data: trimmed.slice(5).trim() }; event = undefined; }
    }
  }
}

async function providerError(res: Response) {
  const text = await res.text();
  return new Error(`Model provider error ${res.status}: ${text.slice(0, 400)}`);
}

async function* streamOpenAi(opts: { settings: ModelSettings; messages: LlmMessage[]; tools?: unknown[] }, usage: { prompt: number; completion: number }): AsyncGenerator<ChatCompletionChunk> {
  const { settings, messages, tools } = opts;
  const body: Record<string, unknown> = { model: settings.llmModel, messages, stream: true };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  if (settings.route?.streamUsage) body.stream_options = { include_usage: true };
  const res = await fetch(`${baseUrl(settings)}/chat/completions`, {
    method: "POST",
    headers: { ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await providerError(res);
  for await (const { data } of sseEvents(res)) {
    if (data === "[DONE]") return;
    let chunk: ChatCompletionChunk & { usage?: { prompt_tokens?: number; completion_tokens?: number } | null };
    try { chunk = JSON.parse(data); } catch { continue; }
    if (chunk.usage) {
      usage.prompt = chunk.usage.prompt_tokens ?? usage.prompt;
      usage.completion = chunk.usage.completion_tokens ?? usage.completion;
    }
    yield chunk;
  }
}

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 8192;

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

/** Turns Chat Completions messages into Anthropic Messages: system apart, tool results as user turns. */
export function toAnthropicMessages(messages: LlmMessage[]) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content ?? "").filter(Boolean).join("\n\n");
  const out: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];
  const push = (role: "user" | "assistant", blocks: AnthropicBlock[]) => {
    if (!blocks.length) return;
    const last = out.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: message.content ?? "" }]);
    } else if (message.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) {
        let input: unknown = {};
        try { input = JSON.parse(call.function.arguments || "{}"); } catch { input = {}; }
        blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
      push("assistant", blocks);
    } else {
      push("user", [{ type: "text", text: message.content || "(empty)" }]);
    }
  }
  // The API wants the conversation to open with a user turn.
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "(conversation continues)" }] });
  return { system, messages: out };
}

function toAnthropicTools(tools: unknown[] | undefined) {
  return (tools as Array<{ function?: { name: string; description?: string; parameters?: unknown } }> | undefined)
    ?.filter((tool) => tool.function)
    .map((tool) => ({ name: tool.function!.name, description: tool.function!.description ?? "", input_schema: tool.function!.parameters ?? { type: "object", properties: {} } }));
}

function anthropicHeaders(settings: ModelSettings) {
  return { "x-api-key": settings.llmApiKey, "anthropic-version": ANTHROPIC_VERSION, "Content-Type": "application/json" };
}

async function* streamAnthropic(opts: { settings: ModelSettings; messages: LlmMessage[]; tools?: unknown[] }, usage: { prompt: number; completion: number }): AsyncGenerator<ChatCompletionChunk> {
  const { settings } = opts;
  const { system, messages } = toAnthropicMessages(opts.messages);
  const tools = toAnthropicTools(opts.tools);
  const res = await fetch(`${baseUrl(settings)}/messages`, {
    method: "POST",
    headers: anthropicHeaders(settings),
    body: JSON.stringify({ model: settings.llmModel, max_tokens: ANTHROPIC_MAX_TOKENS, stream: true, ...(system ? { system } : {}), messages, ...(tools?.length ? { tools } : {}) }),
  });
  if (!res.ok) throw await providerError(res);
  // Anthropic numbers content blocks; tool calls keep that index so the caller can assemble arguments.
  for await (const { data } of sseEvents(res)) {
    let event: {
      type?: string; index?: number;
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      usage?: { output_tokens?: number };
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
      error?: { message?: string };
    };
    try { event = JSON.parse(data); } catch { continue; }
    if (event.type === "error") throw new Error(`Anthropic error: ${event.error?.message ?? "unknown"}`);
    if (event.type === "message_start") {
      usage.prompt = event.message?.usage?.input_tokens ?? 0;
      usage.completion = event.message?.usage?.output_tokens ?? 0;
    } else if (event.type === "message_delta") {
      if (event.usage?.output_tokens !== undefined) usage.completion = event.usage.output_tokens;
      if (event.delta?.stop_reason) yield { choices: [{ delta: {}, finish_reason: event.delta.stop_reason === "tool_use" ? "tool_calls" : "stop" }] };
    } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      yield { choices: [{ delta: { tool_calls: [{ index: event.index ?? 0, id: event.content_block.id, type: "function", function: { name: event.content_block.name, arguments: "" } }] } }] };
    } else if (event.type === "content_block_delta") {
      if (event.delta?.type === "text_delta" && event.delta.text) yield { choices: [{ delta: { content: event.delta.text } }] };
      else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) yield { choices: [{ delta: { tool_calls: [{ index: event.index ?? 0, function: { arguments: event.delta.partial_json } }] } }] };
    } else if (event.type === "message_stop") {
      return;
    }
  }
}

export async function embedTexts(
  settings: ClientSettings,
  texts: string[],
  purpose: "query" | "document" = "document",
): Promise<number[][] | null> {
  if (texts.length === 0) return null;
  try {
    if ((settings.embeddingProvider ?? "google") === "google") {
      if (!settings.googleApiKey?.trim()) return null;
      const model = settings.embeddingModel?.trim() || "gemini-embedding-2";
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += 4) {
        const batch = await Promise.all(texts.slice(start, start + 4).map(async (text) => {
          const formatted = model === "gemini-embedding-2" ? purpose === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}` : text;
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": settings.googleApiKey!.trim() },
            body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: formatted }] }, outputDimensionality: 768 }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!response.ok) throw new Error("Google embedding request failed");
          const body = await response.json() as { embedding?: { values?: number[] } };
          const values = body.embedding?.values;
          if (!values?.length || values.some((value) => !Number.isFinite(value))) throw new Error("Invalid embedding");
          return values;
        }));
        vectors.push(...batch);
      }
      return vectors;
    }
    if (!settings.llmApiKey.trim() || (settings as ModelSettings).route?.kind === "anthropic") return null;
    const res = await fetch(`${baseUrl(settings)}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.llmApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.embeddingModel || "text-embedding-3-small",
        input: texts,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  } catch {
    return null;
  }
}

export function embeddingSpace(settings: ClientSettings): string {
  return (settings.embeddingProvider ?? "google") === "google" ? `google:${settings.embeddingModel || "gemini-embedding-2"}:768` : `openai:${baseUrl(settings)}:${settings.embeddingModel || "text-embedding-3-small"}`;
}

export async function completeJson(opts: {
  settings: ModelSettings;
  system: string;
  user: string;
}): Promise<string> {
  if (opts.settings.route?.kind === "anthropic") {
    const res = await fetch(`${baseUrl(opts.settings)}/messages`, {
      method: "POST",
      headers: anthropicHeaders(opts.settings),
      body: JSON.stringify({ model: opts.settings.llmModel, max_tokens: 2048, temperature: 0.2, system: opts.system, messages: [{ role: "user", content: opts.user }] }),
    });
    if (!res.ok) throw await providerError(res);
    const json = await res.json() as { content?: Array<{ type: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    recordUsage(opts.settings.route, opts.settings.llmModel, { prompt: json.usage?.input_tokens ?? 0, completion: json.usage?.output_tokens ?? 0 }, 0);
    return json.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("") ?? "";
  }
  const res = await fetch(`${baseUrl(opts.settings)}/chat/completions`, {
    method: "POST",
    headers: {
      ...(opts.settings.llmApiKey ? { Authorization: `Bearer ${opts.settings.llmApiKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.settings.llmModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  recordUsage(opts.settings.route, opts.settings.llmModel, { prompt: json.usage?.prompt_tokens ?? 0, completion: json.usage?.completion_tokens ?? 0 }, 0);
  return json.choices[0]?.message?.content ?? "";
}
