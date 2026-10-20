import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToolMarkup, parseDsml } from "../src/dsml.js";
import type { ChatCompletionChunk } from "../src/llm.js";

const command = "cd ~/siteparts && cat > 05_services.html <<'EOF'\n<section>Services</section>\nEOF";
const markup = `<｜DSML｜calls><｜DSML｜invoke name="computer_exec"><｜DSML｜parameter name="command" string="true">${command}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>`;
const tools = [{ function: { name: "computer_exec" } }];

test("real DeepSeek double-bar DSML and spaced variants execute across stream splits", async () => {
  for (const delimiter of ["｜｜", "||", "｜ ｜", " | | "]) {
    const actual = markup.replaceAll("｜DSML｜", `${delimiter}DSML${delimiter} `);
    for (const size of [1, 2, 7, 80, 1000]) {
      async function* source(): AsyncGenerator<ChatCompletionChunk> {
        for (let at = 0; at < actual.length; at += size) yield { choices: [{ delta: { content: actual.slice(at, at + size) } }] };
      }
      const chunks = [];
      for await (const chunk of normalizeToolMarkup(source(), tools)) chunks.push(chunk);
      assert.equal(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join(""), "");
      const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? []);
      assert.equal(calls.length, 1);
      assert.deepEqual(JSON.parse(calls[0]!.function!.arguments!), { command });
    }
  }
});

test("DSML tool markup survives arbitrary stream splits without leaking into chat", async () => {
  for (const size of [1, 2, 7, 80, 1000]) {
    async function* source(): AsyncGenerator<ChatCompletionChunk> {
      const text = `Checking the page. ${markup}`;
      for (let at = 0; at < text.length; at += size) yield { choices: [{ delta: { content: text.slice(at, at + size) } }] };
    }
    const chunks = [];
    for await (const chunk of normalizeToolMarkup(source(), tools)) chunks.push(chunk);
    assert.equal(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join(""), "Checking the page. ");
    const calls = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? []);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0]!.function!.arguments!), { command });
  }
});

test("invalid and unavailable DSML calls cannot execute", () => {
  assert.throws(() => parseDsml(markup, new Set()), /unavailable/);
  assert.throws(() => parseDsml(markup.slice(0, -20), new Set(["computer_exec"])), /incomplete/);
});

test("normal text, HTML and native tool deltas retain their content and reasoning", async () => {
  async function* source(): AsyncGenerator<ChatCompletionChunk> {
    yield { choices: [{ delta: { content: "Use <" } }] };
    yield { choices: [{ delta: { content: "section> here.", reasoning_content: "checked" } }] };
    yield { choices: [{ delta: { content: "Ready", tool_calls: [{ index: 0, id: "native", function: { name: "computer_exec", arguments: "{}" } }] } }] };
  }
  const chunks = [];
  for await (const chunk of normalizeToolMarkup(source(), tools)) chunks.push(chunk);
  assert.equal(chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join(""), "Use <section> here.Ready");
  assert.equal(chunks.map((chunk) => chunk.choices?.[0]?.delta?.reasoning_content ?? "").join(""), "checked");
  assert.equal(chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? []).length, 1);
});
