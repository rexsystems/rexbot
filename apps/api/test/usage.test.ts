import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeUsage, type UsageCounters } from "../src/usage.js";

test("cache and reasoning are subsets for OpenAI and DeepSeek; missing counters stay unknown", () => {
  assert.deepEqual(mergeUsage({ prompt: 0, completion: 0 }, { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 12 } }), { prompt: 100, completion: 20, cacheRead: 80, reasoning: 12 });
  assert.deepEqual(mergeUsage({ prompt: 0, completion: 0 }, { prompt_tokens: 100, prompt_cache_hit_tokens: 90 }), { prompt: 100, completion: 0, cacheRead: 90 });
  assert.deepEqual(mergeUsage({ prompt: 0, completion: 0 }, { prompt_tokens: 10 }), { prompt: 10, completion: 0 });
});
test("Anthropic cached input is added once and survives output-only streaming updates", () => {
  const usage: UsageCounters = { prompt: 0, completion: 0 };
  mergeUsage(usage, { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 20, output_tokens: 1 }, true);
  mergeUsage(usage, { output_tokens: 30 }, true);
  mergeUsage(usage, { output_tokens: -1 }, true);
  assert.deepEqual(usage, { prompt: 110, completion: 30, cacheRead: 80, cacheWrite: 20 });
});
