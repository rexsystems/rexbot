import { randomUUID } from "node:crypto";
import type { ChatCompletionChunk } from "./llm.js";

const marker = /<[｜|]\s*DSML\s*[｜|]\s*/;
const tag = String.raw`<[｜|]\s*DSML\s*[｜|]\s*`;

export function parseDsml(text: string, allowed: Set<string>) {
  const calls: Array<{ index: number; id: string; type: string; function: { name: string; arguments: string } }> = [];
  const wrapper = new RegExp(`^${tag}(?:function_)?calls>([\\s\\S]*)${tag}\\/(?:function_)?calls>\\s*$`).exec(text);
  if (!wrapper) throw new Error("The model returned an incomplete tool call. Please retry the request.");
  const invoke = new RegExp(`${tag}invoke\\s+name="([^"]+)"\\s*>([\\s\\S]*?)${tag}\\/invoke>`, "g");
  const parameter = new RegExp(`${tag}parameter\\s+name="([^"]+)"(?:\\s+string="(true|false)")?\\s*>([\\s\\S]*?)${tag}\\/parameter>`, "g");
  let rest = wrapper[1]!;
  for (const call of wrapper[1]!.matchAll(invoke)) {
    const name = call[1]!;
    if (!allowed.has(name)) throw new Error(`The model requested an unavailable tool: ${name}.`);
    const args = Object.create(null) as Record<string, unknown>;
    let body = call[2]!;
    for (const param of call[2]!.matchAll(parameter)) {
      if (Object.hasOwn(args, param[1]!)) throw new Error("The model returned duplicate tool parameters.");
      args[param[1]!] = param[2] === "false" ? JSON.parse(param[3]!) : param[3]!;
      body = body.replace(param[0], "");
    }
    if (body.trim()) throw new Error("The model returned invalid tool parameters. Please retry the request.");
    calls.push({ index: calls.length, id: `dsml_${randomUUID()}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
    rest = rest.replace(call[0], "");
  }
  if (!calls.length || rest.trim()) throw new Error("The model returned an invalid tool call. Please retry the request.");
  return calls;
}

export async function* normalizeToolMarkup(source: AsyncIterable<ChatCompletionChunk>, tools?: unknown[]): AsyncGenerator<ChatCompletionChunk> {
  const allowed = new Set((tools as Array<{ function?: { name: string } }> | undefined)?.flatMap((tool) => tool.function ? [tool.function.name] : []) ?? []);
  let pending = "";
  let markup = false;
  let native = false;
  for await (const chunk of source) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.tool_calls?.length) native = true;
    if (!delta?.content) { yield chunk; continue; }
    pending += delta.content;
    const start = pending.search(marker);
    if (start >= 0) {
      if (!markup && start > 0) yield { choices: [{ delta: { content: pending.slice(0, start) } }] };
      pending = pending.slice(start);
      markup = true;
    }
    if (!markup) {
      // Hold a possible split marker until the next chunk arrives.
      const partial = pending.lastIndexOf("<");
      const cut = partial >= 0 && /^<(?:[｜|](?:\s*D(?:S(?:M(?:L(?:\s*[｜|])?)?)?)?)?)?$/.test(pending.slice(partial)) ? partial : pending.length;
      if (cut) yield { ...chunk, choices: [{ ...chunk.choices?.[0], delta: { ...delta, content: pending.slice(0, cut) } }] };
      pending = pending.slice(cut);
    } else if (delta.reasoning_content || delta.tool_calls) {
      yield { ...chunk, choices: [{ ...chunk.choices?.[0], delta: { ...delta, content: undefined } }] };
    }
  }
  if (markup) {
    if (native) throw new Error("The model mixed incompatible tool call formats. Please retry the request.");
    yield { choices: [{ delta: { tool_calls: parseDsml(pending, allowed) }, finish_reason: "tool_calls" }] };
  } else if (pending) yield { choices: [{ delta: { content: pending } }] };
}
