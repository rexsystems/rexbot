import type { ToolName } from "./types.js";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "computer_exec",
    description: "Run a shell command on Rex Computer, ONLY if the user has started it. Python 3 and Alpine shell are available. Work in /workspace. No network, host files, credentials or GUI. Files last until Stop; commands time out after 20 seconds. Never claim access to the user's computer.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to execute inside the isolated container" } },
      required: ["command"],
    },
  },
  {
    name: "react_message",
    description: "Optionally react to the user's latest message when a reaction feels natural. Use sparingly, at most once per turn. This adds a visible reaction on their message; still answer normally.",
    parameters: {
      type: "object",
      properties: { emoji: { type: "string", enum: ["👍", "❤️", "😂", "🔥", "👀"] } },
      required: ["emoji"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the live web for current information. Use when facts may have changed or you need sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Max results (1-8)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_upload",
    description:
      "Read the text content of a file the user uploaded in this conversation.",
    parameters: {
      type: "object",
      properties: {
        upload_id: {
          type: "string",
          description: "Upload id from the conversation",
        },
      },
      required: ["upload_id"],
    },
  },
  {
    name: "http_fetch",
    description:
      "Fetch a public URL with GET and return text content (HTML/text truncated).",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Absolute http(s) URL",
        },
      },
      required: ["url"],
    },
  },
];

export function toOpenAiTools() {
  return TOOL_DEFINITIONS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
