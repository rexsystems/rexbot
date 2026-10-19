import { COMPUTER_INPUT_ACTIONS, type ComputerBackendKind, type ToolName } from "./types.js";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const PODMAN_EXEC: ToolDefinition = {
  name: "computer_exec",
  description: "Run a shell command on Rex Computer, ONLY if the user has started it. Python 3 and Alpine shell are available. Work in /workspace. No network, host files, credentials or GUI. Files last until Stop; commands time out after 20 seconds. Never claim access to the user's computer.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "Shell command to execute inside the isolated container" } },
    required: ["command"],
  },
};

const DESKTOP_EXEC: ToolDefinition = {
  name: "computer_exec",
  description: "Run a bash command on Rex Computer, a Linux VM shared by every bot. Your working directory is /workspace/bots/<your id>; /workspace/shared is shared with all bots and persists. You have passwordless sudo: install packages with `sudo apt-get install -y <pkg>`, compile tools, pull git repos, browse the web. DISPLAY points at your own screen, so GUI apps you launch appear there; start them detached, e.g. `setsid -f firefox-esr https://example.com >/dev/null 2>&1`. The VM has network access. Commands time out after 5 minutes. It is not the user's computer.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "Bash command to run on the VM" } },
    required: ["command"],
  },
};

const DESKTOP_INPUT: ToolDefinition = {
  name: "computer_input",
  description: "Control the mouse and keyboard on your own Rex Computer screen (1280x800). The user's view becomes read-only while you control it and unlocks after about a minute without input. Call computer_screenshot first to learn window titles and the screen size. Coordinates are pixels from the top-left.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...COMPUTER_INPUT_ACTIONS] },
      x: { type: "number", description: "X pixel for move/click actions" },
      y: { type: "number", description: "Y pixel for move/click actions" },
      text: { type: "string", description: "Text for action=type, up to 2000 characters" },
      keys: { type: "string", description: "xdotool key combo for action=key, e.g. ctrl+l, Return, alt+F4" },
      direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
      amount: { type: "number", description: "Scroll steps, 1-20" },
    },
    required: ["action"],
  },
};

const DESKTOP_SCREENSHOT: ToolDefinition = {
  name: "computer_screenshot",
  description: "Capture your Rex Computer screen. Saves a PNG in your workspace and returns its path, the screen size, the active window and the open window titles. You cannot see the pixels; use the titles and paths to plan your next action.",
  parameters: { type: "object", properties: {} },
};

const BASE_TOOLS: ToolDefinition[] = [
  {
    name: "message_bot",
    description: "Send a private question or task to a bot listed in your available teammates, and receive its real reply. Use when the user asks you to contact it, or a specific second opinion would help. Only bots sharing a group may communicate. Include the context the teammate needs; it cannot see your personal chat. Exchanges are visible to the owner in the group's private-message log. No recursive delegation.",
    parameters: { type: "object", properties: { bot_id: { type: "string", description: "Exact teammate id from the roster" }, message: { type: "string", description: "Self-contained question/task, up to 4000 characters" } }, required: ["bot_id", "message"] },
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

export interface ComputerToolOptions {
  backend?: ComputerBackendKind;
  desktop?: boolean;
}

export function toolDefinitions(options: ComputerToolOptions = {}): ToolDefinition[] {
  const computerTools = options.desktop ? [DESKTOP_EXEC, DESKTOP_INPUT, DESKTOP_SCREENSHOT] : [PODMAN_EXEC];
  return [BASE_TOOLS[0]!, ...computerTools, ...BASE_TOOLS.slice(1)];
}

/** Tool list for the local Podman computer; use toolDefinitions() when the backend is known. */
export const TOOL_DEFINITIONS: ToolDefinition[] = toolDefinitions();

/** Live-voice only: hang up when the user asks or the bot decides the call should end. */
export const END_CALL_TOOL: ToolDefinition = {
  name: "end_call",
  description:
    "End this live voice call now. Use when the user asks to hang up, end the call, stop the call, disconnect, or says goodbye in a way that closes the call. Also use when you decide the conversation is finished and should disconnect. Say a brief goodbye first if natural, then call this tool. Do not claim the call ended until this tool runs.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Optional short reason for ending the call" },
    },
  },
};

export function toOpenAiTools(options: ComputerToolOptions = {}) {
  return toolDefinitions(options).map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
