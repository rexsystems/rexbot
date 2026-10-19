import type { ClientSettings } from "@rex/shared";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
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
  settings: ClientSettings;
  messages: LlmMessage[];
  tools?: unknown[];
}): AsyncGenerator<ChatCompletionChunk> {
  const { settings, messages, tools } = opts;
  if (!settings.llmApiKey.trim()) {
    throw new Error("LLM API key is missing. Add it in Settings.");
  }

  const body: Record<string, unknown> = {
    model: settings.llmModel,
    messages,
    stream: true,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${baseUrl(settings)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.body) throw new Error("LLM response had no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data) as ChatCompletionChunk;
      } catch {
        // ignore malformed chunks
      }
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
    if (!settings.llmApiKey.trim()) return null;
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
  settings: ClientSettings;
  system: string;
  user: string;
}): Promise<string> {
  const res = await fetch(`${baseUrl(opts.settings)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.settings.llmApiKey}`,
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
  };
  return json.choices[0]?.message?.content ?? "";
}
