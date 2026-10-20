/**
 * Model providers Rex can talk to. "openai" means the OpenAI-compatible Chat Completions API
 * (streaming + function tools); "anthropic" is Anthropic's native Messages API.
 * Model ids are not hardcoded: the app lists them live from each provider's /models endpoint.
 */
export type ProviderKind = "openai" | "anthropic";

export type ProviderId =
  | "openai" | "anthropic" | "google" | "xai" | "deepseek" | "openrouter" | "mistral" | "groq"
  | "ollama" | "lmstudio" | "custom";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Local servers usually run without a key. */
  keyRequired: boolean;
  /** Where the user creates a key. */
  keyUrl?: string;
  /** Logo in apps/web/public/providers; missing means a letter tile. */
  logo?: string;
  local?: boolean;
  /** Supports stream_options.include_usage, so token counts reach the usage page. */
  streamUsage: boolean;
  /** Its main models accept images. Users can override this per connection. */
  vision: boolean;
  blurb: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", keyRequired: true, keyUrl: "https://platform.openai.com/api-keys", logo: "openai.svg", streamUsage: true, vision: true, blurb: "GPT models with an OpenAI Platform API key." },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", keyRequired: true, keyUrl: "https://console.anthropic.com/settings/keys", logo: "claude.svg", streamUsage: true, vision: true, blurb: "Claude models with a Claude Console API key." },
  { id: "google", name: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyRequired: true, keyUrl: "https://aistudio.google.com/apikey", logo: "gemini.svg", streamUsage: true, vision: true, blurb: "Gemini through Google's OpenAI-compatible endpoint." },
  { id: "xai", name: "xAI", kind: "openai", baseUrl: "https://api.x.ai/v1", keyRequired: true, keyUrl: "https://console.x.ai", logo: "xai.svg", streamUsage: true, vision: true, blurb: "Grok models with an xAI API key." },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com", keyRequired: true, keyUrl: "https://platform.deepseek.com/api_keys", logo: "deepseek.svg", streamUsage: true, vision: false, blurb: "DeepSeek chat and reasoning models." },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", keyRequired: true, keyUrl: "https://openrouter.ai/keys", logo: "openrouter.svg", streamUsage: true, vision: true, blurb: "Hundreds of models from many labs behind one key." },
  { id: "mistral", name: "Mistral AI", kind: "openai", baseUrl: "https://api.mistral.ai/v1", keyRequired: true, keyUrl: "https://console.mistral.ai/api-keys", logo: "mistral.svg", streamUsage: false, vision: true, blurb: "Mistral and Codestral models." },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", keyRequired: true, keyUrl: "https://console.groq.com/keys", streamUsage: true, vision: false, blurb: "Open models on very fast inference hardware." },
  { id: "ollama", name: "Ollama", kind: "openai", baseUrl: "http://localhost:11434/v1", keyRequired: false, logo: "ollama.svg", local: true, streamUsage: true, vision: false, blurb: "Models running on this server with Ollama." },
  { id: "lmstudio", name: "LM Studio", kind: "openai", baseUrl: "http://localhost:1234/v1", keyRequired: false, logo: "lmstudio.svg", local: true, streamUsage: false, vision: false, blurb: "Models served by LM Studio's local server." },
  { id: "custom", name: "Other (OpenAI-compatible)", kind: "openai", baseUrl: "", keyRequired: false, streamUsage: false, vision: false, blurb: "Any server that speaks the Chat Completions API." },
];

export function providerInfo(id: string): ProviderInfo {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS.find((provider) => provider.id === "custom")!;
}

/** A provider account a user connected. The key never leaves the server; only its last characters do. */
export interface ProviderConnection {
  id: string;
  provider: ProviderId;
  label: string;
  baseUrl: string;
  keyHint: string | null;
  defaultModel: string;
  /** Images in chat are sent to this model. */
  vision: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelChoice {
  connectionId: string;
  model: string;
}

export interface ProviderState {
  connections: ProviderConnection[];
  /** The model new chats use when a bot has none of its own. */
  active: ModelChoice | null;
}

export interface ProviderModel {
  id: string;
  name?: string;
}
