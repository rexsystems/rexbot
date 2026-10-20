export interface UsageCounters {
  prompt: number;
  completion: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
}
export interface ProviderUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_cache_hit_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function mergeUsage(target: UsageCounters, raw?: ProviderUsage | null, anthropic = false): UsageCounters {
  if (!raw) return target;
  const read = count(anthropic ? raw.cache_read_input_tokens : raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens);
  const write = count(anthropic ? raw.cache_creation_input_tokens : raw.prompt_tokens_details?.cache_write_tokens);
  const reasoning = count(raw.completion_tokens_details?.reasoning_tokens);
  if (read !== undefined) target.cacheRead = read;
  if (write !== undefined) target.cacheWrite = write;
  if (reasoning !== undefined) target.reasoning = reasoning;
  const prompt = count(anthropic ? raw.input_tokens : raw.prompt_tokens);
  const completion = count(anthropic ? raw.output_tokens : raw.completion_tokens);
  if (prompt !== undefined) target.prompt = prompt + (anthropic ? (target.cacheRead ?? 0) + (target.cacheWrite ?? 0) : 0);
  if (completion !== undefined) target.completion = completion;
  return target;
}
