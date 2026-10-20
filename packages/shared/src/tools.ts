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
  description: "Run a bash command on Rex Computer, a Linux VM shared by every bot. Your working directory is /workspace/bots/<your id>; /workspace/shared is shared with all bots and persists. You have passwordless sudo: install packages with `sudo apt-get install -y <pkg>`, compile tools, pull git repos, browse the web. DISPLAY and a session dbus are set for your screen. Launch GUI apps detached, e.g. `setsid -f rex-browser https://example.com >/dev/null 2>&1` (Chromium on Xvfb) or `setsid -f xterm >/dev/null 2>&1`. Clipboard: `xclip`. Commands time out after 5 minutes. It is not the user's computer.",
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

/** Offered only when the user connected their own Cursor API key. */
export const CURSOR_AGENT_TOOL: ToolDefinition = {
  name: "cursor_agent",
  description: "Delegate coding work on a git repository to a Cursor Cloud Agent running under the user's own Cursor account. Use ONLY when the user asks for work on a specific repository (fix, feature, refactor, review) or asks you to use Cursor. action=start launches an agent (it may push a branch and, with auto_create_pr, open a pull request), status reads its progress and final summary, follow_up sends more instructions to an existing agent, list shows recent agents. Agents take minutes: start, tell the user the link, and check status when asked. Never start one without the user's request.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "status", "follow_up", "list"] },
      prompt: { type: "string", description: "Task for start/follow_up, self-contained, up to 8000 characters" },
      repo_url: { type: "string", description: "For start: repository URL, e.g. https://github.com/owner/repo" },
      starting_ref: { type: "string", description: "For start: branch or commit to start from (default branch if omitted)" },
      auto_create_pr: { type: "boolean", description: "For start: open a pull request when done. Only if the user asked for a PR." },
      agent_id: { type: "string", description: "For status/follow_up: the bc-... id returned by start" },
    },
    required: ["action"],
  },
};

export const ROUTINE_TOOL: ToolDefinition = {
  name: "routine",
  description: "Manage scheduled routines for this chat: a routine re-sends a prompt to you on a schedule (daily at a time, on chosen weekdays, or every N hours) and you answer it then, with your tools. Use it ONLY when the user asks for something recurring or later (\"every morning send me...\", \"remind me on Fridays...\", \"check this every 6 hours\"). Times are in the user's time zone. Write the prompt as a self-contained instruction to your future self. Confirm the schedule back to the user after creating it. action=list shows this chat's routines; pause, resume and delete need routine_id from list or create.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "pause", "resume", "delete"] },
      title: { type: "string", description: "For create: short name, e.g. Morning news brief" },
      prompt: { type: "string", description: "For create: what to do each time, self-contained, up to 4000 characters" },
      time: { type: "string", description: "For a daily/weekly routine: local time HH:MM (24h)" },
      days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "Optional weekdays, 0=Sunday..6=Saturday. Omit for every day." },
      every_hours: { type: "integer", minimum: 1, maximum: 168, description: "For an interval routine instead of time: repeat every N hours" },
      routine_id: { type: "string", description: "For pause/resume/delete" },
    },
    required: ["action"],
  },
};

export interface ComputerToolOptions {
  backend?: ComputerBackendKind;
  desktop?: boolean;
  /** The user has a Cursor API key connected. */
  cursor?: boolean;
  /** Scheduled routines are available in this context (not inside a routine run). */
  routines?: boolean;
}

export function toolDefinitions(options: ComputerToolOptions = {}): ToolDefinition[] {
  const computerTools = options.desktop ? [DESKTOP_EXEC, DESKTOP_INPUT, DESKTOP_SCREENSHOT] : [PODMAN_EXEC];
  return [BASE_TOOLS[0]!, ...computerTools, ...BASE_TOOLS.slice(1), ...(options.cursor ? [CURSOR_AGENT_TOOL] : []), ...(options.routines ? [ROUTINE_TOOL] : [])];
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
